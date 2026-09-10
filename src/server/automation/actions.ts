"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withAuthorizedCreator } from "@/src/modules/auth/authorization";
import { requireCreatorFeature } from "@/src/modules/entitlements/server";
import { supportedActionKeys,supportedTriggerKeys } from "@/src/modules/automation/engine";
import type { FormState } from "@/app/components/action-form";

const uuid=z.string().uuid();
const trigger=z.enum(supportedTriggerKeys),actionKey=z.enum(supportedActionKeys);
const schema=z.discriminatedUnion("operation",[
  z.object({creatorId:uuid,operation:z.literal("create"),name:z.string().trim().min(1).max(160),eventKey:trigger}),
  z.object({creatorId:uuid,automationId:uuid,operation:z.literal("lifecycle"),status:z.enum(["active","paused","archived"])}),
  z.object({creatorId:uuid,automationId:uuid,operation:z.literal("trigger"),eventKey:trigger}),
  z.object({creatorId:uuid,automationId:uuid,operation:z.literal("condition-add"),field:z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9_.-]+$/),operator:z.enum(["eq","neq","gt","gte","lt","lte","contains","exists"]),value:z.string().max(1000).optional()}),
  z.object({creatorId:uuid,automationId:uuid,conditionId:uuid,operation:z.literal("condition-remove")}),
  z.object({creatorId:uuid,automationId:uuid,operation:z.literal("action-add"),actionKey,delaySeconds:z.coerce.number().int().min(0).max(2592000),configJson:z.string().trim().max(10000)}),
  z.object({creatorId:uuid,automationId:uuid,actionId:uuid,operation:z.literal("action-remove")}),
  z.object({creatorId:uuid,automationId:uuid,runId:uuid,operation:z.literal("retry-run")}),
]);
const roles=new Set(["owner","admin","editor","platform_admin"]);
function jsonConfig(raw:string){if(!raw)return{};const value=JSON.parse(raw) as unknown;if(!value||Array.isArray(value)||typeof value!=="object")throw new Error("INVALID_CONFIG");return value as Record<string,unknown>;}
function conditionValue(operator:string,raw?:string){if(operator==="exists")return null;if(raw===undefined)throw new Error("CONDITION_VALUE_REQUIRED");const trimmed=raw.trim();if(trimmed==="true")return true;if(trimmed==="false")return false;if(trimmed==="null")return null;if(trimmed!==""&&Number.isFinite(Number(trimmed)))return Number(trimmed);return raw;}
export async function automationAction(_state:FormState,form:FormData):Promise<FormState>{const parsed=schema.safeParse(Object.fromEntries(form));if(!parsed.success)return{ok:false,message:"Check the automation fields and try again."};const d=parsed.data;
  try{await withAuthorizedCreator(d.creatorId,async(client,actor,role)=>{if(!roles.has(role))throw new Error("ROLE_DENIED");await requireCreatorFeature(client,d.creatorId,"automation");
    if(d.operation==="create"){const automation=(await client.query<{id:string}>("INSERT INTO automations(creator_id,name,status) VALUES($1,$2,'draft') RETURNING id",[d.creatorId,d.name])).rows[0]!;await client.query("INSERT INTO automation_triggers(creator_id,automation_id,event_key) VALUES($1,$2,$3)",[d.creatorId,automation.id,d.eventKey]);return;}
    const a=await client.query("SELECT 1 FROM automations WHERE creator_id=$1 AND id=$2",[d.creatorId,d.automationId]);if(!a.rowCount)throw new Error("AUTOMATION_NOT_FOUND");
    if(d.operation==="lifecycle")await client.query("UPDATE automations SET status=$3,updated_at=now() WHERE creator_id=$1 AND id=$2",[d.creatorId,d.automationId,d.status]);
    else if(d.operation==="trigger")await client.query("UPDATE automation_triggers SET event_key=$3 WHERE creator_id=$1 AND automation_id=$2",[d.creatorId,d.automationId,d.eventKey]);
    else if(d.operation==="condition-add"){const position=Number((await client.query<{n:string}>("SELECT coalesce(max(position),-1)+1 n FROM automation_conditions WHERE creator_id=$1 AND automation_id=$2",[d.creatorId,d.automationId])).rows[0]?.n??0);await client.query("INSERT INTO automation_conditions(creator_id,automation_id,position,field_key,operator,comparison_value) VALUES($1,$2,$3,$4,$5,$6::jsonb)",[d.creatorId,d.automationId,position,d.field,d.operator,JSON.stringify(conditionValue(d.operator,d.value))]);}
    else if(d.operation==="condition-remove")await client.query("DELETE FROM automation_conditions WHERE creator_id=$1 AND automation_id=$2 AND id=$3",[d.creatorId,d.automationId,d.conditionId]);
    else if(d.operation==="action-add"){const config=jsonConfig(d.configJson);const position=Number((await client.query<{n:string}>("SELECT coalesce(max(position),-1)+1 n FROM automation_actions WHERE creator_id=$1 AND automation_id=$2",[d.creatorId,d.automationId])).rows[0]?.n??0);await client.query("INSERT INTO automation_actions(creator_id,automation_id,position,action_key,config,delay_seconds) VALUES($1,$2,$3,$4,$5::jsonb,$6)",[d.creatorId,d.automationId,position,d.actionKey,JSON.stringify(config),d.delaySeconds]);}
    else if(d.operation==="action-remove")await client.query("DELETE FROM automation_actions WHERE creator_id=$1 AND automation_id=$2 AND id=$3",[d.creatorId,d.automationId,d.actionId]);
    else {const run=(await client.query<{status:string}>("SELECT status FROM automation_runs WHERE creator_id=$1 AND automation_id=$2 AND id=$3 FOR UPDATE",[d.creatorId,d.automationId,d.runId])).rows[0];if(!run||run.status!=="failed")throw new Error("RUN_NOT_RETRYABLE");await client.query("UPDATE automation_run_steps SET status='queued',attempts=0,execute_at=now(),started_at=NULL,completed_at=NULL,last_error=NULL WHERE creator_id=$1 AND run_id=$2 AND status='failed'",[d.creatorId,d.runId]);await client.query("UPDATE automation_runs SET status='queued',started_at=NULL,completed_at=NULL,error=NULL WHERE creator_id=$1 AND id=$2",[d.creatorId,d.runId]);}
    await client.query("INSERT INTO audit_logs(actor_user_id,creator_id,action,target_type,target_id) VALUES($1,$2,$3,'automation',$4)",[actor.id,d.creatorId,`automation.${d.operation}`,d.automationId]);
  });}catch(error){const m=error instanceof Error?error.message:"";console.error("Automation action failed",{message:m});return{ok:false,message:m==="INVALID_CONFIG"?"Action config must be a JSON object.":m==="RUN_NOT_RETRYABLE"?"Only failed runs can be retried.":"Automation update could not be completed."};}
  revalidatePath(`/dashboard/${d.creatorId}/marketing`);if("automationId" in d)revalidatePath(`/dashboard/${d.creatorId}/marketing/automations/${d.automationId}`);return{ok:true,message:"Automation updated."};}
