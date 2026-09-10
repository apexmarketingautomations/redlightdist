import { NextResponse } from "next/server";
import { z } from "zod";
import { requestTenant } from "@/src/server/fans/request";
import { getCurrentFan } from "@/src/modules/auth/fan-session";
import { withCreator } from "@/src/server/db/scoped";
import { canFanAccessStream } from "@/src/server/live/access";

const uuid=z.string().uuid();
export async function GET(request:Request,{params}:{params:Promise<{streamId:string}>}){
  const tenant=await requestTenant(request);if(!tenant)return new NextResponse("Tenant not found",{status:404});
  const {streamId}=await params;if(!uuid.safeParse(streamId).success)return new NextResponse("Not found",{status:404});
  const fan=await getCurrentFan();
  const result=await withCreator(tenant.creatorId,async client=>{
    const stream=(await client.query<{chat_enabled:boolean}>("SELECT chat_enabled FROM live_streams WHERE creator_id=$1 AND id=$2 AND status='live'",[tenant.creatorId,streamId])).rows[0];
    if(!stream?.chat_enabled)return null;
    const decision=await canFanAccessStream(client,{creatorId:tenant.creatorId,streamId,fanId:fan?.creatorId===tenant.creatorId?fan.id:null});if(!decision.allowed)return null;
    return (await client.query<{id:string;fan_id:string|null;body:string;created_at:Date}>("SELECT id,fan_id,body,created_at FROM live_chat_messages WHERE creator_id=$1 AND stream_id=$2 AND status='visible' ORDER BY created_at DESC LIMIT 100",[tenant.creatorId,streamId])).rows.reverse();
  });
  if(!result)return NextResponse.json({error:"chat_unavailable"},{status:403});
  return NextResponse.json({messages:result},{headers:{"cache-control":"no-store"}});
}

export async function POST(request:Request,{params}:{params:Promise<{streamId:string}>}){
  const tenant=await requestTenant(request);if(!tenant)return new NextResponse("Tenant not found",{status:404});
  const {streamId}=await params;if(!uuid.safeParse(streamId).success)return new NextResponse("Not found",{status:404});
  const fan=await getCurrentFan();if(!fan||fan.creatorId!==tenant.creatorId)return NextResponse.json({error:"login_required"},{status:401});
  let body:unknown;try{body=await request.json();}catch{return NextResponse.json({error:"invalid_json"},{status:400});}
  const parsed=z.object({body:z.string().trim().min(1).max(2000)}).safeParse(body);if(!parsed.success)return NextResponse.json({error:"invalid_message"},{status:400});
  const result=await withCreator(tenant.creatorId,async client=>{
    const stream=(await client.query<{chat_enabled:boolean}>("SELECT chat_enabled FROM live_streams WHERE creator_id=$1 AND id=$2 AND status='live'",[tenant.creatorId,streamId])).rows[0];if(!stream?.chat_enabled)return null;
    const decision=await canFanAccessStream(client,{creatorId:tenant.creatorId,streamId,fanId:fan.id});if(!decision.allowed)return null;
    const blocked=await client.query("SELECT 1 FROM blocked_users WHERE creator_id=$1 AND fan_id=$2 AND (expires_at IS NULL OR expires_at>now()) LIMIT 1",[tenant.creatorId,fan.id]);if(blocked.rowCount)return{blocked:true as const};
    const muted=await client.query("SELECT 1 FROM live_moderation_actions WHERE creator_id=$1 AND stream_id=$2 AND fan_id=$3 AND action='mute' AND (expires_at IS NULL OR expires_at>now()) AND NOT EXISTS(SELECT 1 FROM live_moderation_actions u WHERE u.creator_id=$1 AND u.stream_id=$2 AND u.fan_id=$3 AND u.action='unmute' AND u.created_at>live_moderation_actions.created_at) LIMIT 1",[tenant.creatorId,streamId,fan.id]);if(muted.rowCount)return{blocked:true as const};
    const message=(await client.query<{id:string;created_at:Date}>("INSERT INTO live_chat_messages(creator_id,stream_id,fan_id,body) VALUES($1,$2,$3,$4) RETURNING id,created_at",[tenant.creatorId,streamId,fan.id,parsed.data.body])).rows[0]!;
    return{blocked:false as const,message};
  });
  if(!result)return NextResponse.json({error:"chat_unavailable"},{status:403});
  if(result.blocked)return NextResponse.json({error:"chat_restricted"},{status:403});
  return NextResponse.json({ok:true,id:result.message.id,createdAt:result.message.created_at.toISOString()},{status:201});
}
