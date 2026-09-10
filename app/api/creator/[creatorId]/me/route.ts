import { NextResponse } from "next/server";
import { getCurrentUser } from "@/src/modules/auth/session";
import { withCreatorUser } from "@/src/server/db/scoped";

export async function GET(_request: Request, { params }: { params: Promise<{ creatorId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { creatorId } = await params;
  try {
    const result = await withCreatorUser(user.id, creatorId, async (client, role) => {
      const creator = await client.query<{ id: string; name: string; slug: string; status: string }>(
        "SELECT id, name, slug, status::text FROM creators WHERE id = $1 LIMIT 1",
        [creatorId],
      );
      return creator.rows[0] ? { creator: creator.rows[0], role } : null;
    });
    return result ? NextResponse.json(result) : NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    if (error instanceof Error && error.message === "CREATOR_ACCESS_DENIED") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Unable to load workspace" }, { status: 500 });
  }
}
