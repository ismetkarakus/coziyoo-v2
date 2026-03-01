#!/usr/bin/env tsx
/**
 * Seed initial admin user
 */
import { pool } from '../src/db/client.js';
import argon2 from 'argon2';

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@coziyoo.com';
  const password = process.env.SEED_ADMIN_PASSWORD || 'changeme123';
  
  try {
    // Check if admin already exists
    const existing = await pool.query(
      'SELECT id FROM admin_users WHERE email = $1',
      [email]
    );
    
    if (existing.rows.length > 0) {
      console.log(`Admin user ${email} already exists.`);
      await pool.end();
      return;
    }

    const passwordHash = await argon2.hash(password);
    
    await pool.query(
      `INSERT INTO admin_users (email, password_hash, role) VALUES ($1, $2, 'super_admin')`,
      [email, passwordHash]
    );
    
    console.log(`✓ Created admin user: ${email}`);
  } catch (error) {
    console.error('Failed to seed admin:', error);
    await pool.end();
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
