import { Pool } from "pg";
import { env } from "../config/env.js";

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
});

export async function pingDatabase() {
  const result = await pool.query<{ now: string }>("SELECT now()::text AS now");
  return result.rows[0];
}

