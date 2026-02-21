import { readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "../src/db/client.js";

async function main() {
  const sqlPath = path.resolve(process.cwd(), "src/db/reset-and-init-schema.sql");
  const sql = await readFile(sqlPath, "utf8");
  await pool.query(sql);
  console.log("Database reset + new schema initialization completed.");
}

main()
  .catch((error) => {
    console.error("DB reset/init failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
