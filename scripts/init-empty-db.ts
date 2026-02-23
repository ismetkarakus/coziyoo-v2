import { readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "../src/db/client.js";

async function main() {
  const force = process.env.FORCE_DB_INIT === "true";
  const tables = await pool.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
  );

  if (tables.rowCount && tables.rowCount > 0 && !force) {
    const names = tables.rows.map((row) => row.tablename).slice(0, 10);
    throw new Error(
      `Database is not empty (${tables.rowCount} tables found, e.g. ${names.join(", ")}). ` +
        "Refusing to run destructive init. Set FORCE_DB_INIT=true only if you intentionally want a full reset."
    );
  }

  const sqlPath = path.resolve(process.cwd(), "src/db/reset-and-init-schema.sql");
  const sql = await readFile(sqlPath, "utf8");
  await pool.query(sql);
  console.log("Database schema initialized.");
}

main()
  .catch((error) => {
    console.error("DB init failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
