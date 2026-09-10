import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { cookies } from "next/headers";
import { requestTenant } from "@/src/server/fans/request";
import { getCurrentFan } from "@/src/modules/auth/fan-session";
import { withCreator } from "@/src/server/db/scoped";
import { canFanAccessStream } from "@/src/server/live/access";
import { ensureLiveProvidersRegistered } from "@/src/modules/live/register";
import { getLiveProvider } from "@/src/modules/live/provider";

export async function GET(request:Request,{params}:{params:Promise<{streamId:string}>}){
  const tenant=await requestTenant(request);if(!tenant)return new NextResponse("Tenant not found",{status:404});
  const {streamId}=await params;if(!z.string().uuid().safeParse(streamId).success)return new NextResponse("Not found",{status:404});
  const ageGate=await withCreator(tenant.creatorId,async client=>(await client.query<{age_gate_enabled:boolean}>("SELECT age_gate_enabled FROM creator_settings WHERE creator_id=$1",[tenant.creatorId])).rows[0]?.age_gate_enabled??true);
  if(ageGate&&(await cookies()).get("creator_age_gate")?.value!=="accepted")return NextResponse.json({error:"age_gate_required"},{status:403});
  const fan=await getCurrentFan();
  try{
    const result=await withCreator(tenant.creatorId,async client=>{
      const stream=(await client.query<{provider:string;provider_stream_id:string|null;status:string;chat_enabled:boolean}>("SELECT provider,provider_stream_id,status,chat_enabled FROM live_streams WHERE creator_id=$1 AND id=$2",[tenant.creatorId,streamId])).rows[0];
      if(!stream||stream.status!=="live"||!stream.provider_stream_id)return null;
      const decision=await canFanAccessStream(client,{creatorId:tenant.creatorId,streamId,fanId:fan?.creatorId===tenant.creatorId?fan.id:null});
      if(!decision.allowed)return{denied:true as const};
      const identity=fan?.creatorId===tenant.creatorId?`fan:${fan.id}`:`anon:${randomUUID()}`;
      ensureLiveProvidersRegistered();const provider=getLiveProvider(stream.provider);
      const grant=await provider.createPlaybackToken({providerStreamId:stream.provider_stream_id,viewerId:identity,canPublish:false,ttlSeconds:600});
      await client.query("INSERT INTO live_participants(creator_id,stream_id,fan_id,participant_key,role) VALUES($1,$2,$3,$4,'viewer')",[tenant.creatorId,streamId,fan?.creatorId===tenant.creatorId?fan.id:null,identity]);
      const unique=Number((await client.query<{count:string}>("SELECT count(DISTINCT coalesce(fan_id::text,participant_key))::text AS count FROM live_participants WHERE creator_id=$1 AND stream_id=$2",[tenant.creatorId,streamId])).rows[0]?.count??0);
      const current=await provider.getViewerCount(stream.provider_stream_id).catch(()=>0);
      await client.query("INSERT INTO live_analytics_samples(creator_id,stream_id,concurrent_viewers,unique_viewers) VALUES($1,$2,$3,$4)",[tenant.creatorId,streamId,current,unique]);
      return{denied:false as const,grant,identity,chatEnabled:stream.chat_enabled,accessSource:decision.source};
    });
    if(!result)return NextResponse.json({error:"stream_not_live"},{status:404});
    if(result.denied)return NextResponse.json({error:"access_required"},{status:403});
    return NextResponse.json({token:result.grant.token,url:result.grant.playbackUrl,expiresAt:result.grant.expiresAt.toISOString(),identity:result.identity,chatEnabled:result.chatEnabled,accessSource:result.accessSource},{headers:{"cache-control":"no-store"}});
  }catch(error){console.error("Viewer token failed",{creatorId:tenant.creatorId,streamId,message:error instanceof Error?error.message:"unknown"});return NextResponse.json({error:"stream_unavailable"},{status:503});}
}
