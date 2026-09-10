import "server-only";
import { withRuntime } from "@/src/server/db/scoped";
import { processAutomationQueue } from "@/src/server/automation/service";
import { processCampaignQueue } from "@/src/server/campaigns/service";
import { refreshAnalyticsRollups } from "@/src/server/analytics/service";

export async function processOperationalQueues(){
  const published=await withRuntime(async client=>(await client.query<{post_id:string;creator_id:string}>("SELECT post_id,creator_id FROM publish_due_content($1)",[50])).rows.length);
  const campaigns=await processCampaignQueue(50);
  const automations=await processAutomationQueue(50);
  let analyticsRollups=0;
  const shouldRollup=await withRuntime(async client=>(await client.query<{claimed:boolean}>("SELECT claim_worker_checkpoint('analytics-rollup',900,300) AS claimed")).rows[0]?.claimed??false);
  if(shouldRollup){
    try{analyticsRollups=await refreshAnalyticsRollups(2);await withRuntime(async client=>{await client.query("SELECT complete_worker_checkpoint('analytics-rollup',NULL)");});}
    catch(error){const message=error instanceof Error?error.message:"unknown";await withRuntime(async client=>{await client.query("SELECT complete_worker_checkpoint('analytics-rollup',$1)",[message]);});throw error;}
  }
  return{published,campaigns,automations,analyticsRollups};
}
