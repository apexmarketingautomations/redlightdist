import "server-only";
import type { PoolClient } from "pg";
import { db } from "@/src/server/db/pool";
import { withCreator } from "@/src/server/db/scoped";
import { ensurePaymentProvidersRegistered } from "@/src/modules/payments/providers/register";
import { getPaymentProvider } from "@/src/modules/payments/provider";
import { paymentAccountConfig } from "@/src/modules/payments/providers/config";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Candidate={account_id:string;merchant_reference:string|null};

function verificationSecret(provider:string,accountId:string,merchantReference:string|null):string|undefined{
  const cfg=paymentAccountConfig(accountId,merchantReference);
  if(provider==="ccbill")return cfg.ccbill?.encryptionKey;
  if(provider==="segpay"){
    const u=cfg.segpay?.postbackUsername,p=cfg.segpay?.postbackPassword;
    return u&&p?`${u}:${p}`:undefined;
  }
  return undefined;
}

function payloadString(payload:unknown,...keys:string[]):string|null{
  if(!payload||typeof payload!=="object")return null;
  const record=payload as Record<string,unknown>;
  for(const key of keys){const value=record[key];if(value!==undefined&&value!==null&&String(value))return String(value);}
  return null;
}

async function applyEvent(client:PoolClient,input:{creatorId:string;provider:string;reference:string;eventType:string;payload:unknown}){
  const tx=(await client.query<{id:string;purchase_id:string|null;creator_subscription_id:string|null;kind:string;status:string;gross_minor:number}>(`SELECT id,purchase_id,creator_subscription_id,kind,status,gross_minor FROM transactions
    WHERE creator_id=$1 AND idempotency_key IN ($2,$3,$4) FOR UPDATE`,[input.creatorId,`subscription:${input.reference}`,`purchase:${input.reference}`,`tip:${input.reference}`])).rows[0];
  if(!tx)throw new Error("WEBHOOK_TRANSACTION_NOT_FOUND");
  const providerTx=payloadString(input.payload,"transactionId","transactionid","transId","tranid","transguid");
  const providerSubscription=payloadString(input.payload,"subscriptionId","subscription_id","purchaseid");
  const feeRaw=payloadString(input.payload,"processorFee","processor_fee","fee");
  const fee=feeRaw&&Number.isFinite(Number(feeRaw))?Math.max(0,Math.round(Number(feeRaw)*100)):0;
  if(input.eventType==="sale.approved"){
    await client.query(`UPDATE transactions SET status='settled',provider_transaction_id=coalesce($2,provider_transaction_id),processor_fee_minor=$3,creator_net_minor=greatest(gross_minor-$3-platform_fee_minor,0),occurred_at=now(),metadata=metadata||$4::jsonb WHERE creator_id=$1 AND id=$5`,[input.creatorId,providerTx,fee,JSON.stringify({lastProviderEvent:input.eventType}),tx.id]);
    if(tx.purchase_id)await client.query("UPDATE purchases SET status='paid',purchased_at=coalesce(purchased_at,now()),updated_at=now() WHERE creator_id=$1 AND id=$2",[input.creatorId,tx.purchase_id]);
    if(tx.creator_subscription_id)await client.query(`UPDATE creator_subscriptions SET status='active',provider_subscription_id=coalesce($3,provider_subscription_id),current_period_starts_at=coalesce(current_period_starts_at,now()),current_period_ends_at=coalesce(current_period_ends_at,now()+interval '30 days'),updated_at=now() WHERE creator_id=$1 AND id=$2`,[input.creatorId,tx.creator_subscription_id,providerSubscription]);
    await client.query("INSERT INTO analytics_events(creator_id,fan_id,event_name,properties) SELECT creator_id,fan_id,$2,$3::jsonb FROM transactions WHERE creator_id=$1 AND id=$4",[input.creatorId,tx.kind==="subscription"?"subscription_paid":tx.kind==="tip"?"tip_paid":"purchase_paid",JSON.stringify({grossMinor:tx.gross_minor}),tx.id]);
  }else if(input.eventType==="sale.denied"){
    await client.query("UPDATE transactions SET status='failed',metadata=metadata||$3::jsonb WHERE creator_id=$1 AND id=$2 AND status='pending'",[input.creatorId,tx.id,JSON.stringify({lastProviderEvent:input.eventType})]);
    if(tx.purchase_id)await client.query("UPDATE purchases SET status='failed',updated_at=now() WHERE creator_id=$1 AND id=$2 AND status='pending'",[input.creatorId,tx.purchase_id]);
    if(tx.creator_subscription_id)await client.query("UPDATE creator_subscriptions SET status='expired',updated_at=now() WHERE creator_id=$1 AND id=$2 AND status='trialing'",[input.creatorId,tx.creator_subscription_id]);
  }else if(input.eventType==="refund"){
    await client.query("UPDATE transactions SET status='refunded',refund_minor=gross_minor,creator_net_minor=0,metadata=metadata||$3::jsonb WHERE creator_id=$1 AND id=$2",[input.creatorId,tx.id,JSON.stringify({lastProviderEvent:input.eventType})]);
    if(tx.purchase_id)await client.query("UPDATE purchases SET status='refunded',refunded_at=now(),updated_at=now() WHERE creator_id=$1 AND id=$2",[input.creatorId,tx.purchase_id]);
    if(tx.creator_subscription_id)await client.query("UPDATE creator_subscriptions SET status='refunded',cancelled_at=now(),updated_at=now() WHERE creator_id=$1 AND id=$2",[input.creatorId,tx.creator_subscription_id]);
  }else if(input.eventType==="chargeback"){
    await client.query("UPDATE transactions SET status='chargeback',chargeback_minor=gross_minor,creator_net_minor=0,metadata=metadata||$3::jsonb WHERE creator_id=$1 AND id=$2",[input.creatorId,tx.id,JSON.stringify({lastProviderEvent:input.eventType})]);
    if(tx.purchase_id)await client.query("UPDATE purchases SET status='chargeback',updated_at=now() WHERE creator_id=$1 AND id=$2",[input.creatorId,tx.purchase_id]);
    if(tx.creator_subscription_id)await client.query("UPDATE creator_subscriptions SET status='cancelled',cancelled_at=now(),cancellation_reason='chargeback',updated_at=now() WHERE creator_id=$1 AND id=$2",[input.creatorId,tx.creator_subscription_id]);
  }else if(input.eventType==="subscription.cancelled"){
    if(tx.creator_subscription_id)await client.query("UPDATE creator_subscriptions SET status='cancelled',cancelled_at=now(),updated_at=now() WHERE creator_id=$1 AND id=$2",[input.creatorId,tx.creator_subscription_id]);
  }
}

export async function processPaymentWebhook(input:{provider:string;headers:Headers;rawBody:string}){
  ensurePaymentProvidersRegistered();
  const provider=getPaymentProvider(input.provider);
  const probe=await provider.processWebhook({headers:input.headers,rawBody:input.rawBody});
  const creatorId=probe.creatorReference;
  if(!creatorId||!UUID.test(creatorId))return{status:400 as const,body:"Missing creator reference"};
  const candidate=(await db.query<Candidate>("SELECT account_id,merchant_reference FROM resolve_payment_account_for_webhook($1,$2)",[input.provider,creatorId])).rows[0];
  if(!candidate)return{status:404 as const,body:"Payment account not found"};
  const secret=verificationSecret(input.provider,candidate.account_id,candidate.merchant_reference);
  if(!secret)return{status:503 as const,body:"Webhook verification is not configured"};
  const event=await provider.processWebhook({headers:input.headers,rawBody:input.rawBody,secret});
  if(!event.verified)return{status:401 as const,body:"Invalid provider signature"};
  if(!event.transactionReference)return{status:400 as const,body:"Missing transaction reference"};
  const inserted=await db.query<{id:string}>(`INSERT INTO webhook_events(creator_id,provider,provider_event_id,event_type,payload,signature_verified,processing_status,attempts)
    VALUES($1,$2,$3,$4,$5::jsonb,true,'processing',1) ON CONFLICT(provider,provider_event_id) DO NOTHING RETURNING id`,[creatorId,input.provider,event.eventId,event.eventType,JSON.stringify(event.payload)]);
  if(!inserted.rowCount)return{status:200 as const,body:"OK"};
  try{
    await withCreator(creatorId,client=>applyEvent(client,{creatorId,provider:input.provider,reference:event.transactionReference!,eventType:event.eventType,payload:event.payload}));
    await db.query("UPDATE webhook_events SET processing_status='processed',processed_at=now() WHERE id=$1",[inserted.rows[0]!.id]);
    return{status:200 as const,body:"OK"};
  }catch(error){
    const message=error instanceof Error?error.message:"unknown";
    await db.query("UPDATE webhook_events SET processing_status='failed',last_error=$2 WHERE id=$1",[inserted.rows[0]!.id,message.slice(0,1000)]);
    console.error("Payment webhook processing failed",{provider:input.provider,creatorId,eventId:event.eventId,message});
    return{status:500 as const,body:"Processing failed"};
  }
}
