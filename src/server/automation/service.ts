import "server-only";
import type { PoolClient } from "pg";
import { withCreator, withRuntime } from "@/src/server/db/scoped";
import { matchesAutomation, type AutomationCondition, type AutomationDefinition, type AutomationEvent } from "@/src/modules/automation/engine";
import { configuredEmailProvider, configuredSmsProvider } from "@/src/modules/notifications/provider";

type RawAutomation={id:string;event_key:string};
type RawCondition={field_key:string;operator:AutomationCondition["operator"];comparison_value:unknown};
type RawAction={id:string;action_key:string;config:Record<string,unknown>;delay_seconds:number;position:number};

export async function dispatchAutomationEvent(client:PoolClient,event:AutomationEvent){
  const automations=(await client.query<RawAutomation>(`SELECT a.id,t.event_key FROM automations a JOIN automation_triggers t ON t.creator_id=a.creator_id AND t.automation_id=a.id
    WHERE a.creator_id=$1 AND a.status='active' AND t.event_key=$2 ORDER BY a.created_at`,[event.creatorId,event.key])).rows;
  let queued=0;
  for(const automation of automations){
    const conditions=(await client.query<RawCondition>("SELECT field_key,operator,comparison_value FROM automation_conditions WHERE creator_id=$1 AND automation_id=$2 ORDER BY position,id",[event.creatorId,automation.id])).rows.map(row=>({field:row.field_key,operator:row.operator,value:(row.comparison_value??null) as AutomationCondition["value"]}));
    const actions=(await client.query<RawAction>("SELECT id,action_key,config,delay_seconds,position FROM automation_actions WHERE creator_id=$1 AND automation_id=$2 ORDER BY position,id",[event.creatorId,automation.id])).rows;
    const definition:AutomationDefinition={id:automation.id,creatorId:event.creatorId,triggerKey:automation.event_key,conditions,actions:actions.map(a=>({key:a.action_key,config:a.config,delaySeconds:a.delay_seconds}))};
    if(!matchesAutomation(definition,event)||!actions.length)continue;
    const run=(await client.query<{id:string}>("INSERT INTO automation_runs(creator_id,automation_id,fan_id,event_key,event_payload,status) VALUES($1,$2,$3,$4,$5::jsonb,'queued') RETURNING id",[event.creatorId,automation.id,event.fanId??null,event.key,JSON.stringify(event.payload)])).rows[0]!;
    for(const action of actions)await client.query("INSERT INTO automation_run_steps(creator_id,run_id,action_id,action_key,config,position,execute_at) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)",[event.creatorId,run.id,action.id,action.action_key,JSON.stringify(action.config),action.position,new Date(event.occurredAt.getTime()+Math.max(0,action.delay_seconds)*1000)]);
    queued+=actions.length;
  }
  return queued;
}

function stringConfig(config:Record<string,unknown>,key:string,required=true){const value=config[key];if(typeof value==="string"&&value.trim())return value.trim();if(required)throw new Error(`AUTOMATION_CONFIG_MISSING:${key}`);return"";}
async function executeStep(client:PoolClient,input:{creatorId:string;fanId:string|null;actionKey:string;config:Record<string,unknown>;eventPayload:Record<string,unknown>}){
  const fan=input.fanId?(await client.query<{email:string;phone:string|null;email_consent:boolean;sms_consent:boolean}>(`SELECT f.email,fp.phone,coalesce(fp.email_consent,false) email_consent,coalesce(fp.sms_consent,false) sms_consent FROM fans f LEFT JOIN fan_profiles fp ON fp.creator_id=f.creator_id AND fp.fan_id=f.id WHERE f.creator_id=$1 AND f.id=$2`,[input.creatorId,input.fanId])).rows[0]:null;
  if(input.actionKey==="fan.tag"){
    if(!input.fanId)throw new Error("AUTOMATION_FAN_REQUIRED");const tagName=stringConfig(input.config,"tag");let tag=(await client.query<{id:string}>("SELECT id FROM crm_tags WHERE creator_id=$1 AND lower(name)=lower($2) LIMIT 1",[input.creatorId,tagName])).rows[0];if(!tag)tag=(await client.query<{id:string}>("INSERT INTO crm_tags(creator_id,name) VALUES($1,$2) RETURNING id",[input.creatorId,tagName])).rows[0]!;await client.query("INSERT INTO fan_tags(creator_id,fan_id,tag_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[input.creatorId,input.fanId,tag.id]);return;
  }
  if(input.actionKey==="fan.untag"){
    if(!input.fanId)throw new Error("AUTOMATION_FAN_REQUIRED");await client.query("DELETE FROM fan_tags WHERE creator_id=$1 AND fan_id=$2 AND tag_id IN (SELECT id FROM crm_tags WHERE creator_id=$1 AND lower(name)=lower($3))",[input.creatorId,input.fanId,stringConfig(input.config,"tag")]);return;
  }
  if(input.actionKey==="notification.create"){
    await client.query("INSERT INTO notifications(creator_id,fan_id,channel,template_key,subject,body,status,metadata) VALUES($1,$2,'in_app',$3,$4,$5,'queued',$6::jsonb)",[input.creatorId,input.fanId,stringConfig(input.config,"template",false)||null,stringConfig(input.config,"subject",false)||null,stringConfig(input.config,"body"),JSON.stringify({automation:true,event:input.eventPayload})]);return;
  }
  if(input.actionKey==="email.send"){
    if(!fan?.email_consent)throw new Error("EMAIL_CONSENT_REQUIRED");const subject=stringConfig(input.config,"subject"),body=stringConfig(input.config,"body");const notification=(await client.query<{id:string}>("INSERT INTO notifications(creator_id,fan_id,channel,subject,body,status) VALUES($1,$2,'email',$3,$4,'sending') RETURNING id",[input.creatorId,input.fanId,subject,body])).rows[0]!;const provider=configuredEmailProvider();if(!provider)throw new Error("EMAIL_PROVIDER_NOT_CONFIGURED");const result=await provider.send({to:fan.email,subject,text:body});await client.query("UPDATE notifications SET status=$2,provider_message_id=$3,sent_at=CASE WHEN $2='sent' THEN now() END WHERE creator_id=$1 AND id=$4",[input.creatorId,result.accepted?"sent":"failed",result.providerMessageId,notification.id]);if(!result.accepted)throw new Error("EMAIL_PROVIDER_REJECTED");return;
  }
  if(input.actionKey==="sms.send"){
    if(!fan?.sms_consent||!fan.phone)throw new Error("SMS_CONSENT_REQUIRED");const body=stringConfig(input.config,"body");const notification=(await client.query<{id:string}>("INSERT INTO notifications(creator_id,fan_id,channel,body,status) VALUES($1,$2,'sms',$3,'sending') RETURNING id",[input.creatorId,input.fanId,body])).rows[0]!;const provider=configuredSmsProvider();if(!provider)throw new Error("SMS_PROVIDER_NOT_CONFIGURED");const result=await provider.send({to:fan.phone,body});await client.query("UPDATE notifications SET status=$2,provider_message_id=$3,sent_at=CASE WHEN $2='sent' THEN now() END WHERE creator_id=$1 AND id=$4",[input.creatorId,result.accepted?"sent":"failed",result.providerMessageId,notification.id]);if(!result.accepted)throw new Error("SMS_PROVIDER_REJECTED");return;
  }
  if(input.actionKey==="campaign.enqueue"){
    const campaignId=stringConfig(input.config,"campaignId");if(!input.fanId)throw new Error("AUTOMATION_FAN_REQUIRED");const campaign=(await client.query<{channel:string;subject:string|null;body:string}>("SELECT channel,subject,body FROM campaigns WHERE creator_id=$1 AND id=$2 AND status IN ('draft','scheduled','sending','paused')",[input.creatorId,campaignId])).rows[0];if(!campaign)throw new Error("CAMPAIGN_NOT_FOUND");await client.query("INSERT INTO notifications(creator_id,fan_id,channel,subject,body,status,metadata) VALUES($1,$2,$3,$4,$5,'queued',$6::jsonb)",[input.creatorId,input.fanId,campaign.channel,campaign.subject,campaign.body,JSON.stringify({campaignId})]);return;
  }
  if(input.actionKey==="offer.assign"){
    if(!input.fanId)throw new Error("AUTOMATION_FAN_REQUIRED");await client.query("INSERT INTO notifications(creator_id,fan_id,channel,template_key,body,status,metadata) VALUES($1,$2,'in_app','offer_assigned',$3,'queued',$4::jsonb)",[input.creatorId,input.fanId,stringConfig(input.config,"message",false)||"A new offer is available.",JSON.stringify({couponCode:stringConfig(input.config,"couponCode",false)||null})]);return;
  }
  if(input.actionKey==="webhook.emit"){
    const url=new URL(stringConfig(input.config,"url"));if(url.protocol!=="https:")throw new Error("AUTOMATION_WEBHOOK_HTTPS_REQUIRED");const allow=(process.env.AUTOMATION_WEBHOOK_ALLOWLIST||"").split(",").map(v=>v.trim().toLowerCase()).filter(Boolean);if(!allow.includes(url.hostname.toLowerCase()))throw new Error("AUTOMATION_WEBHOOK_HOST_NOT_ALLOWED");const response=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({creatorId:input.creatorId,fanId:input.fanId,event:input.eventPayload}),signal:AbortSignal.timeout(10_000)});if(!response.ok)throw new Error(`AUTOMATION_WEBHOOK_FAILED:${response.status}`);return;
  }
  throw new Error(`AUTOMATION_ACTION_UNSUPPORTED:${input.actionKey}`);
}

export async function processAutomationQueue(maxJobs=10){
  const workerId=crypto.randomUUID();let processed=0,failed=0;
  for(let i=0;i<Math.max(1,Math.min(50,maxJobs));i++){
    const claim=await withRuntime(async client=>(await client.query<{step_id:string;creator_id:string}>("SELECT step_id,creator_id FROM claim_automation_step($1)",[workerId])).rows[0]);if(!claim)break;
    try{
      await withCreator(claim.creator_id,async client=>{
        const step=(await client.query<{id:string;run_id:string;action_key:string;config:Record<string,unknown>;fan_id:string|null;event_payload:Record<string,unknown>}>(`SELECT s.id,s.run_id,s.action_key,s.config,r.fan_id,r.event_payload FROM automation_run_steps s JOIN automation_runs r ON r.creator_id=s.creator_id AND r.id=s.run_id WHERE s.creator_id=$1 AND s.id=$2 FOR UPDATE`,[claim.creator_id,claim.step_id])).rows[0];if(!step)throw new Error("AUTOMATION_STEP_NOT_FOUND");
        await client.query("UPDATE automation_runs SET status='running',started_at=coalesce(started_at,now()),error=NULL WHERE creator_id=$1 AND id=$2",[claim.creator_id,step.run_id]);
        await executeStep(client,{creatorId:claim.creator_id,fanId:step.fan_id,actionKey:step.action_key,config:step.config,eventPayload:step.event_payload});
        await client.query("UPDATE automation_run_steps SET status='completed',completed_at=now(),last_error=NULL WHERE creator_id=$1 AND id=$2",[claim.creator_id,step.id]);
        const pending=await client.query("SELECT 1 FROM automation_run_steps WHERE creator_id=$1 AND run_id=$2 AND status<>'completed' LIMIT 1",[claim.creator_id,step.run_id]);if(!pending.rowCount)await client.query("UPDATE automation_runs SET status='completed',completed_at=now(),error=NULL WHERE creator_id=$1 AND id=$2",[claim.creator_id,step.run_id]);
      });processed++;
    }catch(error){failed++;const message=error instanceof Error?error.message:"unknown";await withCreator(claim.creator_id,async client=>{
      const row=(await client.query<{run_id:string;attempts:number}>("SELECT run_id,attempts FROM automation_run_steps WHERE creator_id=$1 AND id=$2",[claim.creator_id,claim.step_id])).rows[0];if(!row)return;const terminal=row.attempts>=5;const backoff=Math.min(3600,Math.pow(2,Math.max(0,row.attempts-1))*60);
      await client.query("UPDATE automation_run_steps SET status='failed',last_error=$3,execute_at=CASE WHEN $4 THEN execute_at ELSE now()+($5::text||' seconds')::interval END,completed_at=CASE WHEN $4 THEN now() ELSE NULL END WHERE creator_id=$1 AND id=$2",[claim.creator_id,claim.step_id,message.slice(0,1000),terminal,backoff]);
      await client.query("UPDATE automation_runs SET status=$3,error=$4,completed_at=CASE WHEN $3='failed' THEN now() ELSE NULL END WHERE creator_id=$1 AND id=$2",[claim.creator_id,row.run_id,terminal?"failed":"queued",message.slice(0,1000)]);
    });}
  }
  return{processed,failed};
}
