import { OfficeShell } from "@/app/components/office-shell";
import { requireAuthenticatedUser } from "@/src/modules/auth/authorization";
import { withUser } from "@/src/server/db/scoped";
export default async function ClientDashboard() {
  const user=await requireAuthenticatedUser();
  const memberships=await withUser(user.id,async client=>(await client.query<{creator_id:string;name:string;role:string;status:string}>("SELECT cu.creator_id,c.name,cu.role::text,c.status::text FROM creator_users cu JOIN creators c ON c.id=cu.creator_id WHERE cu.user_id=$1 AND c.deleted_at IS NULL AND c.status<>'deleted' ORDER BY c.name LIMIT 200",[user.id])).rows);
  return <OfficeShell title="My workspaces" description={`Signed in as ${user.email}`}>
    {user.isPlatformAdmin&&<p className="office-notice"><a href="/admin">Open platform administration →</a></p>}
    <section className="office-list">{memberships.map(m=><article className="office-panel office-row" key={m.creator_id}><div><h2>{m.name}</h2><p>{m.role} · <span className="office-badge">{m.status}</span></p></div>{m.status==="suspended"?<p>Contact your platform administrator to restore access.</p>:<a className="office-button" href={`/dashboard/${m.creator_id}`}>Open workspace</a>}</article>)}{!memberships.length&&<div className="office-empty"><h2>No workspaces assigned yet</h2><p>Your account is ready. Your platform administrator can connect it to a client workspace.</p><a href="/account">Manage my account →</a></div>}</section>
  </OfficeShell>;
}
