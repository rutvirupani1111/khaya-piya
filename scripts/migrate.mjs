// Applies db/migrations/*.sql in order. Usage: DATABASE_URL=... node scripts/migrate.mjs
import { readFileSync, readdirSync } from "node:fs";
import { Pool } from "@neondatabase/serverless";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const dir = new URL("../db/migrations/", import.meta.url);
for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  await pool.query(readFileSync(new URL(f, dir), "utf8"));
  console.log("applied", f);
}
await pool.end();
