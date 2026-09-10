"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withAuthorizedCreator } from "@/src/modules/auth/authorization";
import { withCreator, withRuntime } from "@/src/server/db/scoped";
import { dispatchAutomationEvent } from "@/src/server/automation/service";
import type { FormState } from "@/app/components/action-form";

const schema=z.object({
  creatorId:z.string().uuid(),postId:z.string().uuid(),operation:z.enum(["edit","publish","schedule","archive","restore","attach","detach"]),
  title:z.string().trim().max(200).optional(),body:z.string().trim().max(20000).optional(),scheduledFor:z.string().trim().optional(),mediaAssetId:z.string().uuid().optional(),position:z.coerce.number().int().min(0).max(500).optional(),
});
const roles=new Set(["owner","admin","editor","platform_admin"]);
async function assertNotHeld(client:import("pg").PoolClient,creatorId:string,postId:string){const held=await client.query("SELECT 1 FROM content_holds WHERE creator_id=$1 AND post_id=$2 AND status='active' LIMIT 1",[creatorId,postId]);if(held.rowCount)throw new Error("CONTENT_HELD");}
export async function contentAction(_state:FormState,form:FormData):Promise<FormState>{
  const parsed=schema.safeParse(Object.fromEntries(form));if(!parsed.success)return{ok:false,message:"Invalid content request."};const d=parsed.data;
  try{await withAuthorizedCreator(d.creatorId,async(client,actor,role)=>{
    if(!roles.has(role))throw new Error("ROLE_DENIED");const post=(await client.query<{status:string}>("SELECT status FROM content_posts WHERE creator_id=$1 AND id=$2 FOR UPDATE",[d.creatorId,d.postId])).rows[0];if(!post)throw new Error("POST_NOT_FOUND");
    if(d.operation==="edit"){await client.query("UPDATE content_posts SET title=coalesce($3,title),body=coalesce($4,body),last_edited_at=now(),updated_at=now() WHERE creator_id=$1 AND id=$2",[d.creatorId,d.postId,d.title??null,d.body??null]);}
    else if(d.operation==="publish"){await assertNotHeld(client,d.creatorId,d.postId);await client.query("UPDATE content_posts SET status='published',published_at=coalesce(published_at,now()),scheduled_for=NULL,archived_at=NULL,updated_at=now() WHERE creator_id=$1 AND id=$2",[d.creatorId,d.postId]);await dispatchAutomationEvent(client,{key:"content.published",creatorId:d.creatorId,payload:{postId:d.postId},occurredAt:new Date()});}
    else if(d.operation==="schedule"){await assertNotHeld(client,d.creatorId,d.postId);const when=d.scheduledFor?new Date(d.scheduledFor):null;if(!when||Number.isNaN(when.getTime())||when.getTime()<=Date.now())throw new Error("INVALID_SCHEDULE");await client.query("UPDATE content_posts SET status='scheduled',scheduled_for=$3,archived_at=NULL,updated_at=now() WHERE creator_id=$1 AND id=$2",[d.creatorId,d.postId,when]);}
    else if(d.operation==="archive"){await client.query("UPDATE content_posts SET status='archived',archived_at=now(),scheduled_for=NULL,updated_at=now() WHERE creator_id=$1 AND id=$2",[d.creatorId,d.postId]);}
    else if(d.operation==="restore"){await client.query("UPDATE content_posts SET status='draft',archived_at=NULL,scheduled_for=NULL,updated_at=now() WHERE creator_id=$1 AND id=$2",[d.creatorId,d.postId]);}
    else if(d.operation==="attach"){if(!d.mediaAssetId)throw new Error("MEDIA_REQUIRED");const asset=(await client.query("SELECT 1 FROM media_assets WHERE creator_id=$1 AND id=$2 AND status='ready' AND deleted_at IS NULL",[d.creatorId,d.mediaAssetId])).rowCount;if(!asset)throw new Error("MEDIA_NOT_READY");await client.query("INSERT INTO post_media(creator_id,post_id,media_asset_id,position) VALUES($1,$2,$3,$4) ON CONFLICT(creator_id,post_id,media_asset_id) DO UPDATE SET position=excluded.position",[d.creatorId,d.postId,d.mediaAssetId,d.position??0]);}
    else {if(!d.mediaAssetId)throw new Error("MEDIA_REQUIRED");await client.query("DELETE FROM post_media WHERE creator_id=$1 AND post_id=$2 AND media_asset_id=$3",[d.creatorId,d.postId,d.mediaAssetId]);}
    await client.query("INSERT INTO audit_logs(actor_user_id,creator_id,action,target_type,target_id) VALUES($1,$2,$3,'content_post',$4)",[actor.id,d.creatorId,`content.${d.operation}`,d.postId]);
  });}catch(error){const m=error instanceof Error?error.message:"";return{ok:false,message:m==="CONTENT_HELD"?"This content is under an active platform hold and cannot be published or scheduled.":m==="INVALID_SCHEDULE"?"Choose a future publish time.":m==="MEDIA_NOT_READY"?"Only verified, ready media can be attached.":"Content update could not be completed."};}
  revalidatePath(`/dashboard/${d.creatorId}/content`);revalidatePath(`/dashboard/${d.creatorId}/content/${d.postId}`);return{ok:true,message:"Content updated."};
}

export async function processScheduledContent(limit=25){
  const rows=await withRuntime(async client=>(await client.query<{post_id:string;creator_id:string}>("SELECT post_id,creator_id FROM publish_due_content($1)",[Math.max(1,Math.min(limit,100))])).rows);
  for(const row of rows){await withCreator(row.creator_id,async client=>{await client.query("INSERT INTO analytics_events(creator_id,event_name,content_id,properties) VALUES($1,'content_published',$2,$3::jsonb)",[row.creator_id,row.post_id,JSON.stringify({scheduled:true})]);await dispatchAutomationEvent(client,{key:"content.published",creatorId:row.creator_id,payload:{postId:row.post_id,scheduled:true},occurredAt:new Date()});});}
  return rows.length;
}
