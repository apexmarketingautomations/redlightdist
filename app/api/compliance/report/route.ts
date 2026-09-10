import { NextResponse } from "next/server";
import { z } from "zod";
import { requestTenant } from "@/src/server/fans/request";
import { getCurrentFan } from "@/src/modules/auth/fan-session";
import { withCreator } from "@/src/server/db/scoped";

const schema=z.object({subjectType:z.enum(["content","livestream","user","other"]),subjectId:z.string().trim().min(1).max(255),reason:z.enum(["minor_safety","non_consent","exploitation","trafficking","illegal_content","harassment","copyright","other"]),description:z.string().trim().max(5000).optional()});
export async function POST(request:Request){
  const tenant=await requestTenant(request);if(!tenant)return new NextResponse("Tenant not found",{status:404});
  const parsed=schema.safeParse(Object.fromEntries(await request.formData()));if(!parsed.success)return new NextResponse("Invalid report",{status:400});
  const fan=await getCurrentFan();
  await withCreator(tenant.creatorId,async client=>{
    await client.query("INSERT INTO reports(creator_id,reporter_fan_id,subject_type,subject_id,reason_key,description,status) VALUES($1,$2,$3,$4,$5,$6,'open')",[tenant.creatorId,fan?.creatorId===tenant.creatorId?fan.id:null,parsed.data.subjectType,parsed.data.subjectId,parsed.data.reason,parsed.data.description??null]);
    if(["minor_safety","non_consent","exploitation","trafficking","illegal_content"].includes(parsed.data.reason)){
      await client.query("INSERT INTO platform_alerts(creator_id,severity,alert_key,title,body,metadata) VALUES($1,'critical','safety_report','Urgent creator safety report',$2,$3::jsonb)",[tenant.creatorId,`A ${parsed.data.reason} report requires platform review.`,JSON.stringify({subjectType:parsed.data.subjectType,subjectId:parsed.data.subjectId})]);
    }
  });
  return NextResponse.redirect(new URL("/compliance?reported=1",request.url),303);
}
