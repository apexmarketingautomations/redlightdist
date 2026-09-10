import { NextResponse } from "next/server";

export async function POST(request:Request){
  const form=await request.formData();
  const raw=String(form.get("returnTo")??"/");
  const returnTo=raw.startsWith("/")&&!raw.startsWith("//")&&!raw.includes("\\")?raw:"/";
  const response=NextResponse.redirect(new URL(returnTo,request.url),303);
  response.cookies.set("creator_age_gate","accepted",{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:60*60*24*30});
  return response;
}
