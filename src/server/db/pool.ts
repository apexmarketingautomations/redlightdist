import { Pool } from "pg";

const globalForDb = globalThis as typeof globalThis & { redlightPool?: Pool };

const existingPool = globalForDb.redlightPool;
export const db =
  existingPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    maxUses: 7500,
  });

if (!existingPool) {
  db.on("error", () => console.error("Database idle connection unavailable"));
  globalForDb.redlightPool = db;
}
