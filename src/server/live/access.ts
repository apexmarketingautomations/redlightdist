import "server-only";
import type { PoolClient } from "pg";

export type LiveAccessDecision={allowed:boolean;source:"public"|"subscription"|"membership"|"purchase"|"admin"|"denied"};

export async function canFanAccessStream(client:PoolClient,input:{creatorId:string;streamId:string;fanId?:string|null}):Promise<LiveAccessDecision>{
  const stream=(await client.query<{access_type:string;membership_tier_id:string|null;status:string}>("SELECT access_type,membership_tier_id,status FROM live_streams WHERE creator_id=$1 AND id=$2 AND status IN ('scheduled','live')",[input.creatorId,input.streamId])).rows[0];
  if(!stream)return{allowed:false,source:"denied"};
  if(stream.access_type==="public")return{allowed:true,source:"public"};
  if(!input.fanId)return{allowed:false,source:"denied"};
  const existing=(await client.query<{access_source:string}>("SELECT access_source FROM live_admissions WHERE creator_id=$1 AND stream_id=$2 AND fan_id=$3 AND revoked_at IS NULL",[input.creatorId,input.streamId,input.fanId])).rows[0];
  if(existing)return{allowed:true,source:existing.access_source as LiveAccessDecision["source"]};
  const sub=(await client.query<{membership_tier_id:string}>(`SELECT membership_tier_id FROM creator_subscriptions WHERE creator_id=$1 AND fan_id=$2 AND status IN ('active','trialing')
    AND (current_period_ends_at IS NULL OR current_period_ends_at>now()) ORDER BY created_at DESC LIMIT 1`,[input.creatorId,input.fanId])).rows[0];
  if(stream.access_type==="subscriber"&&sub){
    await client.query("INSERT INTO live_admissions(creator_id,stream_id,fan_id,access_source) VALUES($1,$2,$3,'subscription') ON CONFLICT(creator_id,stream_id,fan_id) DO UPDATE SET revoked_at=NULL,access_source='subscription'",[input.creatorId,input.streamId,input.fanId]);
    return{allowed:true,source:"subscription"};
  }
  if(stream.access_type==="membership"&&sub&&stream.membership_tier_id===sub.membership_tier_id){
    await client.query("INSERT INTO live_admissions(creator_id,stream_id,fan_id,access_source) VALUES($1,$2,$3,'membership') ON CONFLICT(creator_id,stream_id,fan_id) DO UPDATE SET revoked_at=NULL,access_source='membership'",[input.creatorId,input.streamId,input.fanId]);
    return{allowed:true,source:"membership"};
  }
  if(stream.access_type==="ppv"){
    const purchase=(await client.query<{id:string}>(`SELECT p.id FROM purchases p JOIN products pr ON pr.creator_id=p.creator_id AND pr.id=p.product_id
      WHERE p.creator_id=$1 AND p.fan_id=$2 AND p.status='paid' AND pr.product_type='livestream' AND pr.metadata->>'streamId'=$3 LIMIT 1`,[input.creatorId,input.fanId,input.streamId])).rows[0];
    if(purchase){
      await client.query("INSERT INTO live_admissions(creator_id,stream_id,fan_id,purchase_id,access_source) VALUES($1,$2,$3,$4,'purchase') ON CONFLICT(creator_id,stream_id,fan_id) DO UPDATE SET purchase_id=excluded.purchase_id,revoked_at=NULL,access_source='purchase'",[input.creatorId,input.streamId,input.fanId,purchase.id]);
      return{allowed:true,source:"purchase"};
    }
  }
  return{allowed:false,source:"denied"};
}
