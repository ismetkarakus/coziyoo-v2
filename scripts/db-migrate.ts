import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "../src/db/client.js";

type Migration = {
  version: string;
  filename: string;
  fullPath: string;
};

const LOCK_KEY = 912_020_001;

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

async function getMigrations(dir: string): Promise<Migration[]> {
  const files = (await readdir(dir))
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));
  return files.map((filename) => ({
    version: filename.replace(/\.sql$/i, ""),
    filename,
    fullPath: path.join(dir, filename),
  }));
}

async function main() {
  const client = await pool.connect();
  const migrationDir = path.resolve(process.cwd(), "src/db/migrations");

  try {
    const migrations = await getMigrations(migrationDir);
    if (migrations.length === 0) {
      console.log("No migration files found, skipping.");
      return;
    }

    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const appliedRows = await client.query<{ version: string }>(
      "SELECT version FROM schema_migrations ORDER BY version ASC"
    );
    const applied = new Set(appliedRows.rows.map((row) => row.version));

    if (applied.size === 0) {
      const tableCount = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM pg_tables
         WHERE schemaname = 'public'
           AND tablename <> 'schema_migrations'`
      );
      const hasExistingTables = Number(tableCount.rows[0]?.count ?? "0") > 0;

      if (hasExistingTables) {
        const baseline = process.env.DB_MIGRATE_BASELINE?.trim();
        if (!baseline) {
          throw new Error(
            "Database is not empty and schema_migrations is empty. " +
              "Set DB_MIGRATE_BASELINE (e.g. 0001_initial_schema) once, or use an empty database."
          );
        }

        const baselineIndex = migrations.findIndex((m) => m.version === baseline);
        if (baselineIndex < 0) {
          throw new Error(`DB_MIGRATE_BASELINE '${baseline}' not found in src/db/migrations.`);
        }

        console.log(`Applying baseline up to ${baseline} without executing SQL.`);
        for (const migration of migrations.slice(0, baselineIndex + 1)) {
          const sql = await readFile(migration.fullPath, "utf8");
          const checksum = sha256(sql);
          await client.query(
            `INSERT INTO schema_migrations (version, checksum)
             VALUES ($1, $2)
             ON CONFLICT (version) DO NOTHING`,
            [migration.version, checksum]
          );
          applied.add(migration.version);
        }
      }
    }

    const pending = migrations.filter((migration) => !applied.has(migration.version));
    if (pending.length === 0) {
      console.log("No pending migrations.");
      return;
    }

    for (const migration of pending) {
      const sql = await readFile(migration.fullPath, "utf8");
      const checksum = sha256(sql);

      console.log(`Running migration ${migration.filename}...`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)",
          [migration.version, checksum]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    console.log(`Applied ${pending.length} migration(s).`);
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
    } catch {
      // ignore unlock errors during shutdown
    }
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
