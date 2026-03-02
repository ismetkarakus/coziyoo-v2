#!/usr/bin/env tsx
/**
 * Seed initial admin user.
 *
 * Email is stored in lowercase to match the login endpoint which calls
 * email.toLowerCase() before querying (see src/routes/admin-auth.ts).
 *
 * Usage:
 *   SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD=secret npx tsx scripts/seed-admin.ts
 */

import { pool } from "../src/db/client.js";
import argon2 from "argon2";

async function main() {
  const rawEmail = process.env.SEED_ADMIN_EMAIL || "admin@coziyoo.com";
  // Normalize to lowercase — login queries with email.toLowerCase()
  const email = rawEmail.toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || "Admin12345";

  try {
    // Check if admin already exists (case-insensitive by design since email is always stored lowercase)
    const existing = await pool.query(
      "SELECT id FROM admin_users WHERE email = $1",
      [email]
    );
    if (existing.rows.length > 0) {
      console.log(`Admin user ${email} already exists, skipping.`);
      return;
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await pool.query(
      `INSERT INTO admin_users (email, password_hash, role) VALUES ($1, $2, 'super_admin')`,
      [email, passwordHash]
    );
    console.log(`✓ Created admin user: ${email}`);
  } catch (error) {
    console.error("Failed to seed admin:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
