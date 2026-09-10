import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthenticatedUser } from "@/src/modules/auth/authorization";
import { withUser } from "@/src/server/db/scoped";
import { decryptMfaSecret, verifyTotp } from "@/src/modules/auth/mfa";

const schema=z.object({code:z.string().trim().regex(/^\d{6}$/)});const hash=(v:string)=>createHash("sha256").update(v).digest("hex");
export async function POST(request:Request){
  const user=await requireAuthenticatedUser();const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Enter a six-digit authenticator code."},{status:400});
  try{
    const codes=Array.from({length:8},()=>`${randomBytes(4).toString("hex").slice(0,4)}-${randomBytes(4).toString("hex").slice(0,4)}`);
    const ok=await withUser(user.id,async client=>{
      const row=(await client.query<{secret_ciphertext:string;secret_iv:string;secret_tag:string}>("SELECT secret_ciphertext,secret_iv,secret_tag FROM mfa_credentials WHERE user_id=$1 FOR UPDATE",[user.id])).rows[0];if(!row)return false;
      const secret=decryptMfaSecret({ciphertext:row.secret_ciphertext,iv:row.secret_iv,tag:row.secret_tag});if(!verifyTotp(secret,parsed.data.code))return false;
      await client.query("UPDATE mfa_credentials SET confirmed_at=now(),updated_at=now() WHERE user_id=$1",[user.id]);await client.query("UPDATE platform_users SET mfa_enabled=true,updated_at=now() WHERE id=$1",[user.id]);await client.query("DELETE FROM mfa_recovery_codes WHERE user_id=$1",[user.id]);for(const code of codes)await client.query("INSERT INTO mfa_recovery_codes(user_id,code_hash) VALUES($1,$2)",[user.id,hash(code)]);return true;
    });
    if(!ok)return NextResponse.json({error:"Authenticator code is invalid."},{status:400});return NextResponse.json({ok:true,recoveryCodes:codes},{headers:{"cache-control":"no-store"}});
  }catch(error){console.error("MFA confirmation failed",{userId:user.id,message:error instanceof Error?error.message:"unknown"});return NextResponse.json({error:"MFA confirmation is unavailable."},{status:503});}
}
