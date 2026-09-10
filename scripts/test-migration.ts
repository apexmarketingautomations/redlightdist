import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const db = new PGlite();
try {
  const migrationDir = join(process.cwd(), "migrations");
  const names = (await readdir(migrationDir))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  if (names.length < 18) throw new Error(`Expected at least 18 migrations, found ${names.length}`);

  for (const name of names) {
    const sql = (await readFile(join(migrationDir, name), "utf8")).replace(
      "CREATE EXTENSION IF NOT EXISTS pgcrypto;",
      "",
    );
    try {
      await db.exec(sql);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Migration ${name} failed: ${message}`);
    }
  }

  const plans = await db.query<{ code: string; monthly_price_minor: number }>(
    "SELECT code,monthly_price_minor FROM plans ORDER BY monthly_price_minor",
  );
  if (
    JSON.stringify(plans.rows) !==
    JSON.stringify([
      { code: "starter", monthly_price_minor: 14900 },
      { code: "pro", monthly_price_minor: 29900 },
      { code: "elite", monthly_price_minor: 59900 },
    ])
  )
    throw new Error("Plan seed mismatch");

  const requiredTables = [
    "campaign_deliveries",
    "subscription_change_requests",
    "referral_commissions",
    "content_holds",
    "compliance_case_notes",
    "live_polls",
    "live_poll_options",
    "live_poll_votes",
    "live_offers",
    "live_guest_invites",
    "live_gifts",
    "webhook_events",
    "automation_run_steps",
  ];
  const tables = await db.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public'",
  );
  const present = new Set(tables.rows.map((row) => row.table_name));
  for (const table of requiredTables)
    if (!present.has(table)) throw new Error(`Missing migrated table: ${table}`);

  const tenantTables = [
    "campaign_deliveries",
    "subscription_change_requests",
    "referral_commissions",
    "content_holds",
    "compliance_case_notes",
    "live_polls",
    "live_poll_options",
    "live_poll_votes",
    "live_offers",
    "live_guest_invites",
    "live_gifts",
  ];
  const policies = await db.query<{ tablename: string; policyname: string }>(
    "SELECT tablename,policyname FROM pg_policies WHERE schemaname='public'",
  );
  for (const table of tenantTables) {
    if (!policies.rows.some((row) => row.tablename === table && row.policyname === `${table}_tenant`))
      throw new Error(`Missing tenant RLS policy for ${table}`);
  }

  const functions = await db.query<{ proname: string }>(
    "SELECT proname FROM pg_proc WHERE proname IN ('claim_automation_step','claim_campaign_delivery','publish_due_content','refresh_daily_creator_metrics')",
  );
  const functionNames = new Set(functions.rows.map((row) => row.proname));
  for (const name of [
    "claim_automation_step",
    "claim_campaign_delivery",
    "publish_due_content",
    "refresh_daily_creator_metrics",
  ])
    if (!functionNames.has(name)) throw new Error(`Missing operational function: ${name}`);

  // Prove a new scope-90 tenant table is actually isolated under the restricted runtime role,
  // not merely decorated with a policy definition.
  const creatorA = "11111111-1111-4111-8111-111111111111";
  const creatorB = "22222222-2222-4222-8222-222222222222";
  await db.query(
    "INSERT INTO creators(id,name,slug,status) VALUES($1,'Tenant A','tenant-a','active'),($2,'Tenant B','tenant-b','active')",
    [creatorA, creatorB],
  );
  await db.query(
    "INSERT INTO compliance_case_notes(creator_id,case_type,case_id,note) VALUES($1,'other','a','A only'),($2,'other','b','B only')",
    [creatorA, creatorB],
  );
  await db.exec("SET ROLE redlight_runtime");
  await db.query("SELECT set_config('app.creator_id',$1,false)", [creatorA]);
  const isolated = await db.query<{ note: string }>(
    "SELECT note FROM compliance_case_notes ORDER BY note",
  );
  if (JSON.stringify(isolated.rows) !== JSON.stringify([{ note: "A only" }]))
    throw new Error(`Tenant RLS leak detected: ${JSON.stringify(isolated.rows)}`);
  let crossTenantWriteBlocked = false;
  try {
    await db.query(
      "INSERT INTO compliance_case_notes(creator_id,case_type,case_id,note) VALUES($1,'other','blocked','must fail')",
      [creatorB],
    );
  } catch {
    crossTenantWriteBlocked = true;
  }
  if (!crossTenantWriteBlocked) throw new Error("Tenant RLS allowed a cross-tenant write");
  await db.exec("RESET ROLE");
} finally {
  await db.close();
}
