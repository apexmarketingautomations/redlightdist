import type { PoolClient } from "pg";

export interface ContentAccessDecision { allowed: boolean; reason: "public"|"subscription"|"membership"|"purchase"|"denied"; }

/** Must run inside a creator-scoped transaction. Never trust creatorId/fanId supplied by a browser without authenticated server context. */
export async function canFanAccessPost(client: PoolClient, input: {creatorId:string; postId:string; fanId?:string|null}): Promise<ContentAccessDecision> {
  const post=(await client.query<{access_type:string;status:string}>(
    "SELECT access_type,status FROM content_posts WHERE creator_id=$1 AND id=$2 AND status='published' LIMIT 1",
    [input.creatorId,input.postId],
  )).rows[0];
  if(!post) return {allowed:false,reason:"denied"};
  if(post.access_type === "public") return {allowed:true,reason:"public"};
  if(!input.fanId) return {allowed:false,reason:"denied"};

  const activeSubscription=(await client.query<{membership_tier_id:string}>(
    "SELECT membership_tier_id FROM creator_subscriptions WHERE creator_id=$1 AND fan_id=$2 AND status IN ('active','trialing') AND (current_period_ends_at IS NULL OR current_period_ends_at>now()) ORDER BY created_at DESC LIMIT 1",
    [input.creatorId,input.fanId],
  )).rows[0];
  if(post.access_type === "subscriber" && activeSubscription) return {allowed:true,reason:"subscription"};
  if(post.access_type === "membership" && activeSubscription) {
    const match=await client.query(
      "SELECT 1 FROM content_access_rules WHERE creator_id=$1 AND post_id=$2 AND rule_type='membership' AND membership_tier_id=$3 LIMIT 1",
      [input.creatorId,input.postId,activeSubscription.membership_tier_id],
    );
    if(match.rowCount) return {allowed:true,reason:"membership"};
  }
  if(post.access_type === "ppv") {
    const purchased=await client.query(
      "SELECT 1 FROM content_access_rules r JOIN purchases p ON p.creator_id=r.creator_id AND p.product_id=r.product_id WHERE r.creator_id=$1 AND r.post_id=$2 AND r.rule_type='purchase' AND p.fan_id=$3 AND p.status='paid' LIMIT 1",
      [input.creatorId,input.postId,input.fanId],
    );
    if(purchased.rowCount) return {allowed:true,reason:"purchase"};
  }
  return {allowed:false,reason:"denied"};
}

export async function canFanAccessAsset(client: PoolClient, input: {creatorId:string; assetId:string; fanId?:string|null}): Promise<boolean> {
  const asset=(await client.query<{visibility:string;status:string}>("SELECT visibility,status FROM media_assets WHERE creator_id=$1 AND id=$2 AND deleted_at IS NULL LIMIT 1",[input.creatorId,input.assetId])).rows[0];
  if(!asset || asset.status!=="ready") return false;
  if(asset.visibility==="public") return true;
  const post=(await client.query<{id:string}>("SELECT p.id FROM post_media pm JOIN content_posts p ON p.creator_id=pm.creator_id AND p.id=pm.post_id WHERE pm.creator_id=$1 AND pm.media_asset_id=$2 AND p.status='published' ORDER BY p.published_at DESC NULLS LAST LIMIT 1",[input.creatorId,input.assetId])).rows[0];
  if(!post) return false;
  return (await canFanAccessPost(client,{creatorId:input.creatorId,postId:post.id,fanId:input.fanId})).allowed;
}
