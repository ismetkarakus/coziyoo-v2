import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/client.js";
import { requireAuth } from "../middleware/auth.js";
import { writeAdminAudit } from "../services/admin-audit.js";

const CreateSalesCommissionSchema = z.object({
  commissionRatePercent: z.number().min(0).max(100),
});

export const adminSalesCommissionSettingsRouter = Router();

adminSalesCommissionSettingsRouter.use(requireAuth("admin"));

async function ensureSalesCommissionSettingsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_sales_commission_settings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      commission_rate_percent NUMERIC(5,2) NOT NULL,
      created_by_admin_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT admin_sales_commission_settings_rate_check
        CHECK (commission_rate_percent >= 0 AND commission_rate_percent <= 100)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_admin_sales_commission_settings_created_at
      ON admin_sales_commission_settings(created_at DESC)
  `);
}

adminSalesCommissionSettingsRouter.get("/sales-commission-settings/latest", async (_req, res) => {
  await ensureSalesCommissionSettingsTable();

  const latest = await pool.query<{
    id: string;
    commission_rate_percent: string;
    created_by_admin_id: string;
    created_by_email: string | null;
    created_at: string;
  }>(
    `SELECT
       s.id::text,
       s.commission_rate_percent::text,
       s.created_by_admin_id::text,
       a.email AS created_by_email,
       s.created_at::text
     FROM admin_sales_commission_settings s
     LEFT JOIN admin_users a ON a.id = s.created_by_admin_id
     ORDER BY s.created_at DESC
     LIMIT 1`
  );

  const row = latest.rows[0];
  return res.json({
    data: row
      ? {
          id: row.id,
          commissionRatePercent: Number(row.commission_rate_percent),
          createdByAdminId: row.created_by_admin_id,
          createdByEmail: row.created_by_email,
          createdAt: row.created_at,
        }
      : null,
  });
});

adminSalesCommissionSettingsRouter.post("/sales-commission-settings", async (req, res) => {
  await ensureSalesCommissionSettingsTable();

  const parsed = CreateSalesCommissionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const insert = await client.query<{
      id: string;
      commission_rate_percent: string;
      created_by_admin_id: string;
      created_at: string;
    }>(
      `INSERT INTO admin_sales_commission_settings (commission_rate_percent, created_by_admin_id, created_at)
       VALUES ($1, $2, now())
       RETURNING id::text, commission_rate_percent::text, created_by_admin_id::text, created_at::text`,
      [parsed.data.commissionRatePercent, req.auth!.userId]
    );

    const created = insert.rows[0];

    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "sales_commission_setting_created",
      entityType: "admin_sales_commission_settings",
      entityId: created.id,
      after: {
        commissionRatePercent: Number(created.commission_rate_percent),
      },
    });

    await client.query("COMMIT");

    return res.status(201).json({
      data: {
        id: created.id,
        commissionRatePercent: Number(created.commission_rate_percent),
        createdByAdminId: created.created_by_admin_id,
        createdAt: created.created_at,
      },
    });
  } catch {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Create sales commission setting failed" } });
  } finally {
    client.release();
  }
});
