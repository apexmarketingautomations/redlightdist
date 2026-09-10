import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthorizedCreator } from "@/src/modules/auth/authorization";
import { createPlatformCheckout } from "@/src/modules/platform-billing/stripe";

const schema=z.object({creatorId:z.string().uuid(),plan:z.enum(["starter","pro","elite"]),interval:z.enum(["monthly","annual"])});
export async function POST(request:Request){
  const parsed=schema.safeParse(Object.fromEntries(await request.formData()));if(!parsed.success)return new NextResponse("Invalid plan selection",{status:400});const d=parsed.data;
  try{
    const checkout=await withAuthorizedCreator(d.creatorId,async(_client,user,role)=>{
      if(!["owner","admin","platform_admin"].includes(role))throw new Error("ROLE_DENIED");
      return createPlatformCheckout({creatorId:d.creatorId,plan:d.plan,interval:d.interval,email:user.email,successUrl:new URL(`/dashboard/${d.creatorId}/billing?checkout=success`,request.url).toString(),cancelUrl:new URL(`/dashboard/${d.creatorId}/billing?checkout=cancelled`,request.url).toString()});
    });
    return NextResponse.redirect(checkout.url,303);
  }catch(error){const message=error instanceof Error?error.message:"";console.error("Platform billing checkout failed",{creatorId:d.creatorId,message});return NextResponse.redirect(new URL(`/dashboard/${d.creatorId}/billing?error=billing-unavailable`,request.url),303);}
}
