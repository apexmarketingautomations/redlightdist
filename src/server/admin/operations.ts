"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withPlatformAdmin, audit } from "@/src/server/backoffice/access";
import type { FormState } from "@/app/components/action-form";

const uuid=z.string().uuid(),optionalUuid=z.preprocess(v=>v===""?null:v,z.string().uuid().nullable());
const schema=z.discriminatedUnion("operation",[
  z.object({creatorId:uuid,operation:z.literal("report-update"),reportId:uuid,status:z.enum(["open","reviewing","resolved","rejected","escalated"]),priority:z.enum(["low","normal","high","critical"]),assignedTo:optionalUuid}),
  z.object({creatorId:uuid,operation:z.literal("takedown-update"),takedownId:uuid,status:z.enum(["open","reviewing","removed","rejected","restored"]),assignedTo:optionalUuid,legalHold:z.union([z.literal("on"),z.literal("")]).optional()}),
  z.object({creatorId:uuid,operation:z.literal("alert-update"),alertId:uuid,status:z.enum(["open","acknowledged","resolved"]),assignedTo:optionalUuid}),
  z.object({creatorId:uuid,operation:z.literal("hold-place"),postId:uuid,reason:z.string().trim().min(1).max(5000)}),
  z.object({creatorId:uuid,operation:z.literal("hold-release"),postId:uuid}),
  z.object({creatorId:uuid,operation:z.literal("case-note"),caseType:z.enum(["report","takedown","compliance","domain","billing","other"]),caseId:z.string().trim().min(1).max(255),note:z.string().trim().min(1).max(5000)}),
]);
export async function adminOperationsAction(_state:FormState,form:FormData):Promise<FormState>{const parsed=schema.safeParse(Object.fromEntries(form));if(!parsed.success)return{ok:false,message:"Check the operation fields and try again."};const d=parsed.data;
  try{await withPlatformAdmin(async(client,actor)=>{const creator=await client.query("SELECT 1 FROM creators WHERE id=$1 AND deleted_at IS NULL",[d.creatorId]);if(!creator.rowCount)throw new Error("CREATOR_NOT_FOUND");let targetType="creator",targetId=d.creatorId;
    if(d.operation==="report-update"){const changed=await client.query("UPDATE reports SET status=$3,priority=$4,assigned_to=$5,resolved_at=CASE WHEN $3 IN ('resolved','rejected') THEN coalesce(resolved_at,now()) ELSE NULL END WHERE creator_id=$1 AND id=$2",[d.creatorId,d.reportId,d.status,d.priority,d.assignedTo]);if(!changed.rowCount)throw new Error("REPORT_NOT_FOUND");targetType="report";targetId=d.reportId;}
    else if(d.operation==="takedown-update"){const changed=await client.query("UPDATE takedown_requests SET status=$3,assigned_to=$4,legal_hold=$5,resolved_at=CASE WHEN $3 IN ('removed','rejected','restored') THEN coalesce(resolved_at,now()) ELSE NULL END WHERE creator_id=$1 AND id=$2",[d.creatorId,d.takedownId,d.status,d.assignedTo,d.legalHold==="on"]);if(!changed.rowCount)throw new Error("TAKEDOWN_NOT_FOUND");targetType="takedown";targetId=d.takedownId;}
    else if(d.operation==="alert-update"){const changed=await client.query("UPDATE platform_alerts SET status=$3,assigned_to=$4,acknowledged_at=CASE WHEN $3 IN ('acknowledged','resolved') THEN coalesce(acknowledged_at,now()) ELSE NULL END,resolved_at=CASE WHEN $3='resolved' THEN coalesce(resolved_at,now()) ELSE NULL END WHERE creator_id=$1 AND id=$2",[d.creatorId,d.alertId,d.status,d.assignedTo]);if(!changed.rowCount)throw new Error("ALERT_NOT_FOUND");targetType="platform_alert";targetId=d.alertId;}
    else if(d.operation==="hold-place"){const post=await client.query("SELECT 1 FROM content_posts WHERE creator_id=$1 AND id=$2",[d.creatorId,d.postId]);if(!post.rowCount)throw new Error("POST_NOT_FOUND");await client.query("INSERT INTO content_holds(creator_id,post_id,reason,status,placed_by) VALUES($1,$2,$3,'active',$4) ON CONFLICT(creator_id,post_id) WHERE status='active' DO UPDATE SET reason=excluded.reason,placed_by=excluded.placed_by,placed_at=now()",[d.creatorId,d.postId,d.reason,actor.id]);targetType="content_post";targetId=d.postId;}
    else if(d.operation==="hold-release"){const changed=await client.query("UPDATE content_holds SET status='released',released_by=$3,released_at=now() WHERE creator_id=$1 AND post_id=$2 AND status='active'",[d.creatorId,d.postId,actor.id]);if(!changed.rowCount)throw new Error("HOLD_NOT_FOUND");targetType="content_post";targetId=d.postId;}
    else{await client.query("INSERT INTO compliance_case_notes(creator_id,case_type,case_id,author_user_id,note) VALUES($1,$2,$3,$4,$5)",[d.creatorId,d.caseType,d.caseId,actor.id,d.note]);targetType=d.caseType;targetId=d.caseId;}
    await audit(client,actor.id,`admin.operations.${d.operation}`,targetType,targetId,d.creatorId,{operation:d.operation});
  });}catch(error){const message=error instanceof Error?error.message:"";console.error("Admin operations action failed",{creatorId:d.creatorId,message});return{ok:false,message:"Admin operation could not be completed."};}
  revalidatePath(`/admin/clients/${d.creatorId}/operations`);revalidatePath(`/dashboard/${d.creatorId}`,"layout");return{ok:true,message:"Admin operation saved."};}
