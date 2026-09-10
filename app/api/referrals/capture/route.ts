import { NextResponse } from "next/server";
import { z } from "zod";
import { requestTenant } from "@/src/server/fans/request";
import { withCreator } from "@/src/server/db/scoped";

const codeSchema=z.string().trim().min(2).max(100).regex(/^[A-Za-z0-9_-]+$/);
function safeReturn(value:string|null){if(!value||!value.startsWith("/")||value.startsWith("//"))return"/";return value.slice(0,1000);}
export async function GET(request:Request){const tenant=await requestTenant(request);if(!tenant)return new NextResponse("Tenant not found",{status:404});const url=new URL(request.url);const parsed=codeSchema.safeParse(url.searchParams.get("code")??"");if(!parsed.success)return NextResponse.redirect(new URL(safeReturn(url.searchParams.get("returnTo")),request.url),303);const code=parsed.data;
  const valid=await withCreator(tenant.creatorId,async client=>{const row=await client.query(`SELECT 1 FROM referrals WHERE creator_id=$1 AND code=$2 AND status<>'void' UNION ALL SELECT 1 FROM affiliates WHERE creator_id=$1 AND code=$2 AND status='active' LIMIT 1`,[tenant.creatorId,code]);return Boolean(row.rowCount);});
  const response=NextResponse.redirect(new URL(safeReturn(url.searchParams.get("returnTo")),request.url),303);if(valid)response.cookies.set("redlight_referral",code,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:30*24*60*60});return response;
}
