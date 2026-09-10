"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withAuthorizedCreator } from "@/src/modules/auth/authorization";
import { requireCreatorFeature } from "@/src/modules/entitlements/server";
import { ensureLiveProvidersRegistered } from "@/src/modules/live/register";
import { getLiveProvider } from "@/src/modules/live/provider";
import type { FormState } from "@/app/components/action-form";

const schema=z.object({creatorId:z.string().uuid(),streamId:z.string().uuid(),operation:z.enum(["start","end"])});
const allowed=new Set(["owner","admin","editor","platform_admin"]);

export async function liveStreamAction(_state:FormState,form:FormData):Promise<FormState>{
  const parsed=schema.safeParse(Object.fromEntries(form));if(!parsed.success)return{ok:false,message:"Invalid livestream request."};
  const data=parsed.data;
  try{
    await withAuthorizedCreator(data.creatorId,async(client,actor,role)=>{
      if(!allowed.has(role))throw new Error("ROLE_DENIED");
      await requireCreatorFeature(client,data.creatorId,"live");
      const stream=(await client.query<{provider:string;provider_stream_id:string|null;title:string;scheduled_for:Date|null;status:string}>("SELECT provider,provider_stream_id,title,scheduled_for,status FROM live_streams WHERE creator_id=$1 AND id=$2 FOR UPDATE",[data.creatorId,data.streamId])).rows[0];
      if(!stream)throw new Error("STREAM_NOT_FOUND");
      ensureLiveProvidersRegistered();
      const provider=getLiveProvider(stream.provider==="unconfigured"?"livekit":stream.provider);
      if(data.operation==="start"){
        if(!["scheduled","draft"].includes(stream.status))throw new Error("STREAM_NOT_STARTABLE");
        let providerId=stream.provider_stream_id;
        if(!providerId){
          const handle=await provider.createStream({creatorId:data.creatorId,streamId:data.streamId,title:stream.title,scheduledFor:stream.scheduled_for,recordingEnabled:false});providerId=handle.providerStreamId;
        }
        await provider.startStream(providerId);
        await client.query("UPDATE live_streams SET provider=$3,provider_stream_id=$4,status='live',started_at=now(),updated_at=now() WHERE creator_id=$1 AND id=$2",[data.creatorId,data.streamId,provider.name,providerId]);
        await client.query("INSERT INTO analytics_events(creator_id,event_name,content_id,properties) VALUES($1,'livestream_started',$2,$3::jsonb)",[data.creatorId,data.streamId,JSON.stringify({actorUserId:actor.id})]);
      }else{
        if(stream.status!=="live")throw new Error("STREAM_NOT_LIVE");
        if(stream.provider_stream_id)await provider.endStream(stream.provider_stream_id);
        await client.query("UPDATE live_streams SET status='ended',ended_at=now(),updated_at=now() WHERE creator_id=$1 AND id=$2",[data.creatorId,data.streamId]);
        await client.query("UPDATE live_admissions SET revoked_at=coalesce(revoked_at,now()) WHERE creator_id=$1 AND stream_id=$2",[data.creatorId,data.streamId]);
        await client.query("INSERT INTO analytics_events(creator_id,event_name,content_id,properties) VALUES($1,'livestream_ended',$2,$3::jsonb)",[data.creatorId,data.streamId,JSON.stringify({actorUserId:actor.id})]);
      }
    });
  }catch(error){
    const message=error instanceof Error?error.message:"";console.error("Livestream operation failed",{creatorId:data.creatorId,streamId:data.streamId,message});
    return{ok:false,message:message==="LIVEKIT_NOT_CONFIGURED"?"Livestream provider credentials are not configured.":"Livestream operation could not be completed."};
  }
  revalidatePath(`/dashboard/${data.creatorId}/livestreams`);return{ok:true,message:data.operation==="start"?"Stream is live.":"Stream ended."};
}
