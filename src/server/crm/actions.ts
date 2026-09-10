"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withAuthorizedCreator } from "@/src/modules/auth/authorization";
import { requireCreatorFeature } from "@/src/modules/entitlements/server";
import type { FormState } from "@/app/components/action-form";

const uuid=z.string().uuid();
const optionalNumber=(schema:z.ZodType<number,unknown>)=>z.preprocess(value=>value===""||value===null?undefined:value,schema.optional());
const subscriptionStatus=z.preprocess(value=>value===""?undefined:value,z.enum(["trialing","active","past_due","cancelled","expired","refunded"]).optional());
const schema=z.discriminatedUnion("operation",[
  z.object({creatorId:uuid,fanId:uuid,operation:z.literal("profile"),displayName:z.string().trim().max(160),phone:z.string().trim().max(40),acquisitionSource:z.string().trim().max(160)}),
  z.object({creatorId:uuid,fanId:uuid,operation:z.literal("add-note"),note:z.string().trim().min(1).max(5000)}),
  z.object({creatorId:uuid,fanId:uuid,operation:z.literal("add-tag"),tagId:uuid}),
  z.object({creatorId:uuid,fanId:uuid,operation:z.literal("remove-tag"),tagId:uuid}),
  z.object({creatorId:uuid,fanId:uuid,operation:z.enum(["suspend","restore"])}),
  z.object({creatorId:uuid,operation:z.literal("segment-create"),name:z.string().trim().min(2).max(160),subscriptionStatus,minSpend:optionalNumber(z.coerce.number().min(0).max(10000000)),inactiveDays:optionalNumber(z.coerce.number().int().min(0).max(3650)),ppvPurchases:optionalNumber(z.coerce.number().int().min(0).max(100000)),tagId:z.preprocess(value=>value===""?undefined:value,uuid.optional())}),
]);
const roles=new Set(["owner","admin","editor","platform_admin"]);
export async function crmAction(_state:FormState,form:FormData):Promise<FormState>{
  const parsed=schema.safeParse(Object.fromEntries(form));if(!parsed.success)return{ok:false,message:"Check the CRM fields and try again."};const d=parsed.data;
  try{await withAuthorizedCreator(d.creatorId,async(client,actor,role)=>{
    if(!roles.has(role))throw new Error("ROLE_DENIED");await requireCreatorFeature(client,d.creatorId,"crm");
    if(d.operation==="segment-create"){
      const rules:Record<string,unknown>={};if(d.subscriptionStatus)rules.subscriptionStatus=d.subscriptionStatus;if(d.minSpend!==undefined)rules.lifetimeSpendMinor={gte:Math.round(d.minSpend*100)};if(d.inactiveDays!==undefined)rules.daysSinceLastLogin={gte:d.inactiveDays};if(d.ppvPurchases!==undefined)rules.ppvPurchases={gte:d.ppvPurchases};if(d.tagId)rules.tagIds=[d.tagId];
      await client.query("INSERT INTO segments(creator_id,name,rules,is_system) VALUES($1,$2,$3::jsonb,false)",[d.creatorId,d.name,JSON.stringify(rules)]);return;
    }
    const exists=await client.query("SELECT 1 FROM fans WHERE creator_id=$1 AND id=$2",[d.creatorId,d.fanId]);if(!exists.rowCount)throw new Error("FAN_NOT_FOUND");
    if(d.operation==="profile")await client.query(`INSERT INTO fan_profiles(creator_id,fan_id,display_name,phone,acquisition_source) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(creator_id,fan_id) DO UPDATE SET display_name=excluded.display_name,phone=excluded.phone,acquisition_source=excluded.acquisition_source,updated_at=now()`,[d.creatorId,d.fanId,d.displayName||null,d.phone||null,d.acquisitionSource||null]);
    else if(d.operation==="add-note")await client.query("INSERT INTO fan_notes(creator_id,fan_id,author_user_id,note) VALUES($1,$2,$3,$4)",[d.creatorId,d.fanId,actor.id,d.note]);
    else if(d.operation==="add-tag")await client.query("INSERT INTO fan_tags(creator_id,fan_id,tag_id) SELECT $1,$2,id FROM crm_tags WHERE creator_id=$1 AND id=$3 ON CONFLICT DO NOTHING",[d.creatorId,d.fanId,d.tagId]);
    else if(d.operation==="remove-tag")await client.query("DELETE FROM fan_tags WHERE creator_id=$1 AND fan_id=$2 AND tag_id=$3",[d.creatorId,d.fanId,d.tagId]);
    else if(d.operation==="suspend"){await client.query("UPDATE fans SET disabled_at=coalesce(disabled_at,now()),updated_at=now() WHERE creator_id=$1 AND id=$2",[d.creatorId,d.fanId]);await client.query("UPDATE fan_sessions SET revoked_at=coalesce(revoked_at,now()) WHERE creator_id=$1 AND fan_id=$2",[d.creatorId,d.fanId]);await client.query("INSERT INTO blocked_users(creator_id,fan_id,reason) VALUES($1,$2,'Creator account suspension')",[d.creatorId,d.fanId]);}
    else {await client.query("UPDATE fans SET disabled_at=NULL,updated_at=now() WHERE creator_id=$1 AND id=$2",[d.creatorId,d.fanId]);await client.query("DELETE FROM blocked_users WHERE creator_id=$1 AND fan_id=$2 AND reason='Creator account suspension'",[d.creatorId,d.fanId]);}
    await client.query("INSERT INTO audit_logs(actor_user_id,creator_id,action,target_type,target_id) VALUES($1,$2,$3,'fan',$4)",[actor.id,d.creatorId,`crm.${d.operation}`,d.fanId]);
  });}catch(error){const m=error instanceof Error?error.message:"";console.error("CRM action failed",{message:m});return{ok:false,message:m==="FAN_NOT_FOUND"?"Fan not found.":"CRM update could not be completed."};}
  const fanId="fanId" in d?d.fanId:null;revalidatePath(`/dashboard/${d.creatorId}/fans`);if(fanId)revalidatePath(`/dashboard/${d.creatorId}/fans/${fanId}`);return{ok:true,message:"CRM updated."};
}
