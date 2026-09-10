import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requestTenant, fanRedirect } from "@/src/server/fans/request";
import { withCreator } from "@/src/server/db/scoped";
import { consumeTenantRateLimit } from "@/src/server/security/rate-limit";
import { requireEmailDelivery } from "@/src/modules/notifications/provider";

const schema=z.object({email:z.string().trim().toLowerCase().email().max(320)});

export async function POST(request:Request){
  const tenant=await requestTenant(request); if(!tenant)return new NextResponse("Unknown creator site",{status:404});
  const parsed=schema.safeParse(Object.fromEntries(await request.formData())); if(!parsed.success)return fanRedirect(request,"/fan/forgot-password?notice=sent");
  try{
    await withCreator(tenant.creatorId,async client=>{
      const rate=await consumeTenantRateLimit(client,{creatorId:tenant.creatorId,scope:"fan-reset",key:parsed.data.email,limit:4,windowSeconds:1800,blockSeconds:1800});
      if(!rate.allowed)throw new Error(`RATE_LIMIT:${rate.retryAfterSeconds}`);
      const fan=(await client.query<{id:string}>("SELECT id FROM fans WHERE creator_id=$1 AND lower(email)=$2 AND disabled_at IS NULL LIMIT 1",[tenant.creatorId,parsed.data.email])).rows[0];
      if(!fan)return;
      await client.query("UPDATE fan_verification_tokens SET consumed_at=coalesce(consumed_at,now()) WHERE creator_id=$1 AND fan_id=$2 AND purpose='reset_password' AND consumed_at IS NULL",[tenant.creatorId,fan.id]);
      const raw=randomBytes(32).toString("base64url"); const digest=createHash("sha256").update(raw).digest("hex");
      await client.query("INSERT INTO fan_verification_tokens(creator_id,fan_id,purpose,token_hash,expires_at) VALUES($1,$2,'reset_password',$3,now()+interval '1 hour')",[tenant.creatorId,fan.id,digest]);
      const link=new URL(`/fan/reset-password?token=${encodeURIComponent(raw)}`,request.url).toString();
      const delivery=await requireEmailDelivery({to:parsed.data.email,subject:"Reset your password",text:`Reset your password: ${link}`,html:`<p><a href="${link}">Reset your password</a></p>`});
      await client.query("INSERT INTO notifications(creator_id,fan_id,channel,template_key,subject,body,status,sent_at,provider_message_id) VALUES($1,$2,'email','fan_password_reset','Reset your password','Password reset email sent.','sent',now(),$3)",[tenant.creatorId,fan.id,delivery.providerMessageId]);
    });
  }catch(error){
    const message=error instanceof Error?error.message:"";
    if(message.startsWith("RATE_LIMIT:"))return new NextResponse("Too many reset requests. Try again later.",{status:429,headers:{"retry-after":message.split(":")[1]??"1800"}});
    if(message==="EMAIL_PROVIDER_NOT_CONFIGURED")return new NextResponse("Email delivery is not configured for this deployment.",{status:503});
    console.error("Fan reset request failed",{message});
  }
  return fanRedirect(request,"/fan/forgot-password?notice=sent");
}
