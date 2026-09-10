import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

const db = new PGlite();
try {
  const sql = (await readFile(new URL("../migrations/0001_foundation.sql", import.meta.url), "utf8"))
    .replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", "");
  await db.exec(sql);
  const plans = await db.query<{code:string;monthly_price_minor:number}>("SELECT code,monthly_price_minor FROM plans ORDER BY monthly_price_minor");
  if (JSON.stringify(plans.rows) !== JSON.stringify([{code:"starter",monthly_price_minor:14900},{code:"pro",monthly_price_minor:29900},{code:"elite",monthly_price_minor:59900}])) throw new Error("Plan seed mismatch");
  await db.exec(sql);
  const migrations = await db.query<{count:number}>("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public'");
  if ((migrations.rows[0]?.count ?? 0) < 13) throw new Error("Foundation schema is incomplete");
} finally { await db.close(); }
