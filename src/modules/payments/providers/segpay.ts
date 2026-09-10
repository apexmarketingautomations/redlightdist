import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { PaymentProviderCapabilityError, PaymentProviderNotConfiguredError, type PaymentProvider, type ProviderContext, type PaymentCustomerInput, type SubscriptionInput, type PurchaseInput, type TipInput, type RefundInput, type ProviderResult, type ProviderWebhookResult } from "../provider";
import { paymentAccountConfig } from "./config";

function config(context:ProviderContext){
  const value=paymentAccountConfig(context.accountId,context.merchantReference).segpay;
  if(!value?.merchantId||!value.srsUserId||!value.srsAccessKey||!(value.eticketId||value.subscriptionEticketId||value.purchaseEticketId))throw new PaymentProviderNotConfiguredError("segpay");
  return value;
}
const safeEqual=(a:string,b:string)=>{try{return timingSafeEqual(Buffer.from(a),Buffer.from(b));}catch{return false;}};

async function dynamicPrice(context:ProviderContext,input:PurchaseInput,kind:"subscription"|"purchase"):Promise<ProviderResult>{
  const c=config(context);
  const endpoint=c.dynamicPricingBaseUrl??"https://srs.segpay.com/MerchantServices/DynamicPricing/";
  const amount=(input.amount.amountMinor/100).toFixed(2);
  const url=new URL(endpoint);url.searchParams.set("merchantId",c.merchantId);url.searchParams.set("amount",amount);
  const auth=Buffer.from(`${c.srsUserId}:${c.srsAccessKey}`).toString("base64");
  const response=await fetch(url,{headers:{Authorization:`Basic ${auth}`,Accept:"application/json"},cache:"no-store"});
  if(!response.ok)throw new Error(`SEGPAY_DYNAMIC_PRICING_FAILED:${response.status}`);
  const body=await response.json() as {dynamicPricingId?:string};
  if(!body.dynamicPricingId)throw new Error("SEGPAY_DYNAMIC_PRICING_ID_MISSING");
  const eticket=kind==="subscription"?(c.subscriptionEticketId??c.eticketId):(c.purchaseEticketId??c.eticketId);
  if(!eticket)throw new PaymentProviderNotConfiguredError("segpay");
  const join=new URL(c.joinBaseUrl??"https://secure2.segpay.com/billing/poset.cgi");
  join.searchParams.set("x-eticketid",eticket);
  join.searchParams.set("dynamicpricingid",body.dynamicPricingId);
  join.searchParams.set("dynamicdesc",input.description.slice(0,255));
  join.searchParams.set("redlightCreatorId",context.creatorId);
  join.searchParams.set("redlightReference",input.externalReference);
  if(input.returnUrl)join.searchParams.set("redlightReturnUrl",input.returnUrl);
  return{id:input.externalReference,status:"pending",checkoutUrl:join.toString(),rawReference:body.dynamicPricingId};
}

function parse(raw:string):Record<string,string>{
  try{const obj=JSON.parse(raw) as Record<string,unknown>;return Object.fromEntries(Object.entries(obj).map(([k,v])=>[k,String(v??"")]));}
  catch{return Object.fromEntries(new URLSearchParams(raw));}
}

export const segpayProvider:PaymentProvider={
  name:"segpay",
  async createCustomer(_context:ProviderContext,input:PaymentCustomerInput){return{id:input.externalReference,status:"active"};},
  async createSubscription(context:ProviderContext,input:SubscriptionInput){return dynamicPrice(context,input,"subscription");},
  async createPurchase(context:ProviderContext,input:PurchaseInput){return dynamicPrice(context,input,"purchase");},
  async createTip(context:ProviderContext,input:TipInput){return dynamicPrice(context,input,"purchase");},
  async cancelSubscription(){throw new PaymentProviderCapabilityError("segpay","subscription cancellation API credentials");},
  async refundTransaction(_context:ProviderContext,_input:RefundInput){throw new PaymentProviderCapabilityError("segpay","refund API credentials");},
  async getTransaction(){throw new PaymentProviderCapabilityError("segpay","transaction lookup API credentials");},
  async processWebhook({headers,rawBody,secret}):Promise<ProviderWebhookResult>{
    const payload=parse(rawBody);
    const supplied=headers.get("authorization")??"";
    const expected=secret?`Basic ${Buffer.from(secret).toString("base64")}`:"";
    const verified=Boolean(expected&&safeEqual(supplied,expected));
    const action=(payload.action||payload.event||payload.transtype||"").toLowerCase();
    const success=!/(fail|declin|chargeback|refund|disable|cancel)/.test(action);
    const eventType=/chargeback/.test(action)?"chargeback":/refund/.test(action)?"refund":/disable|cancel/.test(action)?"subscription.cancelled":success?"sale.approved":"sale.denied";
    const eventId=payload.transguid||payload.transactionid||payload.tranid||createHash("sha256").update(rawBody).digest("hex");
    return{eventId,eventType,verified,creatorReference:payload.redlightCreatorId||payload.creatorReference,transactionReference:payload.redlightReference||payload.reference,payload};
  },
};
