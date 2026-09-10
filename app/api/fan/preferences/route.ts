import { NextResponse } from "next/server";
import { requestTenant } from "@/src/server/fans/request";
import { getCurrentFan } from "@/src/modules/auth/fan-session";
import { withCreator } from "@/src/server/db/scoped";

export async function POST(request:Request){const tenant=await requestTenant(request);if(!tenant)return new NextResponse("Tenant not found",{status:404});const fan=await getCurrentFan();if(!fan||fan.creatorId!==tenant.creatorId)return NextResponse.redirect(new URL("/fan/login",request.url),303);const form=await request.formData();const email=form.get("emailConsent")==="on",sms=form.get("smsConsent")==="on";
  await withCreator(tenant.creatorId,async client=>{await client.query(`INSERT INTO fan_profiles(creator_id,fan_id,email_consent,sms_consent,marketing_consent) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(creator_id,fan_id) DO UPDATE SET email_consent=excluded.email_consent,sms_consent=excluded.sms_consent,marketing_consent=excluded.marketing_consent,updated_at=now()`,[tenant.creatorId,fan.id,email,sms,email||sms]);for(const [key,granted] of [["email_marketing",email],["sms_marketing",sms]] as const)await client.query("INSERT INTO fan_consents(creator_id,fan_id,consent_key,document_version,granted,evidence,revoked_at) VALUES($1,$2,$3,'fan-preferences-v1',$4,$5::jsonb,CASE WHEN $4 THEN NULL ELSE now() END)",[tenant.creatorId,fan.id,key,granted,JSON.stringify({method:"fan_account_preferences"})]);});return NextResponse.redirect(new URL("/fan/account?notice=preferences-saved",request.url),303);
}
