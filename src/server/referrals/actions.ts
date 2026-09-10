"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withAuthorizedCreator } from "@/src/modules/auth/authorization";
import { requireCreatorFeature } from "@/src/modules/entitlements/server";
import { approveReferralCommission,markReferralCommissionPaid } from "./service";
import type { FormState } from "@/app/components/action-form";

const uuid=z.string().uuid(),code=z.string().trim().min(2).max(80).regex(/^[A-Za-z0-9_-]+$/);
const schema=z.discriminatedUnion("operation",[
  z.object({creatorId:uuid,operation:z.literal("referral-create"),referrerFanId:uuid,code,reward:z.coerce.number().min(0).max(100000)}),
  z.object({creatorId:uuid,operation:z.literal("affiliate-create"),name:z.string().trim().min(1).max(160),email:z.string().trim().toLowerCase().email().max(320),code,commissionPercent:z.coerce.number().min(0).max(100)}),
  z.object({creatorId:uuid,operation:z.literal("affiliate-status"),affiliateId:uuid,status:z.enum(["active","paused","disabled"])}),
  z.object({creatorId:uuid,operation:z.literal("commission-approve"),commissionId:uuid}),
  z.object({creatorId:uuid,operation:z.literal("commission-paid"),commissionId:uuid,payoutReference:z.string().trim().min(1).max(255)}),
]);
const roles=new Set(["owner","admin","platform_admin"]);
export async function referralAction(_state:FormState,form:FormData):Promise<FormState>{const parsed=schema.safeParse(Object.fromEntries(form));if(!parsed.success)return{ok:false,message:"Check the referral fields and try again."};const d=parsed.data;
  try{await withAuthorizedCreator(d.creatorId,async(client,actor,role)=>{if(!roles.has(role))throw new Error("ROLE_DENIED");await requireCreatorFeature(client,d.creatorId,"referrals");
    if(d.operation==="referral-create"){const fan=await client.query("SELECT 1 FROM fans WHERE creator_id=$1 AND id=$2 AND disabled_at IS NULL",[d.creatorId,d.referrerFanId]);if(!fan.rowCount)throw new Error("FAN_NOT_FOUND");await client.query("INSERT INTO referrals(creator_id,referrer_fan_id,code,reward_minor,status) VALUES($1,$2,$3,$4,'pending')",[d.creatorId,d.referrerFanId,d.code,Math.round(d.reward*100)]);}
    else if(d.operation==="affiliate-create"){await requireCreatorFeature(client,d.creatorId,"advancedAffiliates");await client.query("INSERT INTO affiliates(creator_id,name,email,code,commission_bps,status) VALUES($1,$2,$3,$4,$5,'active')",[d.creatorId,d.name,d.email,d.code,Math.round(d.commissionPercent*100)]);}
    else if(d.operation==="affiliate-status"){await requireCreatorFeature(client,d.creatorId,"advancedAffiliates");await client.query("UPDATE affiliates SET status=$3 WHERE creator_id=$1 AND id=$2",[d.creatorId,d.affiliateId,d.status]);}
    else if(d.operation==="commission-approve"){if(!(await approveReferralCommission(client,{creatorId:d.creatorId,commissionId:d.commissionId})))throw new Error("COMMISSION_NOT_APPROVABLE");}
    else {if(!(await markReferralCommissionPaid(client,{creatorId:d.creatorId,commissionId:d.commissionId,payoutReference:d.payoutReference})))throw new Error("COMMISSION_NOT_PAYABLE");}
    await client.query("INSERT INTO audit_logs(actor_user_id,creator_id,action,target_type,target_id,metadata) VALUES($1,$2,$3,$4,$5,$6::jsonb)",[actor.id,d.creatorId,`referrals.${d.operation}`,d.operation.startsWith("affiliate")?"affiliate":d.operation.startsWith("commission")?"referral_commission":"referral","affiliateId" in d?d.affiliateId:"commissionId" in d?d.commissionId:"referrerFanId" in d?d.referrerFanId:d.creatorId,JSON.stringify({operation:d.operation})]);
  });}catch(error){const m=error instanceof Error?error.message:"";console.error("Referral action failed",{message:m});return{ok:false,message:m.includes("duplicate")?"That referral or affiliate code is already in use.":"Referral update could not be completed."};}
  revalidatePath(`/dashboard/${d.creatorId}/referrals`);return{ok:true,message:"Referral program updated."};}
