import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export type PlatformPlan="starter"|"pro"|"elite";
export type BillingInterval="monthly"|"annual";

type Config={secretKey:string;webhookSecret:string;prices:Record<string,string>};
function config():Config{
  const secretKey=process.env.PLATFORM_STRIPE_SECRET_KEY,webhookSecret=process.env.PLATFORM_STRIPE_WEBHOOK_SECRET;
  let prices:Record<string,string>={};try{prices=JSON.parse(process.env.PLATFORM_STRIPE_PRICES_JSON||"{}") as Record<string,string>;}catch{throw new Error("PLATFORM_STRIPE_PRICES_JSON_INVALID");}
  if(!secretKey)throw new Error("PLATFORM_BILLING_NOT_CONFIGURED");
  return{secretKey,webhookSecret:webhookSecret||"",prices};
}
const key=(plan:PlatformPlan,interval:BillingInterval)=>`${plan}:${interval}`;

export async function createPlatformCheckout(input:{creatorId:string;plan:PlatformPlan;interval:BillingInterval;successUrl:string;cancelUrl:string;email?:string}){
  const c=config();const price=c.prices[key(input.plan,input.interval)];if(!price)throw new Error(`PLATFORM_PRICE_NOT_CONFIGURED:${key(input.plan,input.interval)}`);
  const body=new URLSearchParams();body.set("mode","subscription");body.set("line_items[0][price]",price);body.set("line_items[0][quantity]","1");body.set("client_reference_id",input.creatorId);body.set("metadata[creatorId]",input.creatorId);body.set("metadata[plan]",input.plan);body.set("metadata[interval]",input.interval);body.set("subscription_data[metadata][creatorId]",input.creatorId);body.set("subscription_data[metadata][plan]",input.plan);body.set("subscription_data[metadata][interval]",input.interval);body.set("success_url",input.successUrl);body.set("cancel_url",input.cancelUrl);if(input.email)body.set("customer_email",input.email);
  const response=await fetch("https://api.stripe.com/v1/checkout/sessions",{method:"POST",headers:{Authorization:`Bearer ${c.secretKey}`,"content-type":"application/x-www-form-urlencoded"},body,cache:"no-store"});
  const data=await response.json() as {id?:string;url?:string;customer?:string;subscription?:string;error?:{message?:string}};if(!response.ok||!data.id||!data.url)throw new Error(`PLATFORM_CHECKOUT_FAILED:${data.error?.message||response.status}`);
  return{id:data.id,url:data.url};
}

export function verifyStripeWebhook(rawBody:string,header:string|null,nowSeconds=Math.floor(Date.now()/1000)){
  const secret=config().webhookSecret;if(!secret||!header)return false;const values=header.split(",").map(v=>v.trim().split("=",2) as [string,string]);const timestamp=values.find(([k])=>k==="t")?.[1];const signatures=values.filter(([k])=>k==="v1").map(([,v])=>v);if(!timestamp||!signatures.length)return false;const ts=Number(timestamp);if(!Number.isSafeInteger(ts)||Math.abs(nowSeconds-ts)>300)return false;
  const expected=createHmac("sha256",secret).update(`${timestamp}.${rawBody}`).digest("hex");const b=Buffer.from(expected);return signatures.some(sig=>{const a=Buffer.from(sig);return a.length===b.length&&timingSafeEqual(a,b);});
}

export async function createPlatformBillingPortal(customerId:string,returnUrl:string){
  const c=config();const body=new URLSearchParams({customer:customerId,return_url:returnUrl});const response=await fetch("https://api.stripe.com/v1/billing_portal/sessions",{method:"POST",headers:{Authorization:`Bearer ${c.secretKey}`,"content-type":"application/x-www-form-urlencoded"},body,cache:"no-store"});const data=await response.json() as {url?:string;error?:{message?:string}};if(!response.ok||!data.url)throw new Error(`PLATFORM_PORTAL_FAILED:${data.error?.message||response.status}`);return data.url;
}
