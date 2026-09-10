import { notFound } from "next/navigation";
import { z } from "zod";
import { CreatorShell } from "@/app/components/creator-shell";
import { ActionForm } from "@/app/components/action-form";
import { LiveBroadcaster } from "@/app/components/live-broadcaster";
import { withAuthorizedCreator } from "@/src/modules/auth/authorization";
import { liveStreamAction } from "@/src/server/live/actions";
import { liveModerationAction } from "@/src/server/live/moderation";

const money=(minor:number,currency:string)=>new Intl.NumberFormat("en-US",{style:"currency",currency}).format(minor/100);

export default async function LiveStudioPage({params}:{params:Promise<{creatorId:string;streamId:string}>}){
  const {creatorId,streamId}=await params;
  if(!z.string().uuid().safeParse(creatorId).success||!z.string().uuid().safeParse(streamId).success)notFound();
  const data=await withAuthorizedCreator(creatorId,async(client,_user,role)=>{
    const creator=(await client.query<{name:string;plan:string}>(`SELECT c.name,coalesce(p.name,'Starter') AS plan FROM creators c
      LEFT JOIN creator_plans cp ON cp.creator_id=c.id AND cp.billing_status<>'cancelled'
      LEFT JOIN plans p ON p.id=cp.plan_id WHERE c.id=$1 AND c.deleted_at IS NULL LIMIT 1`,[creatorId])).rows[0];
    const stream=(await client.query<{id:string;title:string;description:string;status:string;access_type:string;provider:string;provider_stream_id:string|null;chat_enabled:boolean;scheduled_for:Date|null;started_at:Date|null;ended_at:Date|null;currency:string;ppv_price_minor:number|null}>("SELECT id,title,description,status,access_type,provider,provider_stream_id,chat_enabled,scheduled_for,started_at,ended_at,currency,ppv_price_minor FROM live_streams WHERE creator_id=$1 AND id=$2",[creatorId,streamId])).rows[0];
    if(!creator||!stream)return null;
    const sample=(await client.query<{concurrent_viewers:number;unique_viewers:string;gross_revenue_minor:string}>("SELECT concurrent_viewers,unique_viewers::text,gross_revenue_minor::text FROM live_analytics_samples WHERE creator_id=$1 AND stream_id=$2 ORDER BY sampled_at DESC LIMIT 1",[creatorId,streamId])).rows[0];
    const revenue=(await client.query<{gross:string;tips:string}>(`SELECT coalesce(sum(t.gross_minor) FILTER (WHERE t.status='settled'),0)::text AS gross,
      coalesce((SELECT sum(amount_minor) FROM tips WHERE creator_id=$1 AND live_stream_id=$2),0)::text AS tips
      FROM transactions t WHERE t.creator_id=$1 AND (t.metadata->>'streamId'=$2::text OR t.id IN (SELECT transaction_id FROM tips WHERE creator_id=$1 AND live_stream_id=$2))`,[creatorId,streamId])).rows[0]!;
    const chat=(await client.query<{id:string;fan_id:string|null;email:string|null;body:string;created_at:Date}>(`SELECT m.id,m.fan_id,f.email,m.body,m.created_at FROM live_chat_messages m LEFT JOIN fans f ON f.creator_id=m.creator_id AND f.id=m.fan_id
      WHERE m.creator_id=$1 AND m.stream_id=$2 AND m.status='visible' ORDER BY m.created_at DESC LIMIT 50`,[creatorId,streamId])).rows;
    return{creator,stream,role,sample,revenue,chat};
  });
  if(!data)notFound();
  const canManage=["owner","admin","editor","platform_admin"].includes(data.role);
  const canModerate=["owner","admin","platform_admin"].includes(data.role);
  return <CreatorShell creatorId={creatorId} creatorName={data.creator.name} plan={data.creator.plan} section="livestreams">
    <div className="creator-console-heading"><div><small>LIVESTREAM STUDIO</small><h1>{data.stream.title}</h1><p>{data.stream.description||"Manage the live event, broadcast, audience and moderation."}</p></div><span className={`creator-status ${data.stream.status}`}>{data.stream.status}</span></div>
    <section className="creator-metric-grid"><article><span>Current viewers</span><strong>{data.sample?.concurrent_viewers??0}</strong></article><article><span>Unique viewers</span><strong>{data.sample?.unique_viewers??"0"}</strong></article><article><span>Live revenue</span><strong>{money(Number(data.revenue.gross||0)+Number(data.revenue.tips||0),data.stream.currency)}</strong></article><article><span>Access</span><strong className="creator-text-metric">{data.stream.access_type}</strong></article></section>
    {canManage&&<section className="creator-card"><div className="creator-card-head"><div><small>STREAM CONTROL</small><h2>Go live</h2></div></div><div className="creator-inline-actions">{["draft","scheduled"].includes(data.stream.status)&&<ActionForm action={liveStreamAction} label="Start stream"><input type="hidden" name="creatorId" value={creatorId}/><input type="hidden" name="streamId" value={streamId}/><input type="hidden" name="operation" value="start"/><p>Creates the provider room and opens broadcasting. Viewers still require server-side admission.</p></ActionForm>}{data.stream.status==="live"&&<ActionForm action={liveStreamAction} label="End stream"><input type="hidden" name="creatorId" value={creatorId}/><input type="hidden" name="streamId" value={streamId}/><input type="hidden" name="operation" value="end"/><p>Ends the provider room and revokes active admissions.</p></ActionForm>}</div></section>}
    {data.stream.status==="live"&&canManage&&<LiveBroadcaster creatorId={creatorId} streamId={streamId}/>} 
    <section className="creator-card"><div className="creator-card-head"><div><small>LIVE CHAT</small><h2>Recent messages</h2></div><span>{data.chat.length}</span></div>{data.chat.length?data.chat.map(message=><article className="creator-list-row" key={message.id}><div><strong>{message.email??"Guest"}</strong><p>{message.body}</p><small>{message.created_at.toLocaleString()}</small></div>{canModerate&&message.fan_id&&<div className="creator-inline-actions"><ActionForm action={liveModerationAction} label="Mute"><input type="hidden" name="creatorId" value={creatorId}/><input type="hidden" name="streamId" value={streamId}/><input type="hidden" name="fanId" value={message.fan_id}/><input type="hidden" name="action" value="mute"/></ActionForm><ActionForm action={liveModerationAction} label="Block"><input type="hidden" name="creatorId" value={creatorId}/><input type="hidden" name="streamId" value={streamId}/><input type="hidden" name="fanId" value={message.fan_id}/><input type="hidden" name="action" value="block"/></ActionForm><ActionForm action={liveModerationAction} label="Delete"><input type="hidden" name="creatorId" value={creatorId}/><input type="hidden" name="streamId" value={streamId}/><input type="hidden" name="messageId" value={message.id}/><input type="hidden" name="action" value="delete_message"/></ActionForm></div>}</article>):<p>No live chat messages yet.</p>}</section>
  </CreatorShell>;
}
