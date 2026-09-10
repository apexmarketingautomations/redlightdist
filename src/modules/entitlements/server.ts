import type { PoolClient } from "pg";
import { canUseFeature, quotaFor, type Feature, type Plan, type QuotaFeature, type BillingStatus, type CreatorStatus } from "./policy";

export interface CreatorEntitlementSnapshot {
  plan: Plan;
  billingStatus: BillingStatus;
  creatorStatus: CreatorStatus;
  graceEndsAt?: Date;
  overrides: Partial<Record<Feature,boolean>>;
  quotaOverrides: Partial<Record<QuotaFeature,number>>;
}

export async function loadCreatorEntitlements(client:PoolClient,creatorId:string):Promise<CreatorEntitlementSnapshot>{
  const row=(await client.query<{plan:string;billing_status:string;creator_status:string;grace_ends_at:Date|null}>(
    `SELECT p.code AS plan,cp.billing_status::text,c.status::text AS creator_status,cp.grace_ends_at
       FROM creators c
       LEFT JOIN creator_plans cp ON cp.creator_id=c.id AND cp.billing_status<>'cancelled'
       LEFT JOIN plans p ON p.id=cp.plan_id
      WHERE c.id=$1 AND c.deleted_at IS NULL LIMIT 1`,[creatorId])).rows[0];
  if(!row) throw new Error("CREATOR_NOT_FOUND");
  const overrideRows=(await client.query<{feature_key:string;enabled:boolean|null;limit_value:string|null}>(
    "SELECT feature_key,enabled,limit_value::text FROM feature_overrides WHERE creator_id=$1 AND (expires_at IS NULL OR expires_at>now())",[creatorId])).rows;
  const overrides:Partial<Record<Feature,boolean>>={};
  const quotaOverrides:Partial<Record<QuotaFeature,number>>={};
  for(const item of overrideRows){
    if(item.enabled!==null) (overrides as Record<string,boolean>)[item.feature_key]=item.enabled;
    if(item.limit_value!==null) (quotaOverrides as Record<string,number>)[item.feature_key]=Number(item.limit_value);
  }
  return {
    plan:(row.plan ?? "starter") as Plan,
    billingStatus:(row.billing_status ?? "trialing") as BillingStatus,
    creatorStatus:row.creator_status as CreatorStatus,
    graceEndsAt:row.grace_ends_at ?? undefined,
    overrides,quotaOverrides,
  };
}

export async function requireCreatorFeature(client:PoolClient,creatorId:string,feature:Feature):Promise<void>{
  const snapshot=await loadCreatorEntitlements(client,creatorId);
  if(!canUseFeature({...snapshot,feature,now:new Date()})) throw new Error(`FEATURE_NOT_AVAILABLE:${feature}`);
}

export async function creatorQuota(client:PoolClient,creatorId:string,quota:QuotaFeature):Promise<number>{
  const snapshot=await loadCreatorEntitlements(client,creatorId);
  return quotaFor({plan:snapshot.plan,quota,override:snapshot.quotaOverrides[quota]});
}
