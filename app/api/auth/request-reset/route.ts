import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/src/server/db/pool";
import { consumePlatformRateLimit } from "@/src/server/security/platform-rate-limit";
import { requireEmailDelivery } from "@/src/modules/notifications/provider";
const schema=z.object({email:z.string().trim().toLowerCase().email().max(320)});const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
export async function POST(request:Request){
  const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Enter a valid email."},{status:400});const email=parsed.data.email;
  const adminEmail=process.env.ADMIN_EMAIL?.trim().toLowerCase();if(adminEmail&&email===adminEmail)return NextResponse.json({ok:true,message:"The recovery administrator password is managed through deployment configuration."},{status:202});
  const client=await db.connect();let token:string|undefined,userId:string|undefined;
  try{await client.query("BEGIN");const limit=await consumePlatformRateLimit(client,{scope:"password_reset",key:email,limit:4,windowSeconds:3600,blockSeconds:3600});if(!limit.allowed){await client.query("COMMIT");return NextResponse.json({error:"Too many requests. Try again later."},{status:429});}
    const user=(await client.query<{id:string}>("SELECT id FROM platform_users WHERE lower(email)=$1 AND disabled_at IS NULL",[email])).rows[0];if(user){token=randomBytes(32).toString("base64url");userId=user.id;await client.query("DELETE FROM verification_tokens WHERE user_id=$1 AND purpose='reset_password' AND consumed_at IS NULL",[user.id]);await client.query("INSERT INTO verification_tokens(user_id,purpose,token_hash,expires_at) VALUES($1,'reset_password',$2,now()+interval '1 hour')",[user.id,hash(token)]);}await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);console.error("Password reset request failed",error);return NextResponse.json({error:"Password reset is temporarily unavailable."},{status:503});}finally{client.release();}
  if(token&&userId){try{const origin=process.env.PLATFORM_ORIGIN?.replace(/\/$/,"")||new URL(request.url).origin;await requireEmailDelivery({to:email,subject:"Reset your Redlight password",text:`Reset your password: ${origin}/reset-password?token=${encodeURIComponent(token)}`});}catch(error){console.error("Reset email delivery failed",{userId,message:error instanceof Error?error.message:"unknown"});return NextResponse.json({error:"Email delivery is not configured or unavailable."},{status:503});}}
  return NextResponse.json({ok:true,message:"If an eligible account exists, a reset email was sent."},{status:202});
}
