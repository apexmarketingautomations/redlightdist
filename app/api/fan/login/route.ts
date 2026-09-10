import { randomBytes } from "node:crypto";
import { verify } from "@node-rs/argon2";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requestTenant, fanRedirect } from "@/src/server/fans/request";
import { withCreator } from "@/src/server/db/scoped";
import { consumeTenantRateLimit, clearTenantRateLimit } from "@/src/server/security/rate-limit";
import { FAN_SESSION_COOKIE, hashFanSessionToken } from "@/src/modules/auth/fan-session";

const schema=z.object({email:z.string().trim().toLowerCase().email().max(320),password:z.string().min(1).max(128)});

export async function POST(request:Request){
  const tenant=await requestTenant(request); if(!tenant)return new NextResponse("Unknown creator site",{status:404});
  const parsed=schema.safeParse(Object.fromEntries(await request.formData())); if(!parsed.success)return fanRedirect(request,"/fan/login?error=invalid");
  const {email,password}=parsed.data;
  let token="";
  try{
    token=await withCreator(tenant.creatorId,async client=>{
      const throttle=await consumeTenantRateLimit(client,{creatorId:tenant.creatorId,scope:"fan-login",key:email,limit:8,windowSeconds:900,blockSeconds:900});
      if(!throttle.allowed)throw new Error(`RATE_LIMIT:${throttle.retryAfterSeconds}`);
      const fan=(await client.query<{id:string;password_hash:string;email_verified_at:Date|null;disabled_at:Date|null}>("SELECT id,password_hash,email_verified_at,disabled_at FROM fans WHERE creator_id=$1 AND lower(email)=$2 LIMIT 1",[tenant.creatorId,email])).rows[0];
      if(!fan||fan.disabled_at||!(await verify(fan.password_hash,password)))throw new Error("INVALID_CREDENTIALS");
      if(!fan.email_verified_at)throw new Error("EMAIL_NOT_VERIFIED");
      const raw=randomBytes(32).toString("base64url");
      await client.query("INSERT INTO fan_sessions(creator_id,fan_id,token_hash,expires_at,user_agent) VALUES($1,$2,$3,now()+interval '30 days',$4)",[tenant.creatorId,fan.id,hashFanSessionToken(raw),request.headers.get("user-agent")?.slice(0,500)??null]);
      await client.query("UPDATE fans SET last_login_at=now(),updated_at=now() WHERE creator_id=$1 AND id=$2",[tenant.creatorId,fan.id]);
      await clearTenantRateLimit(client,{creatorId:tenant.creatorId,scope:"fan-login",key:email});
      return raw;
    });
  }catch(error){
    const message=error instanceof Error?error.message:"";
    if(message.startsWith("RATE_LIMIT:"))return new NextResponse("Too many login attempts. Try again later.",{status:429,headers:{"retry-after":message.split(":")[1]??"900"}});
    if(message==="EMAIL_NOT_VERIFIED")return fanRedirect(request,"/fan/login?notice=verify-email");
    return fanRedirect(request,"/fan/login?error=credentials");
  }
  const response=fanRedirect(request,"/fan/account");
  response.cookies.set(FAN_SESSION_COOKIE,token,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:60*60*24*30});
  return response;
}
