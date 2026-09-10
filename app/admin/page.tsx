import { requirePlatformAdmin } from "@/src/modules/auth/authorization";

export default async function AdminPage() {
  const user = await requirePlatformAdmin();
  return (
    <main className="shell" style={{ minHeight: "100vh", paddingTop: 42 }}>
      <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 28, borderBottom: "1px solid #2a2732" }}>
        <a className="brand" href="/"><span className="brand-mark">R</span>REDLIGHT PLATFORM ADMIN</a>
        <form action="/api/auth/logout" method="post"><button className="secondary" type="submit" style={{ color: "white", background: "transparent", cursor: "pointer" }}>Log out</button></form>
      </nav>
      <section style={{ padding: "80px 0" }}>
        <span className="kicker">PLATFORM OPERATIONS</span>
        <h1 style={{ fontFamily: "Georgia, serif", fontSize: "clamp(44px,7vw,76px)", fontWeight: 400, margin: "12px 0" }}>Administrator dashboard</h1>
        <p style={{ color: "#a8a5b1", maxWidth: 650 }}>Signed in as {user.email}. This area is restricted to platform administrators and does not grant automatic access to any creator’s tenant data.</p>
      </section>
    </main>
  );
}
