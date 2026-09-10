import { NextResponse } from "next/server";
import { db } from "@/src/server/db/pool";
import { verifyStripeWebhook } from "@/src/modules/platform-billing/stripe";

type StripeObject={id?:string;customer?:string;subscription?:string;status?:string;payment_status?:string;metadata?:Record<string,string>;cancel_at_period_end?:boolean;current_period_start?:number;current_period_end?:number;trial_end?:number|null};
type StripeEvent={id:string;type:string;data:{object:StripeObject}};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validPlan=new Set(["starter","pro","elite"]),validInterval=new Set(["monthly","annual"]);
const ts=(value?:number|null)=>value?new Date(value*1000):null;

async function syncPlan(input:{creatorId:string;plan:string;interval:string;providerCustomerId?:string|null;providerSubscriptionId?:string|null;status:string;trialEnd?:number|null;periodStart?:number|null;periodEnd?:number|null;cancelAtPeriodEnd?:boolean}){
  const plan=(await db.query<{id:string}>("SELECT id FROM plans WHERE code=$1 AND active",[input.plan])).rows[0];if(!plan)throw new Error("PLAN_NOT_FOUND");
  await db.query("BEGIN");
  try{
    await db.query(`INSERT INTO platform_billing_subscriptions(creator_id,provider,provider_customer_id,provider_subscription_id,plan_id,billing_interval,status,trial_ends_at,current_period_starts_at,current_period_ends_at,cancel_at_period_end)
      VALUES($1,'stripe',$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT(provider,provider_subscription_id) DO UPDATE SET provider_customer_id=excluded.provider_customer_id,plan_id=excluded.plan_id,billing_interval=excluded.billing_interval,status=excluded.status,trial_ends_at=excluded.trial_ends_at,current_period_starts_at=excluded.current_period_starts_at,current_period_ends_at=excluded.current_period_ends_at,cancel_at_period_end=excluded.cancel_at_period_end,updated_at=now()`,[input.creatorId,input.providerCustomerId??null,input.providerSubscriptionId??null,plan.id,input.interval,input.status,ts(input.trialEnd),ts(input.periodStart),ts(input.periodEnd),input.cancelAtPeriodEnd??false]);
    await db.query("UPDATE creator_plans SET billing_status='cancelled',updated_at=now() WHERE creator_id=$1 AND billing_status<>'cancelled'",[input.creatorId]);
    const mapped=input.status==="active"?"active":input.status==="trialing"?"trialing":input.status==="past_due"?"past_due":input.status==="unpaid"?"suspended":input.status==="canceled"?"cancelled":"grace";
    if(mapped!=="cancelled")await db.query("INSERT INTO creator_plans(creator_id,plan_id,billing_status,interval,current_period_ends_at,grace_ends_at) VALUES($1,$2,$3::billing_status,$4,$5,CASE WHEN $3='past_due' THEN now()+interval '7 days' ELSE NULL END)",[input.creatorId,plan.id,mapped,input.interval,ts(input.periodEnd)]);
    await db.query("COMMIT");
  }catch(error){await db.query("ROLLBACK");throw error;}
}

export async function POST(request:Request){
  const raw=await request.text();if(raw.length>1_000_000)return new NextResponse("Payload too large",{status:413});
  if(!verifyStripeWebhook(raw,request.headers.get("stripe-signature")))return new NextResponse("Invalid signature",{status:401});
  let event:StripeEvent;try{event=JSON.parse(raw) as StripeEvent;}catch{return new NextResponse("Invalid JSON",{status:400});}
  if(!event.id||!event.type||!event.data?.object)return new NextResponse("Invalid event",{status:400});
  const object=event.data.object;let creatorId=object.metadata?.creatorId;let plan=object.metadata?.plan;let interval=object.metadata?.interval;
  if((!creatorId||!plan||!interval)&&object.subscription){
    const known=(await db.query<{creator_id:string;plan:string;billing_interval:string}>(`SELECT pbs.creator_id,p.code AS plan,pbs.billing_interval FROM platform_billing_subscriptions pbs JOIN plans p ON p.id=pbs.plan_id WHERE pbs.provider='stripe' AND pbs.provider_subscription_id=$1 LIMIT 1`,[object.subscription])).rows[0];
    if(known){creatorId=known.creator_id;plan=known.plan;interval=known.billing_interval;}
  }
  const inserted=await db.query<{id:string}>(`INSERT INTO platform_billing_events(provider,provider_event_id,event_type,creator_id,signature_verified,processing_status,payload)
    VALUES('stripe',$1,$2,$3,true,'pending',$4::jsonb) ON CONFLICT(provider,provider_event_id) DO NOTHING RETURNING id`,[event.id,event.type,creatorId&&uuid.test(creatorId)?creatorId:null,raw]);
  if(!inserted.rowCount)return new NextResponse("OK",{status:200});
  try{
    if(event.type==="checkout.session.completed"){
      if(!creatorId||!uuid.test(creatorId)||!plan||!validPlan.has(plan)||!interval||!validInterval.has(interval)||!object.subscription)throw new Error("BILLING_METADATA_INVALID");
      await syncPlan({creatorId,plan,interval,providerCustomerId:object.customer??null,providerSubscriptionId:object.subscription,status:object.payment_status==="paid"?"active":"trialing"});
    }else if(event.type==="customer.subscription.updated"||event.type==="customer.subscription.deleted"){
      if(!creatorId||!uuid.test(creatorId)||!plan||!validPlan.has(plan)||!interval||!validInterval.has(interval))throw new Error("BILLING_METADATA_INVALID");
      await syncPlan({creatorId,plan,interval,providerCustomerId:object.customer??null,providerSubscriptionId:object.id??null,status:event.type.endsWith("deleted")?"canceled":object.status??"past_due",trialEnd:object.trial_end,periodStart:object.current_period_start,periodEnd:object.current_period_end,cancelAtPeriodEnd:object.cancel_at_period_end});
    }else if(event.type==="invoice.payment_failed"||event.type==="invoice.paid"){
      if(object.subscription){
        const row=(await db.query<{creator_id:string;plan:string;billing_interval:string}>(`SELECT s.creator_id,p.code AS plan,s.billing_interval FROM platform_billing_subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.provider='stripe' AND s.provider_subscription_id=$1 LIMIT 1`,[object.subscription])).rows[0];
        if(row)await syncPlan({creatorId:row.creator_id,plan:row.plan,interval:row.billing_interval,providerSubscriptionId:object.subscription,status:event.type==="invoice.paid"?"active":"past_due"});
      }
    }
    await db.query("UPDATE platform_billing_events SET processing_status='processed',processed_at=now() WHERE id=$1",[inserted.rows[0]!.id]);return new NextResponse("OK",{status:200});
  }catch(error){const message=error instanceof Error?error.message:"unknown";await db.query("UPDATE platform_billing_events SET processing_status='failed',last_error=$2 WHERE id=$1",[inserted.rows[0]!.id,message.slice(0,1000)]);console.error("Platform billing webhook failed",{eventId:event.id,type:event.type,message});return new NextResponse("Processing failed",{status:500});}
}
