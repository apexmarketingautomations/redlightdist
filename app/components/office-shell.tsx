import type { ReactNode } from "react";
export function OfficeShell({
  admin = false,
  title,
  description,
  children,
}: {
  admin?: boolean;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <main className="office">
      <header className="office-header">
        <a className="office-brand" href={admin ? "/admin" : "/dashboard"}>
          REDLIGHT <span>{admin ? "ADMIN" : "CLIENT"}</span>
        </a>
        <form action="/api/auth/logout" method="post">
          <button className="office-button quiet" type="submit">
            Log out
          </button>
        </form>
      </header>
      <nav className="office-nav" aria-label="Back office">
        {admin ? (
          <>
            <a href="/admin">Overview</a>
            <a href="/admin?view=clients">Clients</a>
            <a href="/admin?view=users">Users</a>
            <a href="/admin?view=activity">Activity</a>
            <a href="/dashboard">Client portal</a>
          </>
        ) : (
          <>
            <a href="/dashboard">Workspaces & services</a>
            <a href="/admin">Admin portal</a>
          </>
        )}
        <a href="/account">My account</a>
        <a href="/">Website</a>
      </nav>
      <div className="office-heading">
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children}
    </main>
  );
}
