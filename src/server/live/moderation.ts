"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withAuthorizedCreator } from "@/src/modules/auth/authorization";
import { requireCreatorFeature } from "@/src/modules/entitlements/server";
import type { FormState } from "@/app/components/action-form";

const schema=z.object({creatorId:z.string().uuid(),streamId:z.string().uuid(),fanId:z.string().uuid().optional(),messageId:z.string().uuid().optional(),action:z.enum(["mute","unmute","block","unblock","delete_message"]),reason:z.string().trim().max(1000).optional()});
export async function liveModerationAction(_state:FormState,form:FormData):Promise<FormState>{
  const parsed=schema.safeParse(Object.fromEntries(form));if(!parsed.success)return{ok:false,message:"Invalid moderation request."};
  const d=parsed.data;
  try{
    await withAuthorizedCreator(d.creatorId,async(client,actor,role)=>{
      if(!["owner","admin","platform_admin"].includes(role))throw new Error("ROLE_DENIED");
      await requireCreatorFeature(client,d.creatorId,"live");
      if(["mute","unmute","block","unblock"].includes(d.action)&&!d.fanId)throw new Error("FAN_REQUIRED");
      if(d.action==="delete_message"&&!d.messageId)throw new Error("MESSAGE_REQUIRED");
      if(["mute","unmute"].includes(d.action)){
        await client.query("INSERT INTO live_moderation_actions(creator_id,stream_id,actor_user_id,fan_id,action,reason) VALUES($1,$2,$3,$4,$5,$6)",[d.creatorId,d.streamId,actor.id,d.fanId,d.action,d.reason??null]);
      }else if(d.action==="block"){
        await client.query("INSERT INTO blocked_users(creator_id,fan_id,reason) VALUES($1,$2,$3)",[d.creatorId,d.fanId,d.reason||"Blocked by creator moderator"]);
        await client.query("INSERT INTO live_moderation_actions(creator_id,stream_id,actor_user_id,fan_id,action,reason) VALUES($1,$2,$3,$4,'block',$5)",[d.creatorId,d.streamId,actor.id,d.fanId,d.reason??null]);
        await client.query("UPDATE live_admissions SET revoked_at=now() WHERE creator_id=$1 AND stream_id=$2 AND fan_id=$3 AND revoked_at IS NULL",[d.creatorId,d.streamId,d.fanId]);
      }else if(d.action==="unblock"){
        await client.query("UPDATE blocked_users SET expires_at=now() WHERE creator_id=$1 AND fan_id=$2 AND (expires_at IS NULL OR expires_at>now())",[d.creatorId,d.fanId]);
        await client.query("INSERT INTO live_moderation_actions(creator_id,stream_id,actor_user_id,fan_id,action,reason) VALUES($1,$2,$3,$4,'unblock',$5)",[d.creatorId,d.streamId,actor.id,d.fanId,d.reason??null]);
      }else{
        const message=(await client.query<{fan_id:string|null}>("UPDATE live_chat_messages SET status='deleted' WHERE creator_id=$1 AND stream_id=$2 AND id=$3 RETURNING fan_id",[d.creatorId,d.streamId,d.messageId])).rows[0];if(!message)throw new Error("MESSAGE_NOT_FOUND");
        await client.query("INSERT INTO live_moderation_actions(creator_id,stream_id,actor_user_id,fan_id,action,reason) VALUES($1,$2,$3,$4,'delete_message',$5)",[d.creatorId,d.streamId,actor.id,message.fan_id,d.reason??null]);
      }
    });
  }catch(error){console.error("Moderation failed",{creatorId:d.creatorId,streamId:d.streamId,message:error instanceof Error?error.message:"unknown"});return{ok:false,message:"Moderation action could not be completed."};}
  revalidatePath(`/dashboard/${d.creatorId}/livestreams`);return{ok:true,message:"Moderation updated."};
}
