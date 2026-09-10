import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getPaymentProvider, type ProviderContext } from "@/src/modules/payments/provider";
import { ensurePaymentProvidersRegistered } from "@/src/modules/payments/providers/register";

export type CommerceKind="subscription"|"purchase"|"tip";
type AccountRow={id:string;provider:string;merchant_reference:string|null;status:string};

async function defaultAccount(client:PoolClient,creatorId:string):Promise<AccountRow>{
  const row=(await client.query<AccountRow>(`SELECT id,provider,merchant_reference,status FROM payment_provider_accounts
    WHERE creator_id=$1 AND status='active' ORDER BY is_default DESC,created_at ASC LIMIT 1`,[creatorId])).rows[0];
  if(!row)throw new Error("PAYMENT_PROVIDER_UNAVAILABLE");
  return row;
}
function context(creatorId:string,account:AccountRow):ProviderContext{return{creatorId,accountId:account.id,merchantReference:account.merchant_reference};}
function providerFor(account:AccountRow){ensurePaymentProvidersRegistered();return getPaymentProvider(account.provider);}

export async function beginSubscription(client:PoolClient,input:{creatorId:string;fanId:string;tierId:string;returnUrl:string}){
  const fan=(await client.query<{email:string;email_verified_at:Date|null}>("SELECT email,email_verified_at FROM fans WHERE creator_id=$1 AND id=$2 AND disabled_at IS NULL",[input.creatorId,input.fanId])).rows[0];
  if(!fan)throw new Error("FAN_NOT_FOUND");
  if(!fan.email_verified_at)throw new Error("EMAIL_VERIFICATION_REQUIRED");
  const tier=(await client.query<{name:string;monthly_price_minor:number;currency:string}>("SELECT name,monthly_price_minor,currency FROM membership_tiers WHERE creator_id=$1 AND id=$2 AND active",[input.creatorId,input.tierId])).rows[0];
  if(!tier)throw new Error("MEMBERSHIP_TIER_NOT_FOUND");
  const account=await defaultAccount(client,input.creatorId);const provider=providerFor(account);const localId=randomUUID();
  const customer=await provider.createCustomer(context(input.creatorId,account),{externalReference:input.fanId,email:fan.email});
  const result=await provider.createSubscription(context(input.creatorId,account),{customerId:customer.id,externalReference:localId,amount:{amountMinor:tier.monthly_price_minor,currency:tier.currency},interval:"monthly",description:tier.name,returnUrl:input.returnUrl});
  await client.query(`INSERT INTO creator_subscriptions(id,creator_id,fan_id,membership_tier_id,payment_provider_account_id,provider_subscription_id,status)
    VALUES($1,$2,$3,$4,$5,$6,'trialing')`,[localId,input.creatorId,input.fanId,input.tierId,account.id,result.id]);
  await client.query(`INSERT INTO transactions(creator_id,fan_id,creator_subscription_id,payment_provider_account_id,provider_transaction_id,kind,status,gross_minor,currency,idempotency_key,metadata)
    VALUES($1,$2,$3,$4,$5,'subscription','pending',$6,$7,$8,$9::jsonb)`,[input.creatorId,input.fanId,localId,account.id,result.rawReference??null,tier.monthly_price_minor,tier.currency,`subscription:${localId}`,JSON.stringify({provider:account.provider,providerSubscriptionId:result.id})]);
  return result;
}

export async function beginPurchase(client:PoolClient,input:{creatorId:string;fanId:string;productId:string;returnUrl:string}){
  const fan=(await client.query<{email:string;email_verified_at:Date|null}>("SELECT email,email_verified_at FROM fans WHERE creator_id=$1 AND id=$2 AND disabled_at IS NULL",[input.creatorId,input.fanId])).rows[0];
  if(!fan)throw new Error("FAN_NOT_FOUND");
  if(!fan.email_verified_at)throw new Error("EMAIL_VERIFICATION_REQUIRED");
  const product=(await client.query<{name:string;price_minor:number;currency:string}>("SELECT name,price_minor,currency FROM products WHERE creator_id=$1 AND id=$2 AND active",[input.creatorId,input.productId])).rows[0];
  if(!product)throw new Error("PRODUCT_NOT_FOUND");
  const account=await defaultAccount(client,input.creatorId);const provider=providerFor(account);const purchaseId=randomUUID();
  const customer=await provider.createCustomer(context(input.creatorId,account),{externalReference:input.fanId,email:fan.email});
  const result=await provider.createPurchase(context(input.creatorId,account),{customerId:customer.id,externalReference:purchaseId,amount:{amountMinor:product.price_minor,currency:product.currency},description:product.name,returnUrl:input.returnUrl});
  await client.query("INSERT INTO purchases(id,creator_id,fan_id,product_id,status,gross_minor,currency) VALUES($1,$2,$3,$4,'pending',$5,$6)",[purchaseId,input.creatorId,input.fanId,input.productId,product.price_minor,product.currency]);
  await client.query(`INSERT INTO transactions(creator_id,fan_id,purchase_id,payment_provider_account_id,provider_transaction_id,kind,status,gross_minor,currency,idempotency_key,metadata)
    VALUES($1,$2,$3,$4,$5,'purchase','pending',$6,$7,$8,$9::jsonb)`,[input.creatorId,input.fanId,purchaseId,account.id,result.rawReference??null,product.price_minor,product.currency,`purchase:${purchaseId}`,JSON.stringify({provider:account.provider,providerPurchaseId:result.id})]);
  return result;
}

export async function beginTip(client:PoolClient,input:{creatorId:string;fanId:string;amountMinor:number;currency:string;message?:string;liveStreamId?:string;returnUrl:string}){
  if(input.amountMinor<100)throw new Error("TIP_TOO_SMALL");
  const fan=(await client.query<{email:string;email_verified_at:Date|null}>("SELECT email,email_verified_at FROM fans WHERE creator_id=$1 AND id=$2 AND disabled_at IS NULL",[input.creatorId,input.fanId])).rows[0];
  if(!fan?.email_verified_at)throw new Error("EMAIL_VERIFICATION_REQUIRED");
  const account=await defaultAccount(client,input.creatorId);const provider=providerFor(account);const reference=randomUUID();
  const customer=await provider.createCustomer(context(input.creatorId,account),{externalReference:input.fanId,email:fan.email});
  const result=await provider.createTip(context(input.creatorId,account),{customerId:customer.id,externalReference:reference,amount:{amountMinor:input.amountMinor,currency:input.currency},description:"Creator tip",returnUrl:input.returnUrl});
  const tx=(await client.query<{id:string}>(`INSERT INTO transactions(creator_id,fan_id,payment_provider_account_id,provider_transaction_id,kind,status,gross_minor,currency,idempotency_key,metadata)
    VALUES($1,$2,$3,$4,'tip','pending',$5,$6,$7,$8::jsonb) RETURNING id`,[input.creatorId,input.fanId,account.id,result.rawReference??null,input.amountMinor,input.currency,`tip:${reference}`,JSON.stringify({provider:account.provider,providerTipId:result.id})])).rows[0]!;
  await client.query("INSERT INTO tips(creator_id,fan_id,transaction_id,live_stream_id,amount_minor,currency,message) VALUES($1,$2,$3,$4,$5,$6,$7)",[input.creatorId,input.fanId,tx.id,input.liveStreamId??null,input.amountMinor,input.currency,input.message??null]);
  return result;
}
