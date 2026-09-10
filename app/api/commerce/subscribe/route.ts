import { NextResponse } from "next/server";
import { z } from "zod";
import { requestTenant, fanRedirect } from "@/src/server/fans/request";
import { getCurrentFan } from "@/src/modules/auth/fan-session";
import { withCreator } from "@/src/server/db/scoped";
import { beginSubscription } from "@/src/server/commerce/service";

export async function POST(request:Request){
  const tenant=await requestTenant(request); if(!tenant)return new NextResponse("Tenant not found",{status:404});
  const fan=await getCurrentFan(); if(!fan||fan.creatorId!==tenant.creatorId)return fanRedirect(request,"/fan/login");
  const form=await request.formData();
  const parsed=z.object({tierId:z.string().uuid()}).safeParse(Object.fromEntries(form));
  if(!parsed.success)return new NextResponse("Invalid membership selection",{status:400});
  try{
    const result=await withCreator(tenant.creatorId,client=>beginSubscription(client,{creatorId:tenant.creatorId,fanId:fan.id,tierId:parsed.data.tierId,returnUrl:new URL("/fan/account",request.url).toString()}));
    if(!result.checkoutUrl)return new NextResponse("Payment provider did not return checkout",{status:503});
    return NextResponse.redirect(result.checkoutUrl,303);
  }catch(error){
    const message=error instanceof Error?error.message:"";
    if(message==="EMAIL_VERIFICATION_REQUIRED")return fanRedirect(request,"/fan/account?error=verify-email");
    if(message==="PAYMENT_PROVIDER_UNAVAILABLE"||message.includes("not configured"))return fanRedirect(request,"/fan/account?error=payments-unavailable");
    console.error("Subscription checkout failed",{creatorId:tenant.creatorId,message});
    return new NextResponse("Checkout unavailable",{status:503});
  }
}
