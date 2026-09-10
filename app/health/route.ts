import { Pool } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 10000,
  query_timeout: 3000,
});
pool.on("error", () => console.error("Database idle connection unavailable"));

export async function GET() {
  try {
    if (!process.env.DATABASE_URL) throw new Error("Database not configured");
    await pool.query("SELECT 1");
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
