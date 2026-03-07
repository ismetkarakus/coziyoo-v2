import { Pool } from "pg";
import { env } from "../config/env.js";

function resolveSslOption() {
  if (env.DATABASE_SSL_MODE === "disable") return false;
  if (env.DATABASE_SSL_MODE === "require") return true;
  if (env.DATABASE_SSL_MODE === "no-verify") return { rejectUnauthorized: false };

  try {
    const dbUrl = new URL(env.DATABASE_URL);
    const host = dbUrl.hostname.toLowerCase();
    const sslMode = dbUrl.searchParams.get("sslmode")?.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1") return false;
    if (sslMode === "disable") return false;
    if (sslMode === "require" || sslMode === "verify-ca" || sslMode === "verify-full") {
      return { rejectUnauthorized: false };
    }
  } catch {
    // Keep backward-compatible fallback below.
  }

  return env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false };
}

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: resolveSslOption(),
});

// Prevent process crashes when postgres restarts and idle clients emit errors.
pool.on("error", (err: Error) => {
  console.error("Postgres pool idle client error:", err.message);
});

export async function pingDatabase() {
  const result = await pool.query<{ now: string }>("SELECT now()::text AS now");
  return result.rows[0];
}

export function createDbClient() {
  return pool;
}
