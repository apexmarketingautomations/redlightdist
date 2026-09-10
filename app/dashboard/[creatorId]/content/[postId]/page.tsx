import { notFound } from "next/navigation";
import { z } from "zod";
import { CreatorShell } from "@/app/components/creator-shell";
import { ActionForm } from "@/app/components/action-form";
import { withAuthorizedCreator } from "@/src/modules/auth/authorization";
import { loadCreatorEntitlements } from "@/src/modules/entitlements/server";
import { contentAction } from "@/src/server/content/operations";

const when=(v:Date|string|null)=>v?new Date(v).toLocaleString():"—";
export default async function ContentDetailPage({params}:{params:Promise<{creatorId:string;postId:string}>}){
  const {creatorId,postId}=await params;if(!z.string().uuid().safeParse(creatorId).success||!z.string().uuid().safeParse(postId).success)notFound();
  const data=await withAuthorizedCreator(creatorId,async(client,_actor,role)=>{
    const creator=(await client.query<{name:string}>("SELECT name FROM creators WHERE id=$1 AND deleted_at IS NULL",[creatorId])).rows[0];
    const post=(await client.query<{id:string;title:string|null;body:string;post_type:string;status:string;access_type:string;scheduled_for:Date|null;published_at:Date|null;archived_at:Date|null;updated_at:Date}>("SELECT id,title,body,post_type,status,access_type,scheduled_for,published_at,archived_at,updated_at FROM content_posts WHERE creator_id=$1 AND id=$2",[creatorId,postId])).rows[0];if(!creator||!post)return null;
    const ent=await loadCreatorEntitlements(client,creatorId);
    const attached=(await client.query<{id:string;kind:string;original_filename:string|null;byte_size:string;position:number}>("SELECT m.id,m.kind,m.original_filename,m.byte_size::text,pm.position FROM post_media pm JOIN media_assets m ON m.creator_id=pm.creator_id AND m.id=pm.media_asset_id WHERE pm.creator_id=$1 AND pm.post_id=$2 ORDER BY pm.position,m.created_at",[creatorId,postId])).rows;
    const assets=(await client.query<{id:string;kind:string;original_filename:string|null;byte_size:string}>("SELECT id,kind,original_filename,byte_size::text FROM media_assets WHERE creator_id=$1 AND status='ready' AND deleted_at IS NULL AND id NOT IN (SELECT media_asset_id FROM post_media WHERE creator_id=$1 AND post_id=$2) ORDER BY created_at DESC LIMIT 100",[creatorId,postId])).rows;
    const hold=(await client.query<{reason:string;placed_at:Date}>("SELECT reason,placed_at FROM content_holds WHERE creator_id=$1 AND post_id=$2 AND status='active' LIMIT 1",[creatorId,postId])).rows[0];
    return{creator,post,role,plan:ent.plan,attached,assets,hold};
  });if(!data)notFound();
  return <CreatorShell creatorId={creatorId} creatorName={data.creator.name} plan={data.plan.toUpperCase()} section="content" admin={data.role==="platform_admin"}>
    <div className="office-heading"><a href={`/dashboard/${creatorId}/content`}>← Content</a><h1>{data.post.title||"Untitled post"}</h1><p>{data.post.post_type} · {data.post.access_type} · {data.post.status}</p></div>
    {data.hold&&<section className="office-panel feature-lock"><h2>Platform hold active</h2><p>{data.hold.reason}</p><small>Placed {when(data.hold.placed_at)}. Publishing and scheduling are blocked until an administrator releases the hold.</small></section>}
    <section className="office-panel"><h2>Edit</h2><ActionForm action={contentAction} label="Save changes"><input type="hidden" name="creatorId" value={creatorId}/><input type="hidden" name="postId" value={postId}/><input type="hidden" name="operation" value="edit"/><label>Title<input name="title" defaultValue={data.post.title??""}/></label><label>Body<textarea name="body" rows={8} defaultValue={data.post.body}/></label></ActionForm></section>
    <section className="office-panel"><h2>Lifecycle</h2><p>Published {when(data.post.published_at)} · scheduled {when(data.post.scheduled_for)} · archived {when(data.post.archived_at)} · updated {when(data.post.updated_at)}</p><div className="creator-inline-actions">
      {data.post.status!=="published"&&<ActionForm action={contentAction} label="Publish now"><input type="hidden" name="creatorId" value={creatorId}/><input type="hidden" name="postId" value={postId}/><input type="hidden" name="operation" value="publish"/></ActionForm>}
      {data.post.status!=="archived"&&<ActionForm action={contentAction} label="Archive"><input type="hidden" name="creatorId" value={creatorId}/><input type="hidden" name="postId" value={postId}/><input type="hidden" name="operation" value="archive"/></ActionForm>}
      {data.post.status==="archived"&&<ActionForm action={contentAction} label="Restore draft"><input type="hidden" name="creatorId" value={creatorId}/><input type="hidden" name="postId" value={postId}/><input type="hidden" name="operation" value="restore"/></ActionForm>}
    </div><ActionForm action={contentAction} label="Schedule publication"><input type="hidden" name="creatorId" value={creatorId}/><input type="hidden" name="postId" value={postId}/><input type="hidden" name="operation" value="schedule"/><label>Publish at<input type="datetime-local" name="scheduledFor" required/></label></ActionForm></section>
    <div className="office-columns"><section className="office-panel"><h2>Attached media</h2>{data.attached.length?data.attached.map(a=><div className="office-row compact" key={a.id}><div><strong>{a.original_filename||a.id}</strong><small>{a.kind} · {(Number(a.byte_size)/1048576).toFixed(1)} MB</small></div><ActionForm action={contentAction} label="Detach"><input type="hidden" name="creatorId" value={creatorId}/><input type="hidden" name="postId" value={postId}/><input type="hidden" name="mediaAssetId" value={a.id}/><input type="hidden" name="operation" value="detach"/></ActionForm></div>):<p>No media attached.</p>}</section><section className="office-panel"><h2>Media library</h2>{data.assets.length?data.assets.map(a=><div className="office-row compact" key={a.id}><div><strong>{a.original_filename||a.id}</strong><small>{a.kind} · {(Number(a.byte_size)/1048576).toFixed(1)} MB</small></div><ActionForm action={contentAction} label="Attach"><input type="hidden" name="creatorId" value={creatorId}/><input type="hidden" name="postId" value={postId}/><input type="hidden" name="mediaAssetId" value={a.id}/><input type="hidden" name="operation" value="attach"/></ActionForm></div>):<p>No unattached ready media.</p>}</section></div>
  </CreatorShell>;
}
