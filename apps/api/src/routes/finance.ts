import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { pool } from "../db/client.js";
import { abuseProtection } from "../middleware/abuse-protection.js";
import { resolveActorRole } from "../middleware/app-role.js";
import { requireAuth } from "../middleware/auth.js";
import { requireIdempotency } from "../middleware/idempotency.js";
import { enqueueOutboxEvent } from "../services/outbox.js";

const CommissionCreateSchema = z.object({
  commissionRate: z.number().min(0).max(1),
  effectiveFrom: z.string().datetime().optional(),
});

const ResolveDisputeSchema = z.object({
  status: z.enum(["won", "lost", "closed"]),
  liabilityParty: z.enum(["seller", "platform", "provider", "shared"]).optional(),
  liabilityRatio: z.record(z.string(), z.number()).optional(),
  reasonCode: z.string().min(2).max(80).optional(),
});

const ReportCreateSchema = z.object({
  reportType: z.enum(["payout_summary", "order_settlement", "refund_chargeback", "tax_base"]),
  periodStart: z.string(),
  periodEnd: z.string(),
});

const RefundRequestSchema = z.object({
  reasonCode: z.string().min(2).max(80),
  reason: z.string().min(3).max(1000).optional(),
});

export const adminCommissionRouter = Router();
export const sellerFinanceRouter = Router();
export const orderDisputeRouter = Router();
export const adminDisputeRouter = Router();
export const adminFinanceRouter = Router();

adminCommissionRouter.get("/", requireAuth("admin"), async (_req, res) => {
  const current = await pool.query(
    `SELECT id, commission_rate::text, is_active, effective_from::text, created_by, created_at::text
     FROM commission_settings
     ORDER BY effective_from DESC, created_at DESC
     LIMIT 1`
  );
  const history = await pool.query(
    `SELECT id, commission_rate::text, is_active, effective_from::text, created_by, created_at::text
     FROM commission_settings
     ORDER BY effective_from DESC, created_at DESC
     LIMIT 20`
  );
  return res.json({
    data: {
      current: current.rows[0] ?? null,
      history: history.rows,
    },
  });
});

adminCommissionRouter.post("/", requireAuth("admin"), async (req, res) => {
  const parsed = CommissionCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;
  const effectiveFrom = input.effectiveFrom ?? new Date().toISOString();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE commission_settings SET is_active = FALSE WHERE is_active = TRUE");
    const created = await client.query<{ id: string; commission_rate: string; effective_from: string }>(
      `INSERT INTO commission_settings (commission_rate, is_active, effective_from, created_by, created_at)
       VALUES ($1, TRUE, $2, $3, now())
       RETURNING id, commission_rate::text, effective_from::text`,
      [input.commissionRate, effectiveFrom, req.auth!.userId]
    );

    const admin = await client.query<{ email: string; role: string }>("SELECT email, role FROM admin_users WHERE id = $1", [
      req.auth!.userId,
    ]);
    await client.query(
      `INSERT INTO admin_audit_logs (actor_admin_id, actor_email, actor_role, action, entity_type, entity_id, before_json, after_json)
       VALUES ($1, $2, $3, 'commission_setting_created', 'commission_settings', $4, $5, $6)`,
      [
        req.auth!.userId,
        admin.rows[0]?.email ?? "unknown",
        admin.rows[0]?.role ?? "admin",
        created.rows[0].id,
        null,
        JSON.stringify({
          commissionRate: Number(created.rows[0].commission_rate),
          effectiveFrom: created.rows[0].effective_from,
        }),
      ]
    );
    await client.query("COMMIT");
    return res.status(201).json({ data: created.rows[0] });
  } catch {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Create commission setting failed" } });
  } finally {
    client.release();
  }
});

sellerFinanceRouter.get("/:sellerId/finance/summary", requireAuth("app"), async (req, res) => {
  const sellerScope = await ensureSellerScope(req, res);
  if (!sellerScope.ok) return;

  const sellerId = sellerScope.sellerId;
  const totals = await pool.query<{
    total_selling_amount: string;
    total_commission: string;
    total_net_earnings: string;
  }>(
    `SELECT
      coalesce((SELECT sum(gross_amount) FROM order_finance WHERE seller_id = $1), 0)::text AS total_selling_amount,
      coalesce((SELECT sum(commission_amount) FROM order_finance WHERE seller_id = $1), 0)::text AS total_commission,
      (
        coalesce((SELECT sum(seller_net_amount) FROM order_finance WHERE seller_id = $1), 0) +
        coalesce((SELECT sum(amount) FROM finance_adjustments WHERE seller_id = $1), 0)
      )::text AS total_net_earnings`,
    [sellerId]
  );

  return res.json({
    data: {
      sellerId,
      totalSellingAmount: Number(totals.rows[0].total_selling_amount),
      totalCommission: Number(totals.rows[0].total_commission),
      totalNetEarnings: Number(totals.rows[0].total_net_earnings),
    },
  });
});

sellerFinanceRouter.get("/:sellerId/finance/orders", requireAuth("app"), async (req, res) => {
  const sellerScope = await ensureSellerScope(req, res);
  if (!sellerScope.ok) return;

  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20)));
  const offset = (page - 1) * pageSize;

  const list = await pool.query(
    `SELECT order_id, gross_amount::text, commission_rate_snapshot::text, commission_amount::text, seller_net_amount::text, finalized_at::text
     FROM order_finance
     WHERE seller_id = $1
     ORDER BY finalized_at DESC
     LIMIT $2 OFFSET $3`,
    [sellerScope.sellerId, pageSize, offset]
  );
  const total = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM order_finance WHERE seller_id = $1", [
    sellerScope.sellerId,
  ]);

  return res.json({
    data: list.rows.map((row) => ({
      orderId: row.order_id,
      grossAmount: Number(row.gross_amount),
      commissionRateSnapshot: Number(row.commission_rate_snapshot),
      commissionAmount: Number(row.commission_amount),
      sellerNetAmount: Number(row.seller_net_amount),
      finalizedAt: row.finalized_at,
    })),
    pagination: {
      mode: "offset",
      page,
      pageSize,
      total: Number(total.rows[0].count),
      totalPages: Math.ceil(Number(total.rows[0].count) / pageSize),
    },
  });
});

orderDisputeRouter.post(
  "/:id/refund-request",
  requireAuth("app"),
  abuseProtection({ flow: "refund_request", ipLimit: 20, userLimit: 8, windowMs: 60_000 }),
  requireIdempotency({ scope: "refund_request" }),
  async (req, res) => {
  const parsed = RefundRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const orderId = String(req.params.id ?? "");
  if (!z.string().uuid().safeParse(orderId).success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid order id" } });
  }

  const actorRole = resolveActorRole(req);
  if (!actorRole) {
    return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Actor role required" } });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const order = await client.query<{
      buyer_id: string;
      seller_id: string;
      total_price: string;
      status: string;
    }>("SELECT buyer_id, seller_id, total_price::text, status FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
    if ((order.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "ORDER_NOT_FOUND", message: "Order not found" } });
    }
    const orderRow = order.rows[0];
    if (req.auth!.userId !== orderRow.buyer_id && req.auth!.userId !== orderRow.seller_id) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: { code: "FORBIDDEN_ORDER_SCOPE", message: "No access to this order" } });
    }
    if (!["paid", "preparing", "ready", "in_delivery", "delivered", "completed"].includes(orderRow.status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: { code: "ORDER_INVALID_STATE", message: "Refund request not allowed yet" } });
    }

    const paymentAttempt = await client.query<{ id: string }>(
      "SELECT id FROM payment_attempts WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1",
      [orderId]
    );
    if ((paymentAttempt.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: { code: "PAYMENT_ATTEMPT_NOT_FOUND", message: "Payment attempt missing" } });
    }

    const dispute = await client.query<{ id: string }>(
      `INSERT INTO payment_dispute_cases (
         order_id, payment_attempt_id, provider_case_id, case_type, reason_code, liability_party, liability_ratio_json, status, evidence_bundle_json, opened_at, created_at, updated_at
       ) VALUES ($1, $2, $3, 'refund', $4, 'platform', $5, 'opened', $6, now(), now(), now())
       RETURNING id`,
      [
        orderId,
        paymentAttempt.rows[0].id,
        `refund-${orderId}-${Date.now()}`,
        parsed.data.reasonCode,
        JSON.stringify({ platform: 1 }),
        JSON.stringify({
          requestedBy: req.auth!.userId,
          actorRole,
          reason: parsed.data.reason ?? null,
        }),
      ]
    );

    await client.query(
      `INSERT INTO finance_adjustments (order_id, seller_id, dispute_case_id, type, amount, reason, created_at)
       VALUES ($1, $2, $3, 'refund_request', $4, $5, now())`,
      [orderId, orderRow.seller_id, dispute.rows[0].id, Number((-Number(orderRow.total_price)).toFixed(2)), parsed.data.reason ?? null]
    );

    await enqueueOutboxEvent(client, {
      eventType: "dispute_opened",
      aggregateType: "payment_dispute_case",
      aggregateId: dispute.rows[0].id,
      payload: { disputeId: dispute.rows[0].id, orderId, caseType: "refund" },
    });

    await client.query("COMMIT");
    return res.status(201).json({ data: { disputeId: dispute.rows[0].id, status: "opened" } });
  } catch {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Refund request failed" } });
  } finally {
    client.release();
  }
  }
);

orderDisputeRouter.get("/:id/disputes", requireAuth("app"), async (req, res) => {
  const orderId = String(req.params.id ?? "");
  if (!z.string().uuid().safeParse(orderId).success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid order id" } });
  }
  const order = await pool.query<{ buyer_id: string; seller_id: string }>("SELECT buyer_id, seller_id FROM orders WHERE id = $1", [orderId]);
  if ((order.rowCount ?? 0) === 0) {
    return res.status(404).json({ error: { code: "ORDER_NOT_FOUND", message: "Order not found" } });
  }
  if (req.auth!.userId !== order.rows[0].buyer_id && req.auth!.userId !== order.rows[0].seller_id) {
    return res.status(403).json({ error: { code: "FORBIDDEN_ORDER_SCOPE", message: "No access to this order" } });
  }

  const disputes = await pool.query(
    `SELECT id, provider_case_id, case_type, reason_code, liability_party, liability_ratio_json, status, opened_at::text, resolved_at::text
     FROM payment_dispute_cases
     WHERE order_id = $1
     ORDER BY opened_at DESC`,
    [orderId]
  );
  return res.json({ data: disputes.rows });
});

adminDisputeRouter.get("/", requireAuth("admin"), async (_req, res) => {
  const disputes = await pool.query(
    `SELECT id, order_id, provider_case_id, case_type, reason_code, liability_party, liability_ratio_json, status, opened_at::text, resolved_at::text
     FROM payment_dispute_cases
     ORDER BY opened_at DESC
     LIMIT 200`
  );
  return res.json({ data: disputes.rows });
});

adminDisputeRouter.post("/:id/resolve", requireAuth("admin"), async (req, res) => {
  const disputeId = String(req.params.id ?? "");
  if (!z.string().uuid().safeParse(disputeId).success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid dispute id" } });
  }
  const parsed = ResolveDisputeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const dispute = await client.query<{
      id: string;
      order_id: string;
      status: string;
      liability_party: string;
      case_type: string;
      reason_code: string | null;
      evidence_bundle_json: unknown;
    }>("SELECT * FROM payment_dispute_cases WHERE id = $1 FOR UPDATE", [disputeId]);
    if ((dispute.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "DISPUTE_NOT_FOUND", message: "Dispute not found" } });
    }

    const order = await client.query<{ seller_id: string; total_price: string }>(
      "SELECT seller_id, total_price::text FROM orders WHERE id = $1",
      [dispute.rows[0].order_id]
    );
    const nextLiability = parsed.data.liabilityParty ?? (dispute.rows[0].liability_party as "seller" | "platform" | "provider" | "shared");

    await client.query(
      `UPDATE payment_dispute_cases
       SET status = $1,
           liability_party = $2,
           liability_ratio_json = coalesce($3::jsonb, liability_ratio_json),
           reason_code = coalesce($4, reason_code),
           resolved_at = now(),
           updated_at = now()
       WHERE id = $5`,
      [
        parsed.data.status,
        nextLiability,
        parsed.data.liabilityRatio ? JSON.stringify(parsed.data.liabilityRatio) : null,
        parsed.data.reasonCode ?? null,
        disputeId,
      ]
    );

    if (parsed.data.status === "lost") {
      let ratio = 1;
      if (nextLiability === "shared") {
        ratio = Math.max(0, Math.min(1, parsed.data.liabilityRatio?.seller ?? 0.5));
      } else if (nextLiability !== "seller") {
        ratio = 0;
      }
      const amount = Number((-Number(order.rows[0].total_price) * ratio).toFixed(2));
      await client.query(
        `INSERT INTO finance_adjustments (order_id, seller_id, dispute_case_id, type, amount, reason, created_at)
         VALUES ($1, $2, $3, 'dispute_resolution', $4, $5, now())`,
        [dispute.rows[0].order_id, order.rows[0].seller_id, disputeId, amount, `dispute_${parsed.data.status}_${nextLiability}`]
      );
    }

    const admin = await client.query<{ email: string; role: string }>("SELECT email, role FROM admin_users WHERE id = $1", [
      req.auth!.userId,
    ]);
    await client.query(
      `INSERT INTO admin_audit_logs (actor_admin_id, actor_email, actor_role, action, entity_type, entity_id, before_json, after_json)
       VALUES ($1, $2, $3, 'dispute_resolve', 'payment_dispute_cases', $4, $5, $6)`,
      [
        req.auth!.userId,
        admin.rows[0]?.email ?? "unknown",
        admin.rows[0]?.role ?? "admin",
        disputeId,
        JSON.stringify({
          status: dispute.rows[0].status,
          liabilityParty: dispute.rows[0].liability_party,
          reasonCode: dispute.rows[0].reason_code,
        }),
        JSON.stringify({
          status: parsed.data.status,
          liabilityParty: nextLiability,
          reasonCode: parsed.data.reasonCode ?? dispute.rows[0].reason_code,
        }),
      ]
    );
    await enqueueOutboxEvent(client, {
      eventType: "dispute_resolved",
      aggregateType: "payment_dispute_case",
      aggregateId: disputeId,
      payload: {
        disputeId,
        status: parsed.data.status,
        liabilityParty: nextLiability,
      },
    });

    await client.query("COMMIT");
    return res.json({ data: { disputeId, status: parsed.data.status, liabilityParty: nextLiability } });
  } catch {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Dispute resolve failed" } });
  } finally {
    client.release();
  }
});

sellerFinanceRouter.post("/:sellerId/finance/reports", requireAuth("app"), async (req, res) => {
  const sellerScope = await ensureSellerScope(req, res);
  if (!sellerScope.ok) return;
  const parsed = ReportCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const report = await pool.query<{ id: string }>(
    `INSERT INTO finance_reconciliation_reports
      (actor_type, actor_id, report_type, period_start, period_end, status, file_url, checksum, generated_at, created_at)
     VALUES ('seller', $1, $2, $3::date, $4::date, 'ready', $5, $6, now(), now())
     RETURNING id`,
    [
      sellerScope.sellerId,
      parsed.data.reportType,
      parsed.data.periodStart,
      parsed.data.periodEnd,
      `https://reports.coziyoo.local/seller/${sellerScope.sellerId}/${Date.now()}.csv`,
      `chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ]
  );
  return res.status(201).json({ data: { reportId: report.rows[0].id, status: "ready" } });
});

sellerFinanceRouter.get("/:sellerId/finance/reports", requireAuth("app"), async (req, res) => {
  const sellerScope = await ensureSellerScope(req, res);
  if (!sellerScope.ok) return;
  const reports = await pool.query(
    `SELECT id, report_type, period_start::text, period_end::text, status, file_url, checksum, generated_at::text, created_at::text
     FROM finance_reconciliation_reports
     WHERE actor_type = 'seller' AND actor_id = $1
     ORDER BY created_at DESC
     LIMIT 100`,
    [sellerScope.sellerId]
  );
  return res.json({ data: reports.rows });
});

adminFinanceRouter.post("/reports", requireAuth("admin"), async (req, res) => {
  const parsed = ReportCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const report = await pool.query<{ id: string }>(
    `INSERT INTO finance_reconciliation_reports
      (actor_type, actor_id, report_type, period_start, period_end, status, file_url, checksum, generated_at, created_at)
     VALUES ('admin', $1, $2, $3::date, $4::date, 'ready', $5, $6, now(), now())
     RETURNING id`,
    [
      req.auth!.userId,
      parsed.data.reportType,
      parsed.data.periodStart,
      parsed.data.periodEnd,
      `https://reports.coziyoo.local/admin/${req.auth!.userId}/${Date.now()}.csv`,
      `chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ]
  );
  return res.status(201).json({ data: { reportId: report.rows[0].id, status: "ready" } });
});

adminFinanceRouter.get("/reports", requireAuth("admin"), async (req, res) => {
  const reports = await pool.query(
    `SELECT id, actor_id, report_type, period_start::text, period_end::text, status, file_url, checksum, generated_at::text, created_at::text
     FROM finance_reconciliation_reports
     WHERE actor_type = 'admin' AND actor_id = $1
     ORDER BY created_at DESC
     LIMIT 100`,
    [req.auth!.userId]
  );
  return res.json({ data: reports.rows });
});

async function ensureSellerScope(
  req: Request,
  res: Response
): Promise<{ ok: true; sellerId: string } | { ok: false }> {
  const sellerId = String(req.params.sellerId ?? "");
  if (!z.string().uuid().safeParse(sellerId).success) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid sellerId" } });
    return { ok: false };
  }
  const role = resolveActorRole(req);
  if (role !== "seller") {
    res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Seller role required" } });
    return { ok: false };
  }
  if (req.auth!.userId !== sellerId) {
    res.status(403).json({ error: { code: "FORBIDDEN_SELLER_SCOPE", message: "Cannot access another seller finance scope" } });
    return { ok: false };
  }
  return { ok: true, sellerId };
}
