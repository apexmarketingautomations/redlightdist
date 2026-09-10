import { OfficeShell } from "@/app/components/office-shell";
import { requireAuthenticatedUser } from "@/src/modules/auth/authorization";
import { serviceCatalog } from "@/src/modules/services/catalog";
import { withUser } from "@/src/server/db/scoped";

export default async function ClientDashboard() {
  const user = await requireAuthenticatedUser();
  const memberships = await withUser(user.id, async client => {
    if (user.isPlatformAdmin) {
      await client.query("SELECT set_config('app.platform_admin','true',true)");
      return (await client.query<{creator_id:string;name:string;role:string;status:string}>(
        "SELECT c.id AS creator_id,c.name,'platform_admin'::text AS role,c.status::text FROM creators c WHERE c.deleted_at IS NULL AND c.status<>'deleted' ORDER BY c.name LIMIT 200"
      )).rows;
    }
    return (await client.query<{creator_id:string;name:string;role:string;status:string}>(
      "SELECT cu.creator_id,c.name,cu.role::text,c.status::text FROM creator_users cu JOIN creators c ON c.id=cu.creator_id WHERE cu.user_id=$1 AND c.deleted_at IS NULL AND c.status<>'deleted' ORDER BY c.name LIMIT 200",
      [user.id]
    )).rows;
  });

  return <OfficeShell title="Client portal" description={`Signed in as ${user.email}`}>
    {user.isPlatformAdmin && <p className="office-notice">Platform administrator access is active. You can enter every client workspace from this portal. <a href="/admin">Open admin back office →</a></p>}

    <h2>Available services</h2>
    <section className="office-list">
      {serviceCatalog.map(service => <article className="office-panel" key={service.name}><h2>{service.name}</h2><p>{service.description}</p><span className="office-badge">Available</span></article>)}
    </section>

    <h2>{user.isPlatformAdmin ? "All client workspaces" : "My workspaces"}</h2>
    <section className="office-list">
      {memberships.map(m => <article className="office-panel office-row" key={m.creator_id}><div><h2>{m.name}</h2><p>{m.role} · <span className="office-badge">{m.status}</span></p></div>{m.status==="suspended" && !user.isPlatformAdmin ? <p>Contact your platform administrator to restore access.</p> : <a className="office-button" href={`/dashboard/${m.creator_id}`}>Open workspace</a>}</article>)}
      {!memberships.length && <div className="office-empty"><h2>No workspaces assigned yet</h2><p>Your account is ready. Your platform administrator can connect it to a client workspace.</p><a href="/account">Manage my account →</a></div>}
    </section>
  </OfficeShell>;
}
