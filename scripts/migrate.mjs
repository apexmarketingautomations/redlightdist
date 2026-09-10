import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";

const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required");
const pool = new Pool({ connectionString: url, max: 1 });
const client = await pool.connect();
try {
  await client.query("SELECT pg_advisory_lock(731947215)");
  await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const applied = new Set((await client.query("SELECT name FROM schema_migrations")).rows.map(row => row.name));
  for (const name of (await readdir(join(process.cwd(), "migrations"))).filter(name => name.endsWith(".sql")).sort()) {
    if (applied.has(name)) continue;
    const sql = await readFile(join(process.cwd(), "migrations", name), "utf8");
    await client.query("BEGIN");
    try { await client.query(sql); await client.query("INSERT INTO schema_migrations(name) VALUES($1)",[name]); await client.query("COMMIT"); }
    catch (error) { await client.query("ROLLBACK"); throw error; }
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(731947215)").catch(() => undefined);
  client.release(); await pool.end();
}
