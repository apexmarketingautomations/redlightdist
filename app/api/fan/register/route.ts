import { createHash, randomBytes } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requestTenant, fanRedirect } from "@/src/server/fans/request";
import { withCreator } from "@/src/server/db/scoped";
import { consumeTenantRateLimit } from "@/src/server/security/rate-limit";
import { requireEmailDelivery } from "@/src/modules/notifications/provider";
import { dispatchAutomationEvent } from "@/src/server/automation/service";

const schema=z.object({email:z.string().trim().toLowerCase().email().max(320),password:z.string().min(12).max(128),acceptTerms:z.literal("on"),emailConsent:z.union([z.literal("on"),z.literal("")]).optional()});
const referralSchema=z.string().min(2).max(100).regex(/^[A-Za-z0-9_-]+$/);
export async function POST(request:Request){
  const tenant=await requestTenant(request);if(!tenant)return new NextResponse("Unknown creator site",{status:404});const parsed=schema.safeParse(Object.fromEntries(await request.formData()));if(!parsed.success)return fanRedirect(request,"/fan/register?error=invalid");const {email,password}=parsed.data;const cookieCode=(await cookies()).get("redlight_referral")?.value;const referralCode=referralSchema.safeParse(cookieCode).success?cookieCode!:null;
  try{
    await withCreator(tenant.creatorId,async client=>{
      const limit=await consumeTenantRateLimit(client,{creatorId:tenant.creatorId,scope:"fan-register",key:email,limit:4,windowSeconds:900,blockSeconds:1800});if(!limit.allowed)throw new Error(`RATE_LIMIT:${limit.retryAfterSeconds}`);
      const existing=(await client.query<{id:string;email_verified_at:Date|null}>("SELECT id,email_verified_at FROM fans WHERE creator_id=$1 AND lower(email)=$2 LIMIT 1",[tenant.creatorId,email])).rows[0];if(existing)throw new Error(existing.email_verified_at?"ACCOUNT_EXISTS":"ACCOUNT_PENDING");
      const fan=(await client.query<{id:string}>("INSERT INTO fans(creator_id,email,password_hash) VALUES($1,$2,$3) RETURNING id",[tenant.creatorId,email,await hash(password)])).rows[0]!;const consent=parsed.data.emailConsent==="on";
      let acceptedReferral:string|null=null;
      if(referralCode){
        const attribution=(await client.query<{kind:string;id:string}>(`SELECT 'referral' kind,id FROM referrals WHERE creator_id=$1 AND code=$2 AND status<>'void' AND (referred_fan_id IS NULL OR referred_fan_id=$3)
          UNION ALL SELECT 'affiliate' kind,id FROM affiliates WHERE creator_id=$1 AND code=$2 AND status='active' LIMIT 1`,[tenant.creatorId,referralCode,fan.id])).rows[0];
        if(attribution){acceptedReferral=referralCode;if(attribution.kind==="referral")await client.query("UPDATE referrals SET referred_fan_id=coalesce(referred_fan_id,$3) WHERE creator_id=$1 AND id=$2",[tenant.creatorId,attribution.id,fan.id]);}
      }
      await client.query("INSERT INTO fan_profiles(creator_id,fan_id,email_consent,marketing_consent,referral_source) VALUES($1,$2,$3,$3,$4)",[tenant.creatorId,fan.id,consent,acceptedReferral]);await client.query("INSERT INTO fan_consents(creator_id,fan_id,consent_key,document_version,granted,evidence) VALUES($1,$2,'terms_and_privacy','platform-current',true,$3::jsonb)",[tenant.creatorId,fan.id,JSON.stringify({method:"registration_form"})]);
      const rawToken=randomBytes(32).toString("base64url"),tokenHash=createHash("sha256").update(rawToken).digest("hex");await client.query("INSERT INTO fan_verification_tokens(creator_id,fan_id,purpose,token_hash,expires_at) VALUES($1,$2,'verify_email',$3,now()+interval '24 hours')",[tenant.creatorId,fan.id,tokenHash]);
      const link=new URL(`/api/fan/verify?token=${encodeURIComponent(rawToken)}`,request.url).toString();const delivery=await requireEmailDelivery({to:email,subject:"Verify your email",text:`Verify your fan account: ${link}`,html:`<p>Verify your fan account:</p><p><a href="${link}">Verify email</a></p>`});await client.query("INSERT INTO notifications(creator_id,fan_id,channel,template_key,subject,body,status,sent_at,provider_message_id) VALUES($1,$2,'email','fan_verify_email','Verify your email','Verification email sent.','sent',now(),$3)",[tenant.creatorId,fan.id,delivery.providerMessageId]);
      await dispatchAutomationEvent(client,{key:"fan.registered",creatorId:tenant.creatorId,fanId:fan.id,payload:{emailConsent:consent,referral:acceptedReferral},occurredAt:new Date()});
    });
  }catch(error){const message=error instanceof Error?error.message:"";if(message.startsWith("RATE_LIMIT:"))return new NextResponse("Too many registration attempts. Try again later.",{status:429,headers:{"retry-after":message.split(":")[1]??"900"}});if(message==="ACCOUNT_EXISTS")return fanRedirect(request,"/fan/login?notice=account-exists");if(message==="ACCOUNT_PENDING")return fanRedirect(request,"/fan/login?notice=verify-email");if(message==="EMAIL_PROVIDER_NOT_CONFIGURED")return new NextResponse("Email verification delivery is not configured for this deployment.",{status:503});console.error("Fan registration failed",{message});return new NextResponse("Registration could not be completed.",{status:500});}
  const response=fanRedirect(request,"/fan/login?notice=verify-email");response.cookies.set("redlight_referral","",{path:"/",maxAge:0});return response;
}
