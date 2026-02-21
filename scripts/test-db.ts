import { pool } from "../src/db/client.js";

async function main() {
  const result = await pool.query<{
    database_name: string;
    current_user: string;
    server_time: string;
  }>(
    `SELECT current_database() AS database_name, current_user, now()::text AS server_time`
  );
  console.log(result.rows[0]);
}

main()
  .catch((error) => {
    console.error("DB test failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });

