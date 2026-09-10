import { NextResponse } from "next/server";
import { processPaymentWebhook } from "@/src/server/commerce/webhooks";

const allowed=new Set(["ccbill","segpay"]);
export async function POST(request:Request,{params}:{params:Promise<{provider:string}>}){
  const {provider}=await params;
  if(!allowed.has(provider))return new NextResponse("Unknown provider",{status:404});
  const rawBody=await request.text();
  if(rawBody.length>1_000_000)return new NextResponse("Payload too large",{status:413});
  const result=await processPaymentWebhook({provider,headers:request.headers,rawBody});
  return new NextResponse(result.body,{status:result.status,headers:{"content-type":"text/plain; charset=utf-8","cache-control":"no-store"}});
}
