import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/client.js";
import { requireAuth } from "../middleware/auth.js";

const TABLE_MAP = {
  users: "users",
  adminUsers: "admin_users",
  foods: "foods",
  categories: "categories",
  orders: "orders",
  orderItems: "order_items",
  orderEvents: "order_events",
  paymentAttempts: "payment_attempts",
  sellerComplianceProfiles: "seller_compliance_profiles",
  sellerComplianceDocuments: "seller_compliance_documents",
  productionLots: "production_lots",
  lotEvents: "lot_events",
  orderItemLotAllocations: "order_item_lot_allocations",
  allergenDisclosureRecords: "allergen_disclosure_records",
  deliveryProofRecords: "delivery_proof_records",
  paymentDisputeCases: "payment_dispute_cases",
  orderFinance: "order_finance",
  financeAdjustments: "finance_adjustments",
  financeReports: "finance_reconciliation_reports",
  adminAuditLogs: "admin_audit_logs",
  authAudit: "auth_audit",
  adminAuthAudit: "admin_auth_audit",
  abuseRiskEvents: "abuse_risk_events",
  idempotencyKeys: "idempotency_keys",
  outboxEvents: "outbox_events",
  outboxDeadLetters: "outbox_dead_letters",
  legalHolds: "legal_holds",
} as const;

const TableKeySchema = z.enum(Object.keys(TABLE_MAP) as [keyof typeof TABLE_MAP, ...(keyof typeof TABLE_MAP)[]]);

const PreferencesSchema = z.object({
  visibleColumns: z.array(z.string().min(1)).min(1),
  columnOrder: z.array(z.string().min(1)).optional(),
});

export const adminMetadataRouter = Router();

adminMetadataRouter.get("/metadata/entities", requireAuth("admin"), async (_req, res) => {
  const entities = Object.entries(TABLE_MAP).map(([tableKey, tableName]) => ({
    tableKey,
    tableName,
  }));
  return res.json({ data: entities });
});

adminMetadataRouter.get("/metadata/tables/:tableKey/fields", requireAuth("admin"), async (req, res) => {
  const parsed = TableKeySchema.safeParse(req.params.tableKey);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid tableKey" } });
  }
  const tableKey = parsed.data;
  const tableName = TABLE_MAP[tableKey];

  const fields = await pool.query<{
    column_name: string;
    data_type: string;
    is_nullable: string;
    ordinal_position: number;
  }>(
    `SELECT column_name, data_type, is_nullable, ordinal_position
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position ASC`,
    [tableName]
  );

  const pkey = await pool.query<{ column_name: string }>(
    `SELECT a.attname AS column_name
     FROM pg_index i
     JOIN pg_class c ON c.oid = i.indrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
     WHERE i.indisprimary = TRUE
       AND n.nspname = 'public'
       AND c.relname = $1`,
    [tableName]
  );
  const primarySet = new Set(pkey.rows.map((r) => r.column_name));

  const rows = await pool.query(
    `SELECT row_to_json(t) AS raw_record
     FROM (SELECT * FROM public.${tableName} LIMIT 1) t`
  );

  return res.json({
    data: {
      tableKey,
      tableName,
      fields: fields.rows.map((f) => ({
        name: f.column_name,
        type: f.data_type,
        nullable: f.is_nullable === "YES",
        sortable: true,
        filterable: true,
        isPrimaryKey: primarySet.has(f.column_name),
      })),
      rawRecordFallback: rows.rows[0]?.raw_record ?? null,
    },
  });
});

adminMetadataRouter.get("/table-preferences/:tableKey", requireAuth("admin"), async (req, res) => {
  const parsed = TableKeySchema.safeParse(req.params.tableKey);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid tableKey" } });
  }

  const result = await pool.query<{
    visible_columns: unknown;
    column_order: unknown;
    updated_at: string;
  }>(
    `SELECT visible_columns, column_order, updated_at::text
     FROM admin_table_preferences
     WHERE admin_user_id = $1 AND table_key = $2`,
    [req.auth!.userId, parsed.data]
  );

  if ((result.rowCount ?? 0) === 0) {
    const fields = await pool.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position ASC`,
      [TABLE_MAP[parsed.data]]
    );
    const defaults = fields.rows.map((f) => f.column_name);
    return res.json({
      data: {
        tableKey: parsed.data,
        visibleColumns: defaults,
        columnOrder: defaults,
        isDefault: true,
      },
    });
  }

  return res.json({
    data: {
      tableKey: parsed.data,
      visibleColumns: result.rows[0].visible_columns,
      columnOrder: result.rows[0].column_order ?? result.rows[0].visible_columns,
      updatedAt: result.rows[0].updated_at,
      isDefault: false,
    },
  });
});

adminMetadataRouter.put("/table-preferences/:tableKey", requireAuth("admin"), async (req, res) => {
  const keyParsed = TableKeySchema.safeParse(req.params.tableKey);
  if (!keyParsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid tableKey" } });
  }
  const bodyParsed = PreferencesSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: bodyParsed.error.flatten() } });
  }

  const input = bodyParsed.data;
  await pool.query(
    `INSERT INTO admin_table_preferences (admin_user_id, table_key, visible_columns, column_order, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (admin_user_id, table_key)
     DO UPDATE SET visible_columns = EXCLUDED.visible_columns, column_order = EXCLUDED.column_order, updated_at = now()`,
    [req.auth!.userId, keyParsed.data, JSON.stringify(input.visibleColumns), JSON.stringify(input.columnOrder ?? input.visibleColumns)]
  );

  return res.json({
    data: {
      tableKey: keyParsed.data,
      visibleColumns: input.visibleColumns,
      columnOrder: input.columnOrder ?? input.visibleColumns,
      updated: true,
    },
  });
});

