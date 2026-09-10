import { defineConfig } from "drizzle-kit";
const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required for database tooling");
export default defineConfig({ schema: "./src/server/db/schema.ts", out: "./drizzle", dialect: "postgresql", dbCredentials: { url }, strict: true, verbose: true });
