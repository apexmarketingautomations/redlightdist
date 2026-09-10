import { requireAuthenticatedUser } from "@/src/modules/auth/authorization";
import { withUser } from "@/src/server/db/scoped";

export default async function ClientDashboard() {
  const user = await requireAuthenticatedUser();
  const memberships = await withUser(user.id, async (client) => (
    await client.query<{ creator_id: string; name: string; slug: string; role: string }>(
      `SELECT cu.creator_id, c.name, c.slug, cu.role::text
         FROM creator_users cu JOIN creators c ON c.id = cu.creator_id
        WHERE cu.user_id = $1 AND c.status <> 'deleted'
        ORDER BY c.name`,
      [user.id],
    )
  ).rows);

  return (
    <main className="shell" style={{ minHeight: "100vh", paddingTop: 42 }}>
      <nav style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 28, borderBottom: "1px solid #2a2732" }}>
        <a className="brand" href="/"><span className="brand-mark">R</span>CLIENT PORTAL</a>
        <form action="/api/auth/logout" method="post"><button className="secondary" type="submit" style={{ color: "white", background: "transparent" }}>Log out</button></form>
      </nav>
      <section style={{ padding: "70px 0" }}>
        <span className="kicker">YOUR WORKSPACES</span>
        <h1 style={{ fontFamily: "Georgia, serif", fontSize: 54, fontWeight: 400 }}>Choose a creator account</h1>
        {memberships.length === 0 ? <p style={{ color: "#a8a5b1" }}>Your account is authenticated but has not been assigned to a creator workspace.</p> :
          <div className="feature-grid">{memberships.map((item) => <article key={item.creator_id}>
            <h3>{item.name}</h3><p>Role: {item.role}</p>
            <a className="primary" href={`/dashboard/${item.creator_id}`}>Open workspace</a>
          </article>)}</div>}
      </section>
    </main>
  );
}
