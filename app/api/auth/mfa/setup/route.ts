import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/src/modules/auth/authorization";
import { withUser } from "@/src/server/db/scoped";
import { encryptMfaSecret, newTotpSecret, totpUri } from "@/src/modules/auth/mfa";

export async function POST(){
  const user=await requireAuthenticatedUser();
  try{
    const secret=newTotpSecret();const encrypted=encryptMfaSecret(secret);
    await withUser(user.id,client=>client.query(`INSERT INTO mfa_credentials(user_id,secret_ciphertext,secret_iv,secret_tag,confirmed_at,updated_at)
      VALUES($1,$2,$3,$4,NULL,now()) ON CONFLICT(user_id) DO UPDATE SET secret_ciphertext=excluded.secret_ciphertext,secret_iv=excluded.secret_iv,secret_tag=excluded.secret_tag,confirmed_at=NULL,updated_at=now()`,[user.id,encrypted.ciphertext,encrypted.iv,encrypted.tag]));
    return NextResponse.json({secret,uri:totpUri({secret,email:user.email})},{headers:{"cache-control":"no-store"}});
  }catch(error){console.error("MFA setup failed",{userId:user.id,message:error instanceof Error?error.message:"unknown"});return NextResponse.json({error:"MFA setup is unavailable. Check encryption-key configuration."},{status:503});}
}
