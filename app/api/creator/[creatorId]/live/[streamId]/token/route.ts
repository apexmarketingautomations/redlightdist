import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthorizedCreator } from "@/src/modules/auth/authorization";
import { requireCreatorFeature } from "@/src/modules/entitlements/server";
import { ensureLiveProvidersRegistered } from "@/src/modules/live/register";
import { getLiveProvider } from "@/src/modules/live/provider";

export async function GET(_request:Request,{params}:{params:Promise<{creatorId:string;streamId:string}>}){
  const {creatorId,streamId}=await params;
  if(!z.string().uuid().safeParse(creatorId).success||!z.string().uuid().safeParse(streamId).success)return new NextResponse("Not found",{status:404});
  try{
    return await withAuthorizedCreator(creatorId,async(client,user,role)=>{
      if(!["owner","admin","editor","platform_admin"].includes(role))return NextResponse.json({error:"forbidden"},{status:403});
      await requireCreatorFeature(client,creatorId,"live");
      const stream=(await client.query<{provider:string;provider_stream_id:string|null;status:string}>("SELECT provider,provider_stream_id,status FROM live_streams WHERE creator_id=$1 AND id=$2",[creatorId,streamId])).rows[0];
      if(!stream||stream.status!=="live"||!stream.provider_stream_id)return NextResponse.json({error:"stream_not_live"},{status:409});
      ensureLiveProvidersRegistered();const provider=getLiveProvider(stream.provider);
      const identity=`creator:${user.id}`;
      const grant=await provider.createPlaybackToken({providerStreamId:stream.provider_stream_id,viewerId:identity,canPublish:true,ttlSeconds:1800});
      await client.query("INSERT INTO live_participants(creator_id,stream_id,participant_key,role) VALUES($1,$2,$3,'cohost')",[creatorId,streamId,identity]);
      return NextResponse.json({token:grant.token,url:grant.playbackUrl,expiresAt:grant.expiresAt.toISOString(),identity},{headers:{"cache-control":"no-store"}});
    });
  }catch(error){console.error("Creator live token failed",{creatorId,streamId,message:error instanceof Error?error.message:"unknown"});return NextResponse.json({error:"stream_unavailable"},{status:503});}
}
