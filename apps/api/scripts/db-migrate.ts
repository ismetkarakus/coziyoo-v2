#!/usr/bin/env tsx
/**
 * Simple PostgreSQL migration runner
 * Applies SQL files from src/db/migrations/ in order
 */
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../src/db/client.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'src', 'db', 'migrations');

async function getAppliedMigrations(): Promise<Set<string>> {
  try {
    const result = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'schema_migrations'"
    );
    if (result.rows.length === 0) {
      return new Set<string>();
    }
    const migrations = await pool.query('SELECT filename FROM schema_migrations');
    return new Set(migrations.rows.map(r => r.filename));
  } catch {
    return new Set<string>();
  }
}

async function runMigration(filename: string, sql: string) {
  console.log(`Running migration: ${filename}`);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      'INSERT INTO schema_migrations (filename, applied_at) VALUES ($1, NOW()) ON CONFLICT (filename) DO NOTHING',
      [filename]
    );
    await client.query('COMMIT');
    console.log(`✓ Applied: ${filename}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  try {
    // Ensure migrations table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const applied = await getAppliedMigrations();
    const files = await readdir(MIGRATIONS_DIR);
    const migrationFiles = files
      .filter(f => f.endsWith('.sql'))
      .sort();

    let appliedCount = 0;
    for (const filename of migrationFiles) {
      if (applied.has(filename)) {
        console.log(`✓ Already applied: ${filename}`);
        continue;
      }

      const sql = await readFile(join(MIGRATIONS_DIR, filename), 'utf-8');
      await runMigration(filename, sql);
      appliedCount++;
    }

    if (appliedCount === 0) {
      console.log('No new migrations to apply.');
    } else {
      console.log(`Applied ${appliedCount} migration(s).`);
    }
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
