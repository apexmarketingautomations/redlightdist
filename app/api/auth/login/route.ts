import { hash, verify } from "@node-rs/argon2";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, hashSessionToken } from "@/src/modules/auth/session";
import { decryptMfaSecret, verifyTotp } from "@/src/modules/auth/mfa";
import { consumePlatformRateLimit, clearPlatformRateLimit } from "@/src/server/security/platform-rate-limit";
import { db } from "@/src/server/db/pool";

export const runtime="nodejs";
const credentialsSchema=z.object({email:z.string().email().max(320).transform(v=>v.trim().toLowerCase()),password:z.string().min(1).max(1024),mfaCode:z.string().trim().regex(/^(?:\d{6}|[a-f0-9]{4}-[a-f0-9]{4})$/i).optional()});
function safeEqual(value:string,expected:string){const left=Buffer.from(value),right=Buffer.from(expected);return left.length===right.length&&timingSafeEqual(left,right);}
function sameOrigin(request:Request){const origin=request.headers.get("origin");if(!origin)return true;try{const originHost=new URL(origin).host.toLowerCase();const forwardedHost=request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();const requestHost=(forwardedHost||request.headers.get("host")||"").toLowerCase();return Boolean(requestHost)&&originHost===requestHost;}catch{return false;}}

export async function POST(request:Request){
  if(!sameOrigin(request))return NextResponse.json({error:"Request rejected."},{status:403});
  const parsed=credentialsSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Enter a valid email and password."},{status:400});
  const {email,password,mfaCode}=parsed.data;const client=await db.connect();
  try{
    await client.query("BEGIN");
    const limit=await consumePlatformRateLimit(client,{scope:"login",key:email,limit:8,windowSeconds:15*60,blockSeconds:15*60});if(!limit.allowed){await client.query("COMMIT");return NextResponse.json({error:"Too many login attempts. Try again later."},{status:429,headers:{"retry-after":String(limit.retryAfterSeconds)}});}
    let user=(await client.query<{id:string;password_hash:string;is_platform_admin:boolean;disabled_at:Date|null;email_verified_at:Date|null;mfa_enabled:boolean}>("SELECT id,password_hash,is_platform_admin,disabled_at,email_verified_at,mfa_enabled FROM platform_users WHERE lower(email)=$1 LIMIT 1 FOR UPDATE",[email])).rows[0];
    const adminEmail=process.env.ADMIN_EMAIL?.trim().toLowerCase(),adminPassword=process.env.ADMIN_PASSWORD;const matchesConfiguredAdmin=Boolean(adminEmail&&adminPassword)&&safeEqual(email,adminEmail!)&&safeEqual(password,adminPassword!);
    if(matchesConfiguredAdmin){
      const passwordHash=await hash(password);user=(await client.query<{id:string;password_hash:string;is_platform_admin:boolean;disabled_at:Date|null;email_verified_at:Date|null;mfa_enabled:boolean}>(`INSERT INTO platform_users(email,password_hash,email_verified_at,is_platform_admin) VALUES($1,$2,now(),true)
        ON CONFLICT(lower(email)) DO UPDATE SET password_hash=excluded.password_hash,email_verified_at=coalesce(platform_users.email_verified_at,now()),is_platform_admin=true,disabled_at=NULL,updated_at=now()
        RETURNING id,password_hash,is_platform_admin,disabled_at,email_verified_at,mfa_enabled`,[email,passwordHash])).rows[0];
    }else{
      if(!user||user.disabled_at||!(await verify(user.password_hash,password))){await client.query("COMMIT");return NextResponse.json({error:"Invalid email or password."},{status:401});}
      if(!user.email_verified_at){await client.query("COMMIT");return NextResponse.json({error:"Verify your email before signing in.",verificationRequired:true},{status:403});}
      if(user.mfa_enabled){
        const credential=(await client.query<{secret_ciphertext:string;secret_iv:string;secret_tag:string;confirmed_at:Date|null}>("SELECT secret_ciphertext,secret_iv,secret_tag,confirmed_at FROM mfa_credentials WHERE user_id=$1",[user.id])).rows[0];if(!credential?.confirmed_at)throw new Error("MFA_STATE_INVALID");
        if(!mfaCode){await client.query("COMMIT");return NextResponse.json({error:"Enter your authenticator or recovery code.",mfaRequired:true},{status:401});}
        const secret=decryptMfaSecret({ciphertext:credential.secret_ciphertext,iv:credential.secret_iv,tag:credential.secret_tag});let accepted=/^\d{6}$/.test(mfaCode)&&verifyTotp(secret,mfaCode);
        if(!accepted&&/^[a-f0-9]{4}-[a-f0-9]{4}$/i.test(mfaCode)){const codeHash=createHash("sha256").update(mfaCode.toLowerCase()).digest("hex");const recovery=(await client.query<{code_hash:string}>("SELECT code_hash FROM mfa_recovery_codes WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL FOR UPDATE",[user.id,codeHash])).rows[0];if(recovery){await client.query("UPDATE mfa_recovery_codes SET used_at=now() WHERE user_id=$1 AND code_hash=$2",[user.id,codeHash]);accepted=true;}}
        if(!accepted){await client.query("COMMIT");return NextResponse.json({error:"Invalid authenticator or recovery code.",mfaRequired:true},{status:401});}
      }
    }
    if(!user)throw new Error("Failed to resolve authenticated user.");await clearPlatformRateLimit(client,"login",email);
    const token=randomBytes(32).toString("base64url"),expiresAt=new Date(Date.now()+7*24*60*60*1000);await client.query("DELETE FROM sessions WHERE expires_at<=now() OR revoked_at IS NOT NULL");await client.query(`DELETE FROM sessions WHERE id IN (SELECT id FROM sessions WHERE user_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC OFFSET 9)`,[user.id]);await client.query("INSERT INTO sessions(user_id,token_hash,expires_at,user_agent) VALUES($1,$2,$3,$4)",[user.id,hashSessionToken(token),expiresAt,request.headers.get("user-agent")?.slice(0,512)??null]);await client.query("COMMIT");
    const response=NextResponse.json({ok:true,destination:user.is_platform_admin?"/admin":"/dashboard"});response.cookies.set(SESSION_COOKIE,token,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",expires:expiresAt});return response;
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);console.error("Login failed",error);return NextResponse.json({error:"Login is temporarily unavailable."},{status:500});}finally{client.release();}
}
