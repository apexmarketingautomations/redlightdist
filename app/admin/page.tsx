import { redirect } from "next/navigation";
import { getCurrentUser } from "@/src/modules/auth/session";

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user?.isPlatformAdmin) redirect("/login");

  return (
    <main className="shell" style={{ minHeight: "100vh", paddingTop: 42 }}>
      <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 28, borderBottom: "1px solid #2a2732" }}>
        <a className="brand" href="/"><span className="brand-mark">R</span>REDLIGHT ADMIN</a>
        <form action="/api/auth/logout" method="post"><button className="secondary" type="submit" style={{ color: "white", background: "transparent", cursor: "pointer" }}>Log out</button></form>
      </nav>
      <section style={{ padding: "80px 0" }}>
        <span className="kicker">PLATFORM ADMIN</span>
        <h1 style={{ fontFamily: "Georgia, serif", fontSize: "clamp(44px,7vw,76px)", fontWeight: 400, margin: "12px 0" }}>Dashboard foundation</h1>
        <p style={{ color: "#a8a5b1", maxWidth: 650 }}>You are securely signed in as {user.email}. Authentication, database-backed sessions, protected routing and logout are active.</p>
      </section>
    </main>
  );
}
