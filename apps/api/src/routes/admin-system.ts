import { readFile } from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/client.js";
import { requireSuperAdmin } from "../middleware/admin-rbac.js";
import { requireAuth } from "../middleware/auth.js";
import { normalizeDisplayName } from "../utils/normalize.js";
import { hashPassword } from "../utils/security.js";

const ResetDatabaseSchema = z.object({
  confirmText: z.literal("RESET DATABASE"),
});

const SeedDemoDataSchema = z.object({
  confirmText: z.literal("SEED DEMO DATA"),
});

export const adminSystemRouter = Router();

adminSystemRouter.get("/system/version", requireAuth("admin"), async (_req, res) => {
  let commit = "unknown";
  try {
    commit = execSync("git rev-parse --short HEAD", { cwd: process.cwd(), stdio: ["ignore", "pipe", "ignore"] })
      .toString("utf8")
      .trim();
  } catch {
    commit = "unknown";
  }

  return res.json({
    data: {
      commit,
    },
  });
});

adminSystemRouter.post("/system/reset-database", requireAuth("admin"), requireSuperAdmin, async (req, res) => {
  const parsed = ResetDatabaseSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: 'confirmText must be "RESET DATABASE"',
        details: parsed.error.flatten(),
      },
    });
  }

  const sqlPath = path.resolve(process.cwd(), "src/db/reset-and-init-schema.sql");
  const sql = await readFile(sqlPath, "utf8");
  await pool.query(sql);

  return res.json({
    data: {
      ok: true,
      message: "Database reset and schema reinitialized.",
    },
  });
});

adminSystemRouter.post("/system/seed-demo-data", requireAuth("admin"), requireSuperAdmin, async (req, res) => {
  const parsed = SeedDemoDataSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: 'confirmText must be "SEED DEMO DATA"',
        details: parsed.error.flatten(),
      },
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const sellerEmail = "demo.seller@coziyoo.local";
    const buyerEmail = "demo.buyer@coziyoo.local";
    const defaultPassword = "Demo12345!";

    async function ensureUser(args: {
      email: string;
      displayName: string;
      fullName: string;
      userType: "buyer" | "seller" | "both";
    }): Promise<string> {
      const existing = await client.query<{ id: string }>("SELECT id::text FROM users WHERE email = $1", [args.email]);
      if (existing.rowCount && existing.rows[0]) return existing.rows[0].id;

      const passwordHash = await hashPassword(defaultPassword);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, display_name, display_name_normalized, full_name, user_type, country_code, language, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, 'TR', 'tr', TRUE)
         RETURNING id::text`,
        [args.email, passwordHash, args.displayName, normalizeDisplayName(args.displayName), args.fullName, args.userType]
      );
      return inserted.rows[0].id;
    }

    const sellerId = await ensureUser({
      email: sellerEmail,
      displayName: "Demo Satici",
      fullName: "Demo Satici",
      userType: "seller",
    });
    const buyerId = await ensureUser({
      email: buyerEmail,
      displayName: "Demo Alici",
      fullName: "Demo Alici",
      userType: "buyer",
    });

    const existingFoods = await client.query<{ id: string; price: string }>(
      "SELECT id::text, price::text FROM foods WHERE seller_id = $1 AND is_active = TRUE ORDER BY created_at ASC",
      [sellerId]
    );

    const foodNames = ["Tavuk Pilav", "Firin Sutlac", "Kuru Fasulye"];
    if ((existingFoods.rowCount ?? 0) === 0) {
      for (const [index, name] of foodNames.entries()) {
        const price = index === 0 ? 189.9 : index === 1 ? 129.9 : 159.9;
        await client.query(
          `INSERT INTO foods (seller_id, name, card_summary, description, country_code, price, current_stock, daily_stock, is_available, is_active, delivery_fee, delivery_options_json)
           VALUES ($1, $2, $3, $4, 'TR', $5, 100, 200, TRUE, TRUE, 0, $6::jsonb)`,
          [sellerId, name, `${name} - Demo menu`, `${name} demo icerik`, price, JSON.stringify(["pickup", "delivery"])]
        );
      }
    }

    const foods = await client.query<{ id: string; price: string }>(
      "SELECT id::text, price::text FROM foods WHERE seller_id = $1 AND is_active = TRUE ORDER BY created_at ASC LIMIT 3",
      [sellerId]
    );

    const existingOrderCount = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM orders WHERE buyer_id = $1 AND seller_id = $2",
      [buyerId, sellerId]
    );
    const count = Number(existingOrderCount.rows[0]?.count ?? "0");

    if (count === 0) {
      for (const row of foods.rows) {
        const unitPrice = Number(row.price);
        const quantity = 1;
        const lineTotal = unitPrice * quantity;
        const orderInsert = await client.query<{ id: string }>(
          `INSERT INTO orders (buyer_id, seller_id, status, delivery_type, delivery_address_json, total_price, requested_at, payment_completed)
           VALUES ($1, $2, 'completed', 'delivery', $3::jsonb, $4, now() - interval '2 hour', TRUE)
           RETURNING id::text`,
          [buyerId, sellerId, JSON.stringify({ city: "Istanbul", line: "Kadikoy" }), lineTotal]
        );
        await client.query(
          `INSERT INTO order_items (order_id, food_id, quantity, unit_price, line_total)
           VALUES ($1, $2, $3, $4, $5)`,
          [orderInsert.rows[0].id, row.id, quantity, unitPrice, lineTotal]
        );
        await client.query(
          `INSERT INTO order_events (order_id, actor_user_id, event_type, from_status, to_status, payload_json)
           VALUES ($1, $2, 'status_update', 'delivered', 'completed', $3::jsonb)`,
          [orderInsert.rows[0].id, sellerId, JSON.stringify({ source: "admin_demo_seed" })]
        );
      }
    }

    await client.query("COMMIT");

    return res.json({
      data: {
        ok: true,
        sellerEmail,
        buyerEmail,
        defaultPassword,
        foodsCreated: (existingFoods.rowCount ?? 0) === 0 ? foodNames.length : 0,
        ordersCreated: count === 0 ? foods.rows.length : 0,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
