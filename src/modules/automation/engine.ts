export type AutomationValue = string|number|boolean|null;
export interface AutomationEvent { key:string; creatorId:string; fanId?:string; payload:Record<string,AutomationValue>; occurredAt:Date; }
export interface AutomationCondition { field:string; operator:"eq"|"neq"|"gt"|"gte"|"lt"|"lte"|"contains"|"exists"; value?:AutomationValue; }
export interface AutomationAction { key:string; config:Record<string,unknown>; delaySeconds:number; }
export interface AutomationDefinition { id:string; creatorId:string; triggerKey:string; conditions:readonly AutomationCondition[]; actions:readonly AutomationAction[]; }

function compare(actual: AutomationValue|undefined, condition: AutomationCondition): boolean {
  const expected=condition.value;
  switch(condition.operator){
    case "exists": return actual !== undefined && actual !== null;
    case "eq": return actual===expected;
    case "neq": return actual!==expected;
    case "contains": return typeof actual==="string" && typeof expected==="string" && actual.includes(expected);
    case "gt": return typeof actual==="number" && typeof expected==="number" && actual>expected;
    case "gte": return typeof actual==="number" && typeof expected==="number" && actual>=expected;
    case "lt": return typeof actual==="number" && typeof expected==="number" && actual<expected;
    case "lte": return typeof actual==="number" && typeof expected==="number" && actual<=expected;
  }
}

export function matchesAutomation(definition: AutomationDefinition,event:AutomationEvent): boolean {
  if(definition.creatorId!==event.creatorId || definition.triggerKey!==event.key) return false;
  return definition.conditions.every(condition=>compare(event.payload[condition.field],condition));
}

export function plannedActions(definition: AutomationDefinition,event:AutomationEvent): Array<AutomationAction & {executeAt:Date}> {
  if(!matchesAutomation(definition,event)) return [];
  return definition.actions.map(action=>({...action,executeAt:new Date(event.occurredAt.getTime()+Math.max(0,action.delaySeconds)*1000)}));
}

export const supportedTriggerKeys = [
  "fan.registered","fan.subscribed","subscription.renewed","subscription.cancelled","subscription.expiring",
  "payment.failed","fan.spend.threshold","fan.inactive","content.published","ppv.published","livestream.started","livestream.ended",
] as const;
export const supportedActionKeys = [
  "email.send","sms.send","notification.create","fan.tag","fan.untag","campaign.enqueue","offer.assign","webhook.emit",
] as const;
