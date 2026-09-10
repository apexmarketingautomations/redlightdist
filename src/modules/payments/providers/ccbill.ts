import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { PaymentProviderCapabilityError, PaymentProviderNotConfiguredError, type PaymentProvider, type ProviderContext, type PaymentCustomerInput, type SubscriptionInput, type PurchaseInput, type TipInput, type RefundInput, type ProviderResult, type ProviderWebhookResult } from "../provider";
import { paymentAccountConfig } from "./config";

const currencyCodes:Record<string,string>={USD:"840",EUR:"978",GBP:"826",CAD:"124",AUD:"036",JPY:"392"};
const price=(minor:number)=>(minor/100).toFixed(2);
const md5=(value:string)=>createHash("md5").update(value).digest("hex");
const safeEqual=(a:string,b:string)=>{try{return timingSafeEqual(Buffer.from(a.toLowerCase()),Buffer.from(b.toLowerCase()));}catch{return false;}};

function config(context:ProviderContext){
  const value=paymentAccountConfig(context.accountId,context.merchantReference).ccbill;
  if(!value?.flexFormId||!value.clientSubacc||!value.encryptionKey)throw new PaymentProviderNotConfiguredError("ccbill");
  return value;
}
function buildCheckout(context:ProviderContext,input:PurchaseInput,recurring:boolean):ProviderResult{
  const c=config(context);const amount=price(input.amount.amountMinor);const currency=(c.currencyCodes??currencyCodes)[input.amount.currency.toUpperCase()];
  if(!currency)throw new Error(`CCBILL_UNSUPPORTED_CURRENCY:${input.amount.currency}`);
  const base=`https://api.ccbill.com/wap-frontflex/flexforms/${encodeURIComponent(c.flexFormId)}`;
  const p=new URLSearchParams({clientSubacc:c.clientSubacc,initialPrice:amount,initialPeriod:"30",currencyCode:currency,redlightCreatorId:context.creatorId,redlightReference:input.externalReference});
  if(recurring){
    p.set("recurringPrice",amount);p.set("recurringPeriod","30");p.set("numRebills","99");
    p.set("formDigest",md5(`${amount}30${amount}3099${currency}${c.encryptionKey}`));
  }else p.set("formDigest",md5(`${amount}30${currency}${c.encryptionKey}`));
  if(input.returnUrl)p.set("redlightReturnUrl",input.returnUrl);
  return{id:input.externalReference,status:"pending",checkoutUrl:`${base}?${p.toString()}`};
}

function parseBody(raw:string):Record<string,string>{
  try{const obj=JSON.parse(raw) as Record<string,unknown>;return Object.fromEntries(Object.entries(obj).map(([k,v])=>[k,String(v??"")]));}
  catch{return Object.fromEntries(new URLSearchParams(raw));}
}

export const ccbillProvider:PaymentProvider={
  name:"ccbill",
  async createCustomer(_context:ProviderContext,input:PaymentCustomerInput){return{id:input.externalReference,status:"active"};},
  async createSubscription(context:ProviderContext,input:SubscriptionInput){return buildCheckout(context,input,true);},
  async createPurchase(context:ProviderContext,input:PurchaseInput){return buildCheckout(context,input,false);},
  async createTip(context:ProviderContext,input:TipInput){return buildCheckout(context,input,false);},
  async cancelSubscription(){throw new PaymentProviderCapabilityError("ccbill","subscription cancellation API credentials");},
  async refundTransaction(_context:ProviderContext,_input:RefundInput){throw new PaymentProviderCapabilityError("ccbill","refund API credentials");},
  async getTransaction(){throw new PaymentProviderCapabilityError("ccbill","transaction lookup API credentials");},
  async processWebhook({rawBody,secret}):Promise<ProviderWebhookResult>{
    const payload=parseBody(rawBody);const subscriptionId=payload.subscriptionId||payload.subscription_id||"";
    const digest=payload.dynamicPricingValidationDigest||payload.responseDigest||"";
    const approved=Boolean(subscriptionId)&&!(payload.reasonForDecline||payload.reasonForDeclineCode||payload.denialId);
    const expected=secret&&subscriptionId?md5(`${subscriptionId}${approved?"1":"0"}${secret}`):"";
    const verified=Boolean(expected&&digest&&safeEqual(expected,digest));
    const eventType=approved?"sale.approved":"sale.denied";
    const eventId=payload.transactionId||payload.transId||createHash("sha256").update(rawBody).digest("hex");
    return{eventId,eventType,verified,creatorReference:payload.redlightCreatorId,transactionReference:payload.redlightReference,payload};
  },
};
