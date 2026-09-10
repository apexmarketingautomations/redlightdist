"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withAuthorizedCreator } from "@/src/modules/auth/authorization";
import { requireCreatorFeature } from "@/src/modules/entitlements/server";
import { queueCampaign } from "./service";
import type { FormState } from "@/app/components/action-form";

const schema=z.object({creatorId:z.string().uuid(),campaignId:z.string().uuid(),operation:z.enum(["audience","send","schedule","pause","resume","cancel"]),scheduledFor:z.string().trim().optional(),segmentId:z.preprocess(value=>value===""?undefined:value,z.string().uuid().optional())});
const roles=new Set(["owner","admin","editor","platform_admin"]);
export async function campaignAction(_state:FormState,form:FormData):Promise<FormState>{
  const parsed=schema.safeParse(Object.fromEntries(form));if(!parsed.success)return{ok:false,message:"Invalid campaign request."};const d=parsed.data;
  try{await withAuthorizedCreator(d.creatorId,async(client,_actor,role)=>{
    if(!roles.has(role))throw new Error("ROLE_DENIED");await requireCreatorFeature(client,d.creatorId,"emailAutomation");
    const campaign=(await client.query<{status:string;channel:string}>("SELECT status,channel FROM campaigns WHERE creator_id=$1 AND id=$2 FOR UPDATE",[d.creatorId,d.campaignId])).rows[0];if(!campaign)throw new Error("CAMPAIGN_NOT_FOUND");
    if(campaign.channel==="sms")await requireCreatorFeature(client,d.creatorId,"sms");
    if(d.operation==="audience"){if(!["draft","paused","scheduled"].includes(campaign.status))throw new Error("CAMPAIGN_AUDIENCE_LOCKED");if(d.segmentId){const segment=await client.query("SELECT 1 FROM segments WHERE creator_id=$1 AND id=$2",[d.creatorId,d.segmentId]);if(!segment.rowCount)throw new Error("SEGMENT_NOT_FOUND");}await client.query("UPDATE campaigns SET segment_id=$3,updated_at=now() WHERE creator_id=$1 AND id=$2",[d.creatorId,d.campaignId,d.segmentId??null]);return;}
    if(d.operation==="cancel"){await client.query("UPDATE campaigns SET status='cancelled',completed_at=now(),updated_at=now() WHERE creator_id=$1 AND id=$2",[d.creatorId,d.campaignId]);await client.query("UPDATE campaign_deliveries SET status='cancelled',completed_at=now(),updated_at=now() WHERE creator_id=$1 AND campaign_id=$2 AND status IN ('queued','failed')",[d.creatorId,d.campaignId]);return;}
    if(d.operation==="pause"){if(!["scheduled","sending"].includes(campaign.status))throw new Error("CAMPAIGN_NOT_PAUSABLE");await client.query("UPDATE campaigns SET status='paused',updated_at=now() WHERE creator_id=$1 AND id=$2",[d.creatorId,d.campaignId]);return;}
    if(d.operation==="resume"){if(campaign.status!=="paused")throw new Error("CAMPAIGN_NOT_PAUSED");await client.query("UPDATE campaigns SET status='sending',started_at=coalesce(started_at,now()),updated_at=now() WHERE creator_id=$1 AND id=$2",[d.creatorId,d.campaignId]);return;}
    if(d.operation==="schedule"){await requireCreatorFeature(client,d.creatorId,"scheduledCampaigns");const when=d.scheduledFor?new Date(d.scheduledFor):null;if(!when||Number.isNaN(when.getTime())||when.getTime()<=Date.now())throw new Error("INVALID_SCHEDULE");await client.query("UPDATE campaigns SET status='scheduled',scheduled_for=$3,completed_at=NULL,updated_at=now() WHERE creator_id=$1 AND id=$2",[d.creatorId,d.campaignId,when]);await queueCampaign(client,{creatorId:d.creatorId,campaignId:d.campaignId,executeAt:when});return;}
    await queueCampaign(client,{creatorId:d.creatorId,campaignId:d.campaignId,executeAt:new Date()});
  });}catch(error){const m=error instanceof Error?error.message:"";console.error("Campaign action failed",{creatorId:d.creatorId,campaignId:d.campaignId,message:m});return{ok:false,message:m==="INVALID_SCHEDULE"?"Choose a future schedule time.":m==="CAMPAIGN_CLOSED"?"This campaign is already closed.":m==="CAMPAIGN_AUDIENCE_LOCKED"?"Pause the campaign before changing its audience.":"Campaign update could not be completed."};}
  revalidatePath(`/dashboard/${d.creatorId}/marketing`);return{ok:true,message:d.operation==="schedule"?"Campaign scheduled.":d.operation==="send"?"Campaign queued for delivery.":d.operation==="audience"?"Campaign audience updated.":"Campaign updated."};
}
