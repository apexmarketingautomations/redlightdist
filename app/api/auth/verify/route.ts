import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/src/server/db/pool";
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
export async function GET(request:Request){
  const token=new URL(request.url).searchParams.get("token");if(!token||token.length>512)return NextResponse.redirect(new URL("/verify-email?status=invalid",request.url),303);
  const client=await db.connect();try{await client.query("BEGIN");const row=(await client.query<{id:string;user_id:string}>("SELECT id,user_id FROM verification_tokens WHERE purpose='verify_email' AND token_hash=$1 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE",[hash(token)])).rows[0];if(!row){await client.query("ROLLBACK");return NextResponse.redirect(new URL("/verify-email?status=invalid",request.url),303);}await client.query("UPDATE platform_users SET email_verified_at=coalesce(email_verified_at,now()),updated_at=now() WHERE id=$1",[row.user_id]);await client.query("UPDATE verification_tokens SET consumed_at=now() WHERE id=$1",[row.id]);await client.query("COMMIT");return NextResponse.redirect(new URL("/login?verified=1",request.url),303);}catch(error){await client.query("ROLLBACK").catch(()=>undefined);console.error("Email verification failed",error);return NextResponse.redirect(new URL("/verify-email?status=error",request.url),303);}finally{client.release();}
}
