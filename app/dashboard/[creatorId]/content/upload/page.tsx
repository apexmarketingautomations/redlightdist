import { notFound } from "next/navigation";
import { z } from "zod";
import { CreatorShell } from "@/app/components/creator-shell";
import { MediaUploader } from "@/app/components/media-uploader";
import { withAuthorizedCreator } from "@/src/modules/auth/authorization";

export default async function MediaUploadPage({params}:{params:Promise<{creatorId:string}>}){
  const {creatorId}=await params;if(!z.string().uuid().safeParse(creatorId).success)notFound();
  const data=await withAuthorizedCreator(creatorId,async(client,_user,role)=>{
    if(!["owner","admin","editor","platform_admin"].includes(role))return null;
    return (await client.query<{name:string;plan:string}>(`SELECT c.name,coalesce(p.name,'Starter') AS plan FROM creators c LEFT JOIN creator_plans cp ON cp.creator_id=c.id AND cp.billing_status<>'cancelled' LEFT JOIN plans p ON p.id=cp.plan_id WHERE c.id=$1 AND c.deleted_at IS NULL LIMIT 1`,[creatorId])).rows[0]??null;
  });
  if(!data)notFound();
  return <CreatorShell creatorId={creatorId} creatorName={data.name} plan={data.plan} section="content"><div className="creator-console-heading"><div><small>CONTENT LIBRARY</small><h1>Upload media</h1><p>Private, quota-controlled storage for content assets.</p></div><a className="creator-action quiet" href={`/dashboard/${creatorId}/content`}>Back to content</a></div><MediaUploader creatorId={creatorId}/></CreatorShell>;
}
