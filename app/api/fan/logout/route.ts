import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { FAN_SESSION_COOKIE, hashFanSessionToken } from "@/src/modules/auth/fan-session";
import { requestTenant, fanRedirect, clearFanSession } from "@/src/server/fans/request";
import { withCreator } from "@/src/server/db/scoped";

export async function POST(request:Request){
  const tenant=await requestTenant(request); if(!tenant)return new NextResponse("Unknown creator site",{status:404});
  const raw=(await cookies()).get(FAN_SESSION_COOKIE)?.value;
  if(raw)await withCreator(tenant.creatorId,async client=>{await client.query("UPDATE fan_sessions SET revoked_at=coalesce(revoked_at,now()) WHERE creator_id=$1 AND token_hash=$2",[tenant.creatorId,hashFanSessionToken(raw)]);});
  const response=fanRedirect(request,"/"); clearFanSession(response); return response;
}
