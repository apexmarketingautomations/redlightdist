import "server-only";
import type { PoolClient } from "pg";
import { withCreator, withRuntime } from "@/src/server/db/scoped";
import { configuredEmailProvider, configuredSmsProvider } from "@/src/modules/notifications/provider";

type Rules=Record<string,unknown>;
type FanCandidate={
  id:string;email:string;phone:string|null;email_consent:boolean;sms_consent:boolean;last_login_at:Date|null;created_at:Date;
  lifetime_spend_minor:string;subscription_status:string|null;subscription_created_at:Date|null;ppv_purchases:string;tags:string[]|null;
};

function numericRule(value:unknown){
  if(typeof value==="number")return{eq:value};
  if(value&&typeof value==="object")return value as {gte?:number;lte?:number;gt?:number;lt?:number;eq?:number};
  return null;
}
function matchesNumber(actual:number,rule:unknown){const r=numericRule(rule);if(!r)return true;if(r.eq!==undefined&&actual!==r.eq)return false;if(r.gte!==undefined&&actual<r.gte)return false;if(r.lte!==undefined&&actual>r.lte)return false;if(r.gt!==undefined&&actual<=r.gt)return false;if(r.lt!==undefined&&actual>=r.lt)return false;return true;}
export function matchesSegment(candidate:FanCandidate,rules:Rules,now=new Date()){
  if(typeof rules.subscriptionStatus==="string"&&candidate.subscription_status!==rules.subscriptionStatus)return false;
  if(!matchesNumber(Number(candidate.lifetime_spend_minor),rules.lifetimeSpendMinor))return false;
  if(!matchesNumber(Number(candidate.ppv_purchases),rules.ppvPurchases))return false;
  if(rules.subscriptionAgeDays&&candidate.subscription_created_at){const days=(now.getTime()-candidate.subscription_created_at.getTime())/86400000;if(!matchesNumber(days,rules.subscriptionAgeDays))return false;}
  if(rules.daysSinceLastLogin){const days=candidate.last_login_at?(now.getTime()-candidate.last_login_at.getTime())/86400000:Number.POSITIVE_INFINITY;if(!matchesNumber(days,rules.daysSinceLastLogin))return false;}
  if(typeof rules.createdWithinDays==="number"&&now.getTime()-candidate.created_at.getTime()>rules.createdWithinDays*86400000)return false;
  if(typeof rules.emailConsent==="boolean"&&candidate.email_consent!==rules.emailConsent)return false;
  if(typeof rules.smsConsent==="boolean"&&candidate.sms_consent!==rules.smsConsent)return false;
  if(Array.isArray(rules.tagIds)&&rules.tagIds.length){const tags=new Set(candidate.tags??[]);if(!(rules.tagIds as unknown[]).every(v=>typeof v==="string"&&tags.has(v)))return false;}
  return true;
}

async function candidates(client:PoolClient,creatorId:string){
  return (await client.query<FanCandidate>(`SELECT f.id,f.email,fp.phone,coalesce(fp.email_consent,false) email_consent,coalesce(fp.sms_consent,false) sms_consent,f.last_login_at,f.created_at,
    coalesce((SELECT sum(t.gross_minor) FROM transactions t WHERE t.creator_id=f.creator_id AND t.fan_id=f.id AND t.status='settled'),0)::text lifetime_spend_minor,
    (SELECT cs.status FROM creator_subscriptions cs WHERE cs.creator_id=f.creator_id AND cs.fan_id=f.id ORDER BY cs.created_at DESC LIMIT 1) subscription_status,
    (SELECT cs.created_at FROM creator_subscriptions cs WHERE cs.creator_id=f.creator_id AND cs.fan_id=f.id ORDER BY cs.created_at DESC LIMIT 1) subscription_created_at,
    coalesce((SELECT count(*) FROM purchases p JOIN products pr ON pr.creator_id=p.creator_id AND pr.id=p.product_id WHERE p.creator_id=f.creator_id AND p.fan_id=f.id AND p.status='paid' AND pr.product_type='ppv'),0)::text ppv_purchases,
    (SELECT array_agg(ft.tag_id::text) FROM fan_tags ft WHERE ft.creator_id=f.creator_id AND ft.fan_id=f.id) tags
    FROM fans f LEFT JOIN fan_profiles fp ON fp.creator_id=f.creator_id AND fp.fan_id=f.id
    WHERE f.creator_id=$1 AND f.disabled_at IS NULL ORDER BY f.created_at DESC`,[creatorId])).rows;
}

export async function queueCampaign(client:PoolClient,input:{creatorId:string;campaignId:string;executeAt?:Date|null}){
  const campaign=(await client.query<{id:string;channel:string;status:string;segment_id:string|null;scheduled_for:Date|null}>("SELECT id,channel,status,segment_id,scheduled_for FROM campaigns WHERE creator_id=$1 AND id=$2 FOR UPDATE",[input.creatorId,input.campaignId])).rows[0];
  if(!campaign)throw new Error("CAMPAIGN_NOT_FOUND");
  if(campaign.status==="cancelled"||campaign.status==="sent")throw new Error("CAMPAIGN_CLOSED");
  const segment=campaign.segment_id?(await client.query<{rules:Rules}>("SELECT rules FROM segments WHERE creator_id=$1 AND id=$2",[input.creatorId,campaign.segment_id])).rows[0]:null;
  const all=await candidates(client,input.creatorId);const rules=segment?.rules??{};const now=new Date();let queued=0,skipped=0;
  for(const fan of all){
    if(!matchesSegment(fan,rules,now))continue;
    const canDeliver=campaign.channel==="in_app"||(campaign.channel==="email"&&fan.email_consent)||(campaign.channel==="sms"&&fan.sms_consent&&!!fan.phone);
    const status=canDeliver?"queued":"skipped";const executeAt=input.executeAt??campaign.scheduled_for??now;
    const inserted=await client.query(`INSERT INTO campaign_deliveries(creator_id,campaign_id,fan_id,status,execute_at,completed_at,idempotency_key)
      VALUES($1,$2,$3,$4,$5,CASE WHEN $4='skipped' THEN now() ELSE NULL END,$6) ON CONFLICT(creator_id,campaign_id,fan_id) DO NOTHING`,[input.creatorId,input.campaignId,fan.id,status,executeAt,`campaign:${input.campaignId}:fan:${fan.id}`]);
    if(inserted.rowCount){if(canDeliver)queued++;else skipped++;}
  }
  const nextStatus=(input.executeAt??campaign.scheduled_for)&&new Date(input.executeAt??campaign.scheduled_for!).getTime()>Date.now()?"scheduled":"sending";
  await client.query("UPDATE campaigns SET status=$3,scheduled_for=coalesce($4,scheduled_for),started_at=CASE WHEN $3='sending' THEN coalesce(started_at,now()) ELSE started_at END,total_audience=(SELECT count(*) FROM campaign_deliveries WHERE creator_id=$1 AND campaign_id=$2),skipped_count=(SELECT count(*) FROM campaign_deliveries WHERE creator_id=$1 AND campaign_id=$2 AND status='skipped'),updated_at=now() WHERE creator_id=$1 AND id=$2",[input.creatorId,input.campaignId,nextStatus,input.executeAt??null]);
  return{queued,skipped,total:queued+skipped};
}

async function refreshCampaign(client:PoolClient,creatorId:string,campaignId:string){
  const counts=(await client.query<{total:string;sent:string;failed:string;skipped:string;pending:string}>(`SELECT count(*)::text total,count(*) FILTER(WHERE status='sent')::text sent,count(*) FILTER(WHERE status='failed')::text failed,count(*) FILTER(WHERE status='skipped')::text skipped,count(*) FILTER(WHERE status IN ('queued','sending','failed') AND attempts<5)::text pending FROM campaign_deliveries WHERE creator_id=$1 AND campaign_id=$2`,[creatorId,campaignId])).rows[0]!;
  const done=Number(counts.pending)===0;
  await client.query("UPDATE campaigns SET sent_count=$3,failed_count=$4,skipped_count=$5,status=CASE WHEN $6 AND status NOT IN ('cancelled','paused') THEN 'sent' ELSE status END,completed_at=CASE WHEN $6 THEN coalesce(completed_at,now()) ELSE completed_at END,updated_at=now() WHERE creator_id=$1 AND id=$2",[creatorId,campaignId,Number(counts.sent),Number(counts.failed),Number(counts.skipped),done]);
}

async function deliverOne(creatorId:string,deliveryId:string){
  await withCreator(creatorId,async client=>{
    const row=(await client.query<{id:string;campaign_id:string;fan_id:string;channel:string;subject:string|null;body:string;campaign_status:string;email:string;phone:string|null;email_consent:boolean;sms_consent:boolean}>(`SELECT d.id,d.campaign_id,d.fan_id,c.channel,c.subject,c.body,c.status campaign_status,f.email,fp.phone,coalesce(fp.email_consent,false) email_consent,coalesce(fp.sms_consent,false) sms_consent
      FROM campaign_deliveries d JOIN campaigns c ON c.creator_id=d.creator_id AND c.id=d.campaign_id JOIN fans f ON f.creator_id=d.creator_id AND f.id=d.fan_id LEFT JOIN fan_profiles fp ON fp.creator_id=f.creator_id AND fp.fan_id=f.id WHERE d.creator_id=$1 AND d.id=$2 FOR UPDATE OF d`,[creatorId,deliveryId])).rows[0];
    if(!row)throw new Error("CAMPAIGN_DELIVERY_NOT_FOUND");
    if(["paused","cancelled"].includes(row.campaign_status)){await client.query("UPDATE campaign_deliveries SET status='cancelled',completed_at=now(),updated_at=now() WHERE creator_id=$1 AND id=$2",[creatorId,deliveryId]);return;}
    if(row.channel==="email"&&!row.email_consent){await client.query("UPDATE campaign_deliveries SET status='skipped',last_error='Email consent not granted',completed_at=now(),updated_at=now() WHERE creator_id=$1 AND id=$2",[creatorId,deliveryId]);return;}
    if(row.channel==="sms"&&(!row.sms_consent||!row.phone)){await client.query("UPDATE campaign_deliveries SET status='skipped',last_error='SMS consent or phone missing',completed_at=now(),updated_at=now() WHERE creator_id=$1 AND id=$2",[creatorId,deliveryId]);return;}
    let providerMessageId:string|null=null;
    if(row.channel==="in_app"){
      const notification=await client.query<{id:string}>("INSERT INTO notifications(creator_id,fan_id,channel,subject,body,status,sent_at,metadata) VALUES($1,$2,'in_app',$3,$4,'sent',now(),$5::jsonb) RETURNING id",[creatorId,row.fan_id,row.subject,row.body,JSON.stringify({campaignId:row.campaign_id,deliveryId:row.id})]);providerMessageId=notification.rows[0]!.id;
    }else if(row.channel==="email"){
      const provider=configuredEmailProvider();if(!provider)throw new Error("EMAIL_PROVIDER_NOT_CONFIGURED");const result=await provider.send({to:row.email,subject:row.subject??"Update",text:row.body});if(!result.accepted)throw new Error("EMAIL_PROVIDER_REJECTED");providerMessageId=result.providerMessageId;
    }else{
      const provider=configuredSmsProvider();if(!provider)throw new Error("SMS_PROVIDER_NOT_CONFIGURED");const result=await provider.send({to:row.phone!,body:row.body});if(!result.accepted)throw new Error("SMS_PROVIDER_REJECTED");providerMessageId=result.providerMessageId;
    }
    await client.query("UPDATE campaign_deliveries SET status='sent',provider_message_id=$3,completed_at=now(),updated_at=now() WHERE creator_id=$1 AND id=$2",[creatorId,deliveryId,providerMessageId]);
    await refreshCampaign(client,creatorId,row.campaign_id);
  });
}

export async function processCampaignQueue(maxJobs=25){let processed=0,failed=0;for(let i=0;i<Math.max(1,Math.min(maxJobs,100));i++){
  const claim=await withRuntime(async client=>(await client.query<{delivery_id:string;creator_id:string}>("SELECT delivery_id,creator_id FROM claim_campaign_delivery($1)",[crypto.randomUUID()])).rows[0]);if(!claim)break;
  try{await deliverOne(claim.creator_id,claim.delivery_id);processed++;}catch(error){failed++;const message=error instanceof Error?error.message:"unknown";await withCreator(claim.creator_id,async client=>{const d=(await client.query<{campaign_id:string;attempts:number}>("SELECT campaign_id,attempts FROM campaign_deliveries WHERE creator_id=$1 AND id=$2",[claim.creator_id,claim.delivery_id])).rows[0];if(!d)return;const terminal=d.attempts>=5;const backoff=Math.min(3600,Math.pow(2,Math.max(0,d.attempts-1))*60);await client.query("UPDATE campaign_deliveries SET status='failed',last_error=$3,execute_at=CASE WHEN $4 THEN execute_at ELSE now()+($5::text||' seconds')::interval END,completed_at=CASE WHEN $4 THEN now() ELSE NULL END,updated_at=now() WHERE creator_id=$1 AND id=$2",[claim.creator_id,claim.delivery_id,message.slice(0,1000),terminal,backoff]);await refreshCampaign(client,claim.creator_id,d.campaign_id);});}
  }return{processed,failed};}
