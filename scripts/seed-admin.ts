import { pool } from "../src/db/client.js";
import { hashPassword } from "../src/utils/security.js";

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@coziyoo.local";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "Admin12345!";
  const passwordHash = await hashPassword(password);

  const result = await pool.query<{ id: string; email: string; role: string }>(
    `INSERT INTO admin_users (email, password_hash, role, is_active)
     VALUES ($1, $2, $3, TRUE)
     ON CONFLICT (email)
     DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, updated_at = now()
     RETURNING id, email, role`,
    [email.toLowerCase(), passwordHash, "super_admin"]
  );

  console.log("Seeded admin user:", result.rows[0]);
}

main()
  .catch((error) => {
    console.error("Seed admin failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });

