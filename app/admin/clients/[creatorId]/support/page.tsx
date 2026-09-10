import { notFound } from "next/navigation";
import { z } from "zod";
import { OfficeShell } from "@/app/components/office-shell";
import { ActionForm } from "@/app/components/action-form";
import { withPlatformAdmin } from "@/src/server/backoffice/access";
import { startSupportSession } from "@/src/server/admin/support";

export default async function SupportAccessPage({params}:{params:Promise<{creatorId:string}>}){
  const {creatorId}=await params;if(!z.string().uuid().safeParse(creatorId).success)notFound();
  const creator=await withPlatformAdmin(async client=>(await client.query<{name:string;slug:string;status:string}>("SELECT name,slug,status::text FROM creators WHERE id=$1 AND deleted_at IS NULL",[creatorId])).rows[0]);if(!creator)notFound();
  return <OfficeShell admin title={`Support access · ${creator.name}`} description="Enter the creator workspace in an explicitly audited support session."><section className="office-panel"><h2>Start support impersonation</h2><p>This does not change your administrator identity or silently make you a tenant member. It records who entered the workspace, which creator was accessed, the stated reason, and the session lifetime. Access expires after 30 minutes.</p><ActionForm action={startSupportSession} label="Start audited support session"><input type="hidden" name="creatorId" value={creatorId}/><label>Reason<textarea name="reason" required minLength={3} maxLength={1000} rows={4} placeholder="Example: Creator requested help configuring memberships"/></label></ActionForm></section><a className="office-button quiet" href={`/admin/clients/${creatorId}`}>Back to client</a></OfficeShell>;
}
