import { Pool } from "pg";

const globalForDb = globalThis as typeof globalThis & { redlightPool?: Pool };

export const db =
  globalForDb.redlightPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  });

if (process.env.NODE_ENV !== "production") globalForDb.redlightPool = db;
