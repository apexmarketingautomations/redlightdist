import { createHash } from "node:crypto";
import { hash as argonHash } from "@node-rs/argon2";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/src/server/db/pool";
const tokenHash=(value:string)=>createHash("sha256").update(value).digest("hex");
const schema=z.object({token:z.string().min(20).max(512),password:z.string().min(12).max(128),confirm:z.string().min(12).max(128)}).refine(v=>v.password===v.confirm,{message:"Passwords must match"});
export async function POST(request:Request){
  const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Use matching passwords of at least 12 characters."},{status:400});
  const client=await db.connect();try{await client.query("BEGIN");const row=(await client.query<{id:string;user_id:string;email:string}>(`SELECT v.id,v.user_id,u.email FROM verification_tokens v JOIN platform_users u ON u.id=v.user_id
    WHERE v.purpose='reset_password' AND v.token_hash=$1 AND v.consumed_at IS NULL AND v.expires_at>now() AND u.disabled_at IS NULL FOR UPDATE`,[tokenHash(parsed.data.token)])).rows[0];
    if(!row){await client.query("ROLLBACK");return NextResponse.json({error:"This reset link is invalid or expired."},{status:400});}
    if(row.email.toLowerCase()===process.env.ADMIN_EMAIL?.trim().toLowerCase()){await client.query("ROLLBACK");return NextResponse.json({error:"The recovery administrator password is deployment-managed."},{status:403});}
    await client.query("UPDATE platform_users SET password_hash=$2,updated_at=now() WHERE id=$1",[row.user_id,await argonHash(parsed.data.password)]);await client.query("UPDATE verification_tokens SET consumed_at=now() WHERE id=$1",[row.id]);await client.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",[row.user_id]);await client.query("COMMIT");return NextResponse.json({ok:true});
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);console.error("Password reset completion failed",error);return NextResponse.json({error:"Password reset is temporarily unavailable."},{status:503});}finally{client.release();}
}
