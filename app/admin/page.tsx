import { OfficeShell } from "@/app/components/office-shell";
import { ActionForm } from "@/app/components/action-form";
import { serviceCatalog } from "@/src/modules/services/catalog";
import { adminAction } from "@/src/server/backoffice/actions";
import { withPlatformAdmin } from "@/src/server/backoffice/access";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; page?: string }>;
}) {
  const search = await searchParams;
  const view = ["users", "clients", "activity"].includes(search.view ?? "")
    ? search.view!
    : "overview";
  const q = (search.q ?? "").trim().slice(0, 100);
  const page = Math.max(
    1,
    Math.min(100000, Number.parseInt(search.page ?? "1") || 1),
  );
  const limit = 25;
  const data = await withPlatformAdmin(async (client) => {
    const counts = (
      await client.query<{
        users: number;
        clients: number;
        active: number;
        suspended: number;
      }>(
        `SELECT (SELECT count(*)::int FROM platform_users) AS users,(SELECT count(*)::int FROM creators WHERE deleted_at IS NULL) AS clients,(SELECT count(*)::int FROM creators WHERE status='active') AS active,(SELECT count(*)::int FROM creators WHERE status='suspended') AS suspended`,
      )
    ).rows[0]!;
    const users =
      view === "users"
        ? (
            await client.query<{
              id: string;
              email: string;
              is_platform_admin: boolean;
              disabled_at: Date | null;
            }>(
              "SELECT id,email,is_platform_admin,disabled_at FROM platform_users WHERE email ILIKE $1 ORDER BY created_at DESC,id LIMIT 26 OFFSET $2",
              [`%${q}%`, (page - 1) * limit],
            )
          ).rows
        : [];
    const clients = ["clients", "overview"].includes(view)
      ? (
          await client.query<{
            id: string;
            name: string;
            slug: string;
            status: string;
            members: number;
          }>(
            "SELECT c.id,c.name,c.slug,c.status::text,(SELECT count(*)::int FROM creator_users cu WHERE cu.creator_id=c.id) AS members FROM creators c WHERE c.deleted_at IS NULL AND (c.name ILIKE $1 OR c.slug ILIKE $1) ORDER BY c.created_at DESC,c.id LIMIT $2 OFFSET $3",
            [
              `%${q}%`,
              view === "overview" ? 6 : 26,
              view === "overview" ? 0 : (page - 1) * limit,
            ],
          )
        ).rows
      : [];
    const activity =
      view === "activity"
        ? (
            await client.query<{
              id: string;
              action: string;
              email: string | null;
              name: string | null;
              created_at: Date;
            }>(
              "SELECT a.id,a.action,u.email,c.name,a.created_at FROM audit_logs a LEFT JOIN platform_users u ON u.id=a.actor_user_id LEFT JOIN creators c ON c.id=a.creator_id ORDER BY a.created_at DESC,a.id LIMIT 26 OFFSET $1",
              [(page - 1) * limit],
            )
          ).rows
        : [];
    return { counts, users, clients, activity };
  });
  const hasNext =
    (view === "users"
      ? data.users
      : view === "clients"
        ? data.clients
        : data.activity
    ).length > limit;
  return (
    <OfficeShell
      admin
      title={
        view === "overview"
          ? "Platform overview"
          : view === "users"
            ? "Users"
            : view === "clients"
              ? "Client workspaces"
              : "Activity history"
      }
      description="Manage accounts, client workspaces, services, and platform access."
    >
      <section className="office-stats">
        {Object.entries({
          Users: data.counts.users,
          "Client workspaces": data.counts.clients,
          "Active workspaces": data.counts.active,
          Suspended: data.counts.suspended,
        }).map(([label, value]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>
      {view === "overview" && (
        <>
          <div className="office-actions">
            <a className="office-button" href="/admin?view=users">
              Create a user
            </a>
            <a className="office-button quiet" href="/admin?view=clients">
              Set up a client
            </a>
            <a className="office-button quiet" href="/dashboard">
              Open client portal
            </a>
          </div>
          <h2>Platform services</h2>
          <section className="office-list">
            {serviceCatalog.map((service) => (
              <article className="office-panel" key={service.name}>
                <h2>{service.name}</h2>
                <p>{service.description}</p>
                <span className="office-badge">Available</span>
              </article>
            ))}
          </section>
        </>
      )}
      {["users", "clients"].includes(view) && (
        <form className="office-search" method="get">
          <input type="hidden" name="view" value={view} />
          <label>
            Search {view}
            <input
              name="q"
              defaultValue={q}
              placeholder={
                view === "users" ? "Email address" : "Name or workspace address"
              }
            />
          </label>
          <button className="office-button quiet">Search</button>
        </form>
      )}
      {view === "users" && (
        <>
          <details className="office-panel" open>
            <summary>Create a user</summary>
            <p>
              Set an initial password and share credentials through your usual
              secure channel. New users have client access until you assign a
              platform role or workspace.
            </p>
            <ActionForm action={adminAction} label="Create user">
              <input type="hidden" name="operation" value="create-user" />
              <label>
                Email
                <input name="email" type="email" required maxLength={320} />
              </label>
              <label>
                Initial password
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                />
              </label>
            </ActionForm>
          </details>
          <section className="office-list">
            {data.users.slice(0, limit).map((u) => (
              <article className="office-panel" key={u.id}>
                <h2>{u.email}</h2>
                <p>
                  <span className="office-badge">
                    {u.is_platform_admin ? "Platform admin" : "Client user"}
                  </span>{" "}
                  {u.disabled_at ? "Disabled" : "Active"}
                </p>
                <details>
                  <summary>Manage access</summary>
                  <ActionForm action={adminAction} label="Update platform role">
                    <input type="hidden" name="operation" value="user-role" />
                    <input type="hidden" name="userId" value={u.id} />
                    <label>
                      Platform role
                      <select
                        name="role"
                        defaultValue={u.is_platform_admin ? "admin" : "client"}
                      >
                        <option value="client">Client user</option>
                        <option value="admin">
                          Platform administrator — full management access
                        </option>
                      </select>
                    </label>
                  </ActionForm>
                  <ActionForm
                    action={adminAction}
                    label={u.disabled_at ? "Enable user" : "Disable user"}
                  >
                    <input type="hidden" name="operation" value="user-status" />
                    <input type="hidden" name="userId" value={u.id} />
                    <input
                      type="hidden"
                      name="status"
                      value={u.disabled_at ? "active" : "disabled"}
                    />
                    <p>
                      Changing access signs this user out of existing sessions.
                    </p>
                  </ActionForm>
                </details>
              </article>
            ))}
            {!data.users.length && (
              <p className="office-empty">No users match your search.</p>
            )}
          </section>
        </>
      )}
      {["clients", "overview"].includes(view) && (
        <>
          {view === "clients" && (
            <details className="office-panel" open>
              <summary>Create a client workspace</summary>
              <ActionForm action={adminAction} label="Create workspace">
                <input type="hidden" name="operation" value="create-client" />
                <label>
                  Client name
                  <input name="name" required maxLength={120} />
                </label>
                <label>
                  Workspace address
                  <input
                    name="slug"
                    required
                    pattern="[a-z0-9]+(-[a-z0-9]+)*"
                    maxLength={63}
                    placeholder="client-name"
                  />
                </label>
                <label>
                  Owner email
                  <input name="ownerEmail" type="email" required />
                </label>
                <p>
                  Create the owner&apos;s user account first. New workspaces start as
                  drafts.
                </p>
              </ActionForm>
            </details>
          )}
          <h2>
            {view === "overview"
              ? "Recent client workspaces"
              : "Client directory"}
          </h2>
          <section className="office-list">
            {data.clients.slice(0, limit).map((c) => (
              <article className="office-panel office-row" key={c.id}>
                <div>
                  <h2>{c.name}</h2>
                  <p>
                    {c.slug} · {c.members} member{c.members === 1 ? "" : "s"} ·{" "}
                    <span className="office-badge">{c.status}</span>
                  </p>
                </div>
                <a
                  className="office-button quiet"
                  href={`/admin/clients/${c.id}`}
                >
                  Manage client
                </a>
              </article>
            ))}
            {!data.clients.length && (
              <p className="office-empty">
                No client workspaces yet. Create a user, then assign them as the
                owner of a new workspace.
              </p>
            )}
          </section>
        </>
      )}
      {view === "activity" && (
        <section className="office-list">
          {data.activity.slice(0, limit).map((a) => (
            <article key={a.id} className="office-panel">
              <h2>{a.action.replaceAll(".", " ")}</h2>
              <p>
                {a.email ?? "Former user"}
                {a.name ? ` · ${a.name}` : ""}
              </p>
              <time dateTime={a.created_at.toISOString()}>
                {a.created_at.toISOString().replace("T", " ").slice(0, 19)} UTC
              </time>
            </article>
          ))}
          {!data.activity.length && (
            <p className="office-empty">No recorded management actions yet.</p>
          )}
        </section>
      )}
      {view !== "overview" && (
        <nav className="office-pagination" aria-label="Results pages">
          {page > 1 && (
            <a
              href={`/admin?view=${view}&q=${encodeURIComponent(q)}&page=${page - 1}`}
            >
              ← Previous
            </a>
          )}
          <span>Page {page}</span>
          {hasNext && (
            <a
              href={`/admin?view=${view}&q=${encodeURIComponent(q)}&page=${page + 1}`}
            >
              Next →
            </a>
          )}
        </nav>
      )}
    </OfficeShell>
  );
}
