import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { requestTenant } from "@/src/server/fans/request";
import { getCurrentFan } from "@/src/modules/auth/fan-session";
import { withCreator } from "@/src/server/db/scoped";

const allowed=new Set(["page_view","content_view","membership_view","checkout_started","livestream_view"]);
const schema=z.object({event:z.string().min(1).max(80),path:z.string().max(1000).optional(),contentId:z.string().uuid().optional(),properties:z.record(z.string(),z.union([z.string(),z.number(),z.boolean(),z.null()])).optional(),utmSource:z.string().max(255).optional(),utmMedium:z.string().max(255).optional(),utmCampaign:z.string().max(255).optional(),referralSource:z.string().max(500).optional()});

export async function POST(request:Request){
  const tenant=await requestTenant(request);if(!tenant)return new NextResponse(null,{status:404});
  let raw:unknown;try{raw=await request.json();}catch{return NextResponse.json({error:"invalid_json"},{status:400});}
  const parsed=schema.safeParse(raw);if(!parsed.success||!allowed.has(parsed.data.event))return NextResponse.json({error:"invalid_event"},{status:400});
  const jar=await cookies();let anonymousId=jar.get("redlight_anon")?.value;if(!anonymousId)anonymousId=randomUUID();
  const fan=await getCurrentFan();
  await withCreator(tenant.creatorId,client=>client.query(`INSERT INTO analytics_events(creator_id,fan_id,anonymous_id,session_id,event_name,path,content_id,source,utm_source,utm_medium,utm_campaign,referral_source,properties)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,[tenant.creatorId,fan?.creatorId===tenant.creatorId?fan.id:null,anonymousId,jar.get("redlight_session_anon")?.value??anonymousId,parsed.data.event,parsed.data.path??null,parsed.data.contentId??null,request.headers.get("referer"),parsed.data.utmSource??null,parsed.data.utmMedium??null,parsed.data.utmCampaign??null,parsed.data.referralSource??null,JSON.stringify(parsed.data.properties??{})]));
  const response=NextResponse.json({ok:true},{status:202});if(!jar.get("redlight_anon"))response.cookies.set("redlight_anon",anonymousId,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:60*60*24*365});
  return response;
}
