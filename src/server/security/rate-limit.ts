import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

export function hashRateLimitKey(value:string):string{return createHash("sha256").update(value).digest("hex");}

export async function consumeTenantRateLimit(client:PoolClient,input:{creatorId:string;scope:string;key:string;limit:number;windowSeconds:number;blockSeconds?:number}):Promise<{allowed:boolean;retryAfterSeconds:number}>{
  const keyHash=hashRateLimitKey(input.key);
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`${input.creatorId}:${input.scope}:${keyHash}`]);
  const row=(await client.query<{window_start:Date;attempts:number;blocked_until:Date|null}>("SELECT window_start,attempts,blocked_until FROM auth_rate_limits WHERE creator_id=$1 AND scope=$2 AND key_hash=$3 FOR UPDATE",[input.creatorId,input.scope,keyHash])).rows[0];
  const now=Date.now();
  if(row?.blocked_until&&row.blocked_until.getTime()>now)return{allowed:false,retryAfterSeconds:Math.max(1,Math.ceil((row.blocked_until.getTime()-now)/1000))};
  const expired=!row||now-row.window_start.getTime()>=input.windowSeconds*1000;
  const attempts=expired?1:row.attempts+1;
  const blocked=attempts>input.limit;
  const blockedUntil=blocked?new Date(now+(input.blockSeconds??input.windowSeconds)*1000):null;
  await client.query(`INSERT INTO auth_rate_limits(creator_id,scope,key_hash,window_start,attempts,blocked_until,updated_at)
    VALUES($1,$2,$3,now(),$4,$5,now()) ON CONFLICT(creator_id,scope,key_hash) DO UPDATE SET
    window_start=CASE WHEN auth_rate_limits.window_start <= now()-($6::text||' seconds')::interval THEN now() ELSE auth_rate_limits.window_start END,
    attempts=$4,blocked_until=$5,updated_at=now()`,[input.creatorId,input.scope,keyHash,attempts,blockedUntil,input.windowSeconds]);
  return{allowed:!blocked,retryAfterSeconds:blocked?input.blockSeconds??input.windowSeconds:0};
}

export async function clearTenantRateLimit(client:PoolClient,input:{creatorId:string;scope:string;key:string}):Promise<void>{
  await client.query("DELETE FROM auth_rate_limits WHERE creator_id=$1 AND scope=$2 AND key_hash=$3",[input.creatorId,input.scope,hashRateLimitKey(input.key)]);
}
