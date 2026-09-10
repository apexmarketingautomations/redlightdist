import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
export async function consumePlatformRateLimit(client:PoolClient,input:{scope:string;key:string;limit:number;windowSeconds:number;blockSeconds?:number}){
  const keyHash=hash(input.key);await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`${input.scope}:${keyHash}`]);
  const row=(await client.query<{window_start:Date;attempts:number;blocked_until:Date|null}>("SELECT window_start,attempts,blocked_until FROM platform_auth_rate_limits WHERE scope=$1 AND key_hash=$2 FOR UPDATE",[input.scope,keyHash])).rows[0];const now=Date.now();
  if(row?.blocked_until&&row.blocked_until.getTime()>now)return{allowed:false,retryAfterSeconds:Math.ceil((row.blocked_until.getTime()-now)/1000)};
  const expired=!row||now-row.window_start.getTime()>=input.windowSeconds*1000;const attempts=expired?1:row.attempts+1;const blocked=attempts>input.limit;const until=blocked?new Date(now+(input.blockSeconds??input.windowSeconds)*1000):null;
  await client.query(`INSERT INTO platform_auth_rate_limits(scope,key_hash,window_start,attempts,blocked_until,updated_at) VALUES($1,$2,now(),$3,$4,now())
    ON CONFLICT(scope,key_hash) DO UPDATE SET window_start=CASE WHEN platform_auth_rate_limits.window_start<=now()-($5::text||' seconds')::interval THEN now() ELSE platform_auth_rate_limits.window_start END,attempts=$3,blocked_until=$4,updated_at=now()`,[input.scope,keyHash,attempts,until,input.windowSeconds]);
  return{allowed:!blocked,retryAfterSeconds:blocked?input.blockSeconds??input.windowSeconds:0};
}
export async function clearPlatformRateLimit(client:PoolClient,scope:string,key:string){await client.query("DELETE FROM platform_auth_rate_limits WHERE scope=$1 AND key_hash=$2",[scope,hash(key)]);}
