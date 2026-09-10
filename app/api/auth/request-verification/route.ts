import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/src/server/db/pool";
import { consumePlatformRateLimit } from "@/src/server/security/platform-rate-limit";
import { requireEmailDelivery } from "@/src/modules/notifications/provider";

const emailSchema=z.object({email:z.string().trim().toLowerCase().email().max(320)});
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
export async function POST(request:Request){
  const parsed=emailSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Enter a valid email."},{status:400});const email=parsed.data.email;
  const client=await db.connect();let token:string|undefined,userId:string|undefined;
  try{await client.query("BEGIN");const limit=await consumePlatformRateLimit(client,{scope:"verification",key:email,limit:4,windowSeconds:3600,blockSeconds:3600});if(!limit.allowed){await client.query("COMMIT");return NextResponse.json({error:"Too many requests. Try again later."},{status:429});}
    const user=(await client.query<{id:string;email_verified_at:Date|null}>("SELECT id,email_verified_at FROM platform_users WHERE lower(email)=$1 AND disabled_at IS NULL",[email])).rows[0];
    if(user&&!user.email_verified_at){token=randomBytes(32).toString("base64url");userId=user.id;await client.query("DELETE FROM verification_tokens WHERE user_id=$1 AND purpose='verify_email' AND consumed_at IS NULL",[user.id]);await client.query("INSERT INTO verification_tokens(user_id,purpose,token_hash,expires_at) VALUES($1,'verify_email',$2,now()+interval '24 hours')",[user.id,hash(token)]);}await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);console.error("Verification request failed",error);return NextResponse.json({error:"Verification is temporarily unavailable."},{status:503});}finally{client.release();}
  if(token&&userId){try{const origin=process.env.PLATFORM_ORIGIN?.replace(/\/$/,"")||new URL(request.url).origin;await requireEmailDelivery({to:email,subject:"Verify your Redlight account",text:`Verify your account: ${origin}/api/auth/verify?token=${encodeURIComponent(token)}`});}catch(error){console.error("Verification email delivery failed",{userId,message:error instanceof Error?error.message:"unknown"});return NextResponse.json({error:"Email delivery is not configured or unavailable."},{status:503});}}
  return NextResponse.json({ok:true,message:"If that account requires verification, a verification email was sent."},{status:202});
}
