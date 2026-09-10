import { notFound } from "next/navigation";
import { z } from "zod";
import { OfficeShell } from "@/app/components/office-shell";
import { ActionForm } from "@/app/components/action-form";
import { adminAction, settingsAction } from "./actions";
import { withPlatformAdmin } from "./access";
import { withAuthorizedCreator } from "@/src/modules/auth/authorization";
import type { PoolClient } from "pg";

export async function Workspace({creatorId,admin=false}:{creatorId:string;admin?:boolean}) {
  if (!z.string().uuid().safeParse(creatorId).success) notFound();
  const query=async(client:PoolClient,role:string)=> {
    const creator=(await client.query<{name:string;slug:string;status:string;bio:string}>("SELECT c.name,c.slug,c.status::text,coalesce(s.bio,'') AS bio FROM creators c LEFT JOIN creator_settings s ON s.creator_id=c.id WHERE c.id=$1 AND c.deleted_at IS NULL",[creatorId])).rows[0];
    if (!creator) notFound();
    const manage=admin||["owner","admin"].includes(role);
    const members=manage?(await client.query<{user_id:string;email:string;role:string}>("SELECT cu.user_id,u.email,cu.role::text FROM creator_users cu JOIN platform_users u ON u.id=cu.user_id WHERE cu.creator_id=$1 ORDER BY u.email LIMIT 200",[creatorId])).rows:[];
    const domains=(await client.query<{hostname:string;status:string}>("SELECT hostname,status::text FROM creator_domains WHERE creator_id=$1 ORDER BY hostname LIMIT 100",[creatorId])).rows;
    const plans=manage?(await client.query<{name:string;billing_status:string}>("SELECT p.name,cp.billing_status::text FROM creator_plans cp JOIN plans p ON p.id=cp.plan_id WHERE cp.creator_id=$1 AND cp.billing_status<>'cancelled' LIMIT 1",[creatorId])).rows:[];
    return {...creator,role,manage,members,domains,plan:plans[0]};
  };
  const data=admin?await withPlatformAdmin(client=>query(client,"platform admin")):await withAuthorizedCreator(creatorId,(client,_user,role)=>query(client,role));
  return <OfficeShell admin={admin} title={data.name} description={`${data.slug} · ${data.status} · Your role: ${data.role}`}>
    {admin&&<p className="office-notice">You are managing this client as a platform administrator. Saved changes are recorded in activity history.</p>}
    <section className="office-stats"><article><span>Workspace status</span><strong className="text-value">{data.status}</strong></article><article><span>Plan</span><strong className="text-value">{data.plan?.name ?? "Unassigned"}</strong></article>{data.plan&&<article><span>Billing status</span><strong className="text-value">{data.plan.billing_status}</strong></article>}</section>
    <div className="office-columns"><section className="office-panel"><h2>Workspace settings</h2>{data.manage?<ActionForm action={settingsAction}><input type="hidden" name="creatorId" value={creatorId}/>{admin&&<input type="hidden" name="admin" value="true"/>}<label>Client name<input name="name" required maxLength={120} defaultValue={data.name}/></label><label>Bio<textarea name="bio" maxLength={2000} rows={5} defaultValue={data.bio}/></label></ActionForm>:<p>{data.bio||"The workspace owner has not added a bio yet."}</p>}</section><section className="office-panel"><h2>Domains</h2>{data.domains.length?data.domains.map(d=><p key={d.hostname}>{d.hostname} <span className="office-badge">{d.status}</span></p>):<p>No domains connected.</p>}{admin&&<><h2>Workspace access</h2><ActionForm action={adminAction} label="Update workspace status"><input type="hidden" name="operation" value="client-status"/><input type="hidden" name="creatorId" value={creatorId}/><label>Status<select name="status" defaultValue={data.status}><option value="draft">Draft</option><option value="active">Active</option><option value="suspended">Suspended</option></select></label><p>Suspending a workspace blocks all client access until you restore it.</p></ActionForm></>}</section></div>
    {data.manage&&<section className="office-panel"><h2>Workspace members</h2>{data.members.map(m=><div className="office-member" key={m.user_id}><div><strong>{m.email}</strong><p>{m.role}</p></div>{admin&&<ActionForm action={adminAction} label="Remove membership"><input type="hidden" name="operation" value="remove-member"/><input type="hidden" name="creatorId" value={creatorId}/><input type="hidden" name="userId" value={m.user_id}/></ActionForm>}</div>)}{data.members.length===200&&<p>Showing the first 200 members.</p>}{admin&&<details><summary>Add a member or change their role</summary><ActionForm action={adminAction} label="Save membership"><input type="hidden" name="operation" value="membership"/><input type="hidden" name="creatorId" value={creatorId}/><label>User email<input type="email" name="email" required/></label><label>Workspace role<select name="role" defaultValue="editor">{["owner","admin","editor","analyst","support"].map(r=><option key={r} value={r}>{r}</option>)}</select></label></ActionForm></details>}</section>}
  </OfficeShell>;
}
