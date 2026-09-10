import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { normalizeHostname } from "@/src/modules/tenants/hostname";
import { resolveCreatorIdForHost } from "@/src/modules/tenants/server";
import { FAN_SESSION_COOKIE, hashFanSessionToken } from "@/src/modules/auth/fan-session";

export async function requestTenant(request:Request):Promise<{creatorId:string;host:string}|null>{
  const host=normalizeHostname(request.headers.get("host")??""); if(!host)return null;
  const creatorId=await resolveCreatorIdForHost(host); return creatorId?{creatorId,host}:null;
}
export function issueFanSession(response:NextResponse,token?:string){
  const value=token??randomBytes(32).toString("base64url");
  response.cookies.set(FAN_SESSION_COOKIE,value,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:60*60*24*30});
  return {token:value,tokenHash:hashFanSessionToken(value)};
}
export function clearFanSession(response:NextResponse){response.cookies.set(FAN_SESSION_COOKIE,"",{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:0});}
export function fanRedirect(request:Request,path:string,status:303|307=303){return NextResponse.redirect(new URL(path,request.url),status);}
