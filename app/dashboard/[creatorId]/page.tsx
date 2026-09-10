import { withAuthorizedCreator } from "@/src/modules/auth/authorization";

export default async function CreatorWorkspace({ params }: { params: Promise<{ creatorId: string }> }) {
  const { creatorId } = await params;
  const data = await withAuthorizedCreator(creatorId, async (client, user, role) => {
    const creator = await client.query<{ name: string; slug: string; status: string }>(
      "SELECT name, slug, status::text FROM creators WHERE id = $1 LIMIT 1",
      [creatorId],
    );
    if (!creator.rows[0]) throw new Error("CREATOR_NOT_FOUND");
    return { ...creator.rows[0], email: user.email, role };
  });

  return (
    <main className="shell" style={{ minHeight: "100vh", padding: "60px 0" }}>
      <a href="/dashboard" style={{ color: "#ff7090" }}>← All workspaces</a>
      <span className="kicker" style={{ display: "block", marginTop: 50 }}>TENANT-BOUND WORKSPACE</span>
      <h1 style={{ fontFamily: "Georgia, serif", fontSize: 60, fontWeight: 400, margin: "12px 0" }}>{data.name}</h1>
      <p style={{ color: "#a8a5b1" }}>Authenticated as {data.email} · Role: {data.role} · Status: {data.status}</p>
    </main>
  );
}
