import { Pool } from "pg";

const globalForDb = globalThis as typeof globalThis & { redlightPool?: Pool };

export const db =
  globalForDb.redlightPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });

db.on("error", () => console.error("Database idle connection unavailable"));

if (process.env.NODE_ENV !== "production") globalForDb.redlightPool = db;
