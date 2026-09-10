import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requestTenant, fanRedirect } from "@/src/server/fans/request";
import { withCreator } from "@/src/server/db/scoped";

export async function GET(request:Request){
  const tenant=await requestTenant(request); if(!tenant)return new NextResponse("Unknown creator site",{status:404});
  const raw=new URL(request.url).searchParams.get("token")??"";
  if(!z.string().min(20).max(200).safeParse(raw).success)return fanRedirect(request,"/fan/login?error=verification");
  const tokenHash=createHash("sha256").update(raw).digest("hex");
  const verified=await withCreator(tenant.creatorId,async client=>{
    const row=(await client.query<{id:string;fan_id:string}>("SELECT id,fan_id FROM fan_verification_tokens WHERE creator_id=$1 AND token_hash=$2 AND purpose='verify_email' AND consumed_at IS NULL AND expires_at>now() FOR UPDATE",[tenant.creatorId,tokenHash])).rows[0];
    if(!row)return false;
    await client.query("UPDATE fan_verification_tokens SET consumed_at=now() WHERE creator_id=$1 AND id=$2",[tenant.creatorId,row.id]);
    await client.query("UPDATE fans SET email_verified_at=coalesce(email_verified_at,now()),updated_at=now() WHERE creator_id=$1 AND id=$2",[tenant.creatorId,row.fan_id]);
    return true;
  });
  return fanRedirect(request,verified?"/fan/login?notice=verified":"/fan/login?error=verification");
}
