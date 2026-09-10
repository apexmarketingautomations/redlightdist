import "server-only";
import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { resolveCreatorIdForHost } from "@/src/modules/tenants/server";
import { withCreator } from "@/src/server/db/scoped";

export const FAN_SESSION_COOKIE="redlight_fan_session";
export function hashFanSessionToken(token:string){return createHash("sha256").update(token).digest("hex");}

export interface CurrentFan { id:string;creatorId:string;email:string; }
export async function getCurrentFan():Promise<CurrentFan|null>{
  const host=(await headers()).get("host")??"";
  const creatorId=await resolveCreatorIdForHost(host); if(!creatorId)return null;
  const token=(await cookies()).get(FAN_SESSION_COOKIE)?.value; if(!token)return null;
  return withCreator(creatorId,async client=>{
    const row=(await client.query<{id:string;email:string}>(`SELECT f.id,f.email FROM fan_sessions s JOIN fans f ON f.creator_id=s.creator_id AND f.id=s.fan_id
      WHERE s.creator_id=$1 AND s.token_hash=$2 AND s.revoked_at IS NULL AND s.expires_at>now() AND f.disabled_at IS NULL LIMIT 1`,[creatorId,hashFanSessionToken(token)])).rows[0];
    return row?{id:row.id,creatorId,email:row.email}:null;
  });
}
