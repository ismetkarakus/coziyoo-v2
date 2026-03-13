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

function demoFoodImageUrl(foodName: string): string {
  const normalized = foodName.toLowerCase();
  if (normalized.includes("tavuk") || normalized.includes("pilav")) {
    return "https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=900&q=80";
  }
  if (normalized.includes("sutlac") || normalized.includes("sütlaç")) {
    return "https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=900&q=80";
  }
  if (normalized.includes("fasulye")) {
    return "https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=900&q=80";
  }
  return "https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=900&q=80";
}

function demoComplianceFileUrl(code: string): string {
  const safeCode = code.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return `https://example.com/demo/compliance/${safeCode}.pdf`;
}

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
    let complianceFallbackTypesCreated = 0;
    let complianceDocTypesActive = 0;
    let complianceDocsUpserted = 0;

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
          `INSERT INTO foods (seller_id, name, card_summary, description, country_code, price, image_url, is_active, delivery_fee, delivery_options_json)
           VALUES ($1, $2, $3, $4, 'TR', $5, $6, TRUE, 0, $7::jsonb)`,
          [sellerId, name, `${name} - Demo menu`, `${name} demo icerik`, price, demoFoodImageUrl(name), JSON.stringify(["pickup", "delivery"])]
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

    const existingComplianceTypes = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM compliance_documents_list WHERE is_active = TRUE"
    );
    if (Number(existingComplianceTypes.rows[0]?.count ?? "0") === 0) {
      const fallbackTypes = [
        {
          code: "gida_isletme_kaydi",
          name: "Gida Isletme Kayit Belgesi",
          description: "TR gida mevzuatina uygun kayit belgesi",
          sourceInfo: "Demo seed fallback",
          details: "Demo amacli olusturulmustur",
          isRequiredDefault: true,
        },
        {
          code: "vergi_levhasi",
          name: "Vergi Levhasi",
          description: "Guncel vergi levhasi",
          sourceInfo: "Demo seed fallback",
          details: "Demo amacli olusturulmustur",
          isRequiredDefault: true,
        },
        {
          code: "kvkk_taahhut",
          name: "KVKK Taahhut",
          description: "KVKK sureclerine uyum taahhudu",
          sourceInfo: "Demo seed fallback",
          details: "Demo amacli olusturulmustur",
          isRequiredDefault: false,
        },
      ];

      for (const type of fallbackTypes) {
        const inserted = await client.query(
          `INSERT INTO compliance_documents_list (
             code,
             name,
             description,
             source_info,
             details,
             is_active,
             is_required_default,
             created_at,
             updated_at
           )
           VALUES ($1, $2, $3, $4, $5, TRUE, $6, now(), now())
           ON CONFLICT (code)
           DO UPDATE SET
             name = EXCLUDED.name,
             description = EXCLUDED.description,
             source_info = EXCLUDED.source_info,
             details = EXCLUDED.details,
             is_active = TRUE,
             is_required_default = EXCLUDED.is_required_default,
             updated_at = now()`,
          [type.code, type.name, type.description, type.sourceInfo, type.details, type.isRequiredDefault]
        );
        complianceFallbackTypesCreated += inserted.rowCount ?? 0;
      }
    }

    const activeComplianceTypes = await client.query<{ id: string; code: string; is_required_default: boolean; validity_years: number | null }>(
      `SELECT id::text, code, is_required_default, validity_years
       FROM compliance_documents_list
       WHERE is_active = TRUE
       ORDER BY code ASC`
    );
    complianceDocTypesActive = activeComplianceTypes.rowCount ?? 0;

    for (const type of activeComplianceTypes.rows) {
      const current = await client.query<{
        id: string;
        version: number;
        is_required: boolean;
        file_url: string | null;
        uploaded_at: string | null;
        status: string;
      }>(
        `SELECT id::text, version, is_required, file_url, uploaded_at::text, status
         FROM seller_compliance_documents
         WHERE seller_id = $1
           AND document_list_id = $2
           AND is_current = TRUE
         FOR UPDATE`,
        [sellerId, type.id]
      );
      const demoUrl = demoComplianceFileUrl(type.code);
      let upserted;
      if ((current.rowCount ?? 0) === 0) {
        upserted = await client.query(
          `INSERT INTO seller_compliance_documents (
             seller_id,
             document_list_id,
             is_required,
             status,
             file_url,
             uploaded_at,
             reviewed_at,
             reviewed_by_admin_id,
             rejection_reason,
             notes,
             expires_at,
             expired,
             version,
             is_current,
             created_at,
             updated_at
           )
           VALUES ($1, $2, $3, 'uploaded', $4, now(), NULL, NULL, NULL, 'admin_demo_seed', CASE WHEN $5 IS NOT NULL THEN now() + make_interval(years => $5) ELSE NULL END, FALSE, 1, TRUE, now(), now())`,
          [sellerId, type.id, type.is_required_default, demoUrl, type.validity_years]
        );
      } else {
        const row = current.rows[0];
        const canReuseCurrentVersion =
          row.version === 1 &&
          row.file_url === null &&
          row.uploaded_at === null &&
          row.status === "requested";
        if (canReuseCurrentVersion) {
          upserted = await client.query(
            `UPDATE seller_compliance_documents
             SET
               is_required = $3,
               status = 'uploaded',
               file_url = $4,
               uploaded_at = now(),
               reviewed_at = NULL,
               reviewed_by_admin_id = NULL,
               rejection_reason = NULL,
               notes = 'admin_demo_seed',
               expires_at = CASE WHEN $5 IS NOT NULL THEN now() + make_interval(years => $5) ELSE NULL END,
               expired = FALSE,
               updated_at = now()
             WHERE id = $1
               AND seller_id = $2`,
            [row.id, sellerId, type.is_required_default, demoUrl, type.validity_years]
          );
        } else {
          await client.query(
            `UPDATE seller_compliance_documents
             SET is_current = FALSE,
                 updated_at = now()
             WHERE id = $1`,
            [row.id]
          );
          upserted = await client.query(
            `INSERT INTO seller_compliance_documents (
               seller_id,
               document_list_id,
               is_required,
               status,
               file_url,
               uploaded_at,
               reviewed_at,
               reviewed_by_admin_id,
               rejection_reason,
               notes,
               expires_at,
               expired,
               version,
               is_current,
               created_at,
               updated_at
             )
             VALUES ($1, $2, $3, 'uploaded', $4, now(), NULL, NULL, NULL, 'admin_demo_seed', CASE WHEN $5 IS NOT NULL THEN now() + make_interval(years => $5) ELSE NULL END, FALSE, $6, TRUE, now(), now())`,
            [sellerId, type.id, type.is_required_default, demoUrl, type.validity_years, row.version + 1]
          );
        }
      }
      complianceDocsUpserted += upserted.rowCount ?? 0;
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
        complianceDocTypesActive,
        complianceDocsUpserted,
        complianceFallbackTypesCreated,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
