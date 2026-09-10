import { createHash } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requestTenant, fanRedirect } from "@/src/server/fans/request";
import { withCreator } from "@/src/server/db/scoped";

const schema=z.object({token:z.string().min(20).max(200),password:z.string().min(12).max(128),confirm:z.string().min(12).max(128)});
export async function POST(request:Request){
  const tenant=await requestTenant(request); if(!tenant)return new NextResponse("Unknown creator site",{status:404});
  const parsed=schema.safeParse(Object.fromEntries(await request.formData()));
  if(!parsed.success||parsed.data.password!==parsed.data.confirm)return fanRedirect(request,`/fan/reset-password?token=${encodeURIComponent(parsed.success?parsed.data.token:"")}&error=password`);
  const digest=createHash("sha256").update(parsed.data.token).digest("hex");
  const changed=await withCreator(tenant.creatorId,async client=>{
    const token=(await client.query<{id:string;fan_id:string}>("SELECT id,fan_id FROM fan_verification_tokens WHERE creator_id=$1 AND purpose='reset_password' AND token_hash=$2 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE",[tenant.creatorId,digest])).rows[0];
    if(!token)return false;
    await client.query("UPDATE fans SET password_hash=$3,updated_at=now() WHERE creator_id=$1 AND id=$2",[tenant.creatorId,token.fan_id,await hash(parsed.data.password)]);
    await client.query("UPDATE fan_verification_tokens SET consumed_at=now() WHERE creator_id=$1 AND id=$2",[tenant.creatorId,token.id]);
    await client.query("UPDATE fan_sessions SET revoked_at=coalesce(revoked_at,now()) WHERE creator_id=$1 AND fan_id=$2 AND revoked_at IS NULL",[tenant.creatorId,token.fan_id]);
    return true;
  });
  return fanRedirect(request,changed?"/fan/login?notice=password-reset":"/fan/forgot-password?error=expired");
}
