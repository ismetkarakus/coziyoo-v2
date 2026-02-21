import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { pool } from "../db/client.js";
import { resolveActorRole } from "../middleware/app-role.js";
import { requireAuth } from "../middleware/auth.js";
import { enqueueOutboxEvent } from "../services/outbox.js";

const SellerProfileSchema = z.object({
  countryCode: z.enum(["TR", "UK"]),
  checks: z
    .array(
      z.object({
        checkCode: z.string().min(2).max(60),
        required: z.boolean(),
        status: z.enum(["pending", "verified", "rejected"]),
        value: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .optional(),
});

const UploadDocumentSchema = z.object({
  docType: z.string().min(2).max(60),
  fileUrl: z.string().url(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const ReviewSchema = z.object({
  reviewNotes: z.string().min(3).max(1000).optional(),
});

export const sellerComplianceRouter = Router();
export const adminComplianceRouter = Router();

sellerComplianceRouter.get("/profile", requireAuth("app"), async (req, res) => {
  const role = resolveActorRole(req);
  if (role !== "seller") {
    return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Seller role required" } });
  }

  const profile = await pool.query(
    `SELECT seller_id, country_code, status, submitted_at, approved_at, rejected_at, review_notes, updated_at
     FROM seller_compliance_profiles
     WHERE seller_id = $1`,
    [req.auth!.userId]
  );
  if ((profile.rowCount ?? 0) === 0) {
    return res.json({
      data: {
        sellerId: req.auth!.userId,
        status: "not_started",
        countryCode: null,
        checks: [],
      },
    });
  }

  const checks = await pool.query(
    `SELECT check_code, required, status, value_json
     FROM seller_compliance_checks
     WHERE seller_id = $1
     ORDER BY check_code`,
    [req.auth!.userId]
  );

  return res.json({
    data: {
      profile: profile.rows[0],
      checks: checks.rows,
    },
  });
});

sellerComplianceRouter.put("/profile", requireAuth("app"), async (req, res) => {
  const role = resolveActorRole(req);
  if (role !== "seller") {
    return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Seller role required" } });
  }

  const parsed = SellerProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO seller_compliance_profiles (seller_id, country_code, status, updated_at)
       VALUES ($1, $2, 'in_progress', now())
       ON CONFLICT (seller_id)
       DO UPDATE SET country_code = EXCLUDED.country_code, status = CASE
         WHEN seller_compliance_profiles.status IN ('approved', 'under_review', 'submitted') THEN seller_compliance_profiles.status
         ELSE 'in_progress'
       END, updated_at = now()`,
      [req.auth!.userId, input.countryCode]
    );

    for (const check of input.checks ?? []) {
      await client.query(
        `INSERT INTO seller_compliance_checks (seller_id, check_code, required, value_json, status, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (seller_id, check_code)
         DO UPDATE SET required = EXCLUDED.required, value_json = EXCLUDED.value_json, status = EXCLUDED.status, updated_at = now()`,
        [req.auth!.userId, check.checkCode, check.required, check.value ? JSON.stringify(check.value) : null, check.status]
      );
    }

    await client.query(
      `INSERT INTO seller_compliance_events (seller_id, actor_admin_id, event_type, payload_json)
       VALUES ($1, NULL, 'seller_profile_updated', $2)`,
      [req.auth!.userId, JSON.stringify({ countryCode: input.countryCode, checks: (input.checks ?? []).length })]
    );
    await client.query("COMMIT");
    return res.json({ data: { success: true } });
  } catch {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Compliance profile update failed" } });
  } finally {
    client.release();
  }
});

sellerComplianceRouter.post("/documents", requireAuth("app"), async (req, res) => {
  const role = resolveActorRole(req);
  if (role !== "seller") {
    return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Seller role required" } });
  }
  const parsed = UploadDocumentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;

  const doc = await pool.query<{ id: string }>(
    `INSERT INTO seller_compliance_documents (seller_id, doc_type, file_url, metadata_json, status, uploaded_at)
     VALUES ($1, $2, $3, $4, 'pending', now())
     RETURNING id`,
    [req.auth!.userId, input.docType, input.fileUrl, input.metadata ? JSON.stringify(input.metadata) : null]
  );

  await pool.query(
    `INSERT INTO seller_compliance_events (seller_id, actor_admin_id, event_type, payload_json)
     VALUES ($1, NULL, 'document_uploaded', $2)`,
    [req.auth!.userId, JSON.stringify({ documentId: doc.rows[0].id, docType: input.docType })]
  );
  return res.status(201).json({ data: { documentId: doc.rows[0].id } });
});

sellerComplianceRouter.get("/documents", requireAuth("app"), async (req, res) => {
  const role = resolveActorRole(req);
  if (role !== "seller") {
    return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Seller role required" } });
  }
  const docs = await pool.query(
    `SELECT id, doc_type, file_url, status, rejection_reason, uploaded_at, reviewed_at
     FROM seller_compliance_documents
     WHERE seller_id = $1
     ORDER BY uploaded_at DESC`,
    [req.auth!.userId]
  );
  return res.json({ data: docs.rows });
});

sellerComplianceRouter.post("/submit", requireAuth("app"), async (req, res) => {
  const role = resolveActorRole(req);
  if (role !== "seller") {
    return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Seller role required" } });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const profile = await client.query<{ country_code: string }>(
      "SELECT country_code FROM seller_compliance_profiles WHERE seller_id = $1 FOR UPDATE",
      [req.auth!.userId]
    );
    if ((profile.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: { code: "COMPLIANCE_PROFILE_REQUIRED", message: "Profile required before submit" } });
    }

    const checksAgg = await client.query<{ required_count: string; verified_required_count: string }>(
      `SELECT
        count(*) FILTER (WHERE required = TRUE)::text AS required_count,
        count(*) FILTER (WHERE required = TRUE AND status = 'verified')::text AS verified_required_count
       FROM seller_compliance_checks
       WHERE seller_id = $1`,
      [req.auth!.userId]
    );
    const requiredCount = Number(checksAgg.rows[0].required_count);
    const verifiedRequiredCount = Number(checksAgg.rows[0].verified_required_count);
    if (requiredCount > 0 && verifiedRequiredCount < requiredCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: {
          code: "COMPLIANCE_REQUIRED_CHECKS_MISSING",
          message: "All required checks must be verified before submit",
        },
      });
    }

    await client.query(
      `UPDATE seller_compliance_profiles
       SET status = 'submitted', submitted_at = now(), updated_at = now()
       WHERE seller_id = $1`,
      [req.auth!.userId]
    );
    await client.query(
      `UPDATE seller_compliance_profiles
       SET status = 'under_review', updated_at = now()
       WHERE seller_id = $1`,
      [req.auth!.userId]
    );
    await client.query(
      `INSERT INTO seller_compliance_events (seller_id, actor_admin_id, event_type, payload_json)
       VALUES ($1, NULL, 'submitted', $2)`,
      [req.auth!.userId, JSON.stringify({ requiredCount, verifiedRequiredCount })]
    );
    await client.query("COMMIT");
    return res.json({ data: { success: true, status: "under_review" } });
  } catch {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Compliance submit failed" } });
  } finally {
    client.release();
  }
});

adminComplianceRouter.get("/queue", requireAuth("admin"), async (_req, res) => {
  const queue = await pool.query(
    `SELECT seller_id, country_code, status, submitted_at, updated_at
     FROM seller_compliance_profiles
     WHERE status IN ('submitted', 'under_review')
     ORDER BY submitted_at NULLS LAST, updated_at DESC`
  );
  return res.json({ data: queue.rows });
});

adminComplianceRouter.get("/:sellerId", requireAuth("admin"), async (req, res) => {
  const sellerId = String(req.params.sellerId ?? "");
  if (!z.string().uuid().safeParse(sellerId).success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid sellerId" } });
  }

  const profile = await pool.query(
    `SELECT seller_id, country_code, status, submitted_at, approved_at, rejected_at, review_notes, updated_at
     FROM seller_compliance_profiles
     WHERE seller_id = $1`,
    [sellerId]
  );
  if ((profile.rowCount ?? 0) === 0) {
    return res.status(404).json({ error: { code: "COMPLIANCE_PROFILE_NOT_FOUND", message: "Profile not found" } });
  }
  const checks = await pool.query(
    "SELECT id, check_code, required, status, value_json, updated_at FROM seller_compliance_checks WHERE seller_id = $1 ORDER BY check_code",
    [sellerId]
  );
  const docs = await pool.query(
    "SELECT id, doc_type, file_url, status, rejection_reason, uploaded_at, reviewed_at FROM seller_compliance_documents WHERE seller_id = $1 ORDER BY uploaded_at DESC",
    [sellerId]
  );
  return res.json({ data: { profile: profile.rows[0], checks: checks.rows, documents: docs.rows } });
});

adminComplianceRouter.post("/:sellerId/approve", requireAuth("admin"), async (req, res) => {
  return handleAdminReviewAction(req, res, "approved");
});

adminComplianceRouter.post("/:sellerId/reject", requireAuth("admin"), async (req, res) => {
  return handleAdminReviewAction(req, res, "rejected");
});

adminComplianceRouter.post("/:sellerId/request-changes", requireAuth("admin"), async (req, res) => {
  return handleAdminReviewAction(req, res, "in_progress");
});

async function handleAdminReviewAction(
  req: Request,
  res: Response,
  targetStatus: "approved" | "rejected" | "in_progress"
) {
  const sellerId = String(req.params.sellerId ?? "");
  if (!z.string().uuid().safeParse(sellerId).success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid sellerId" } });
  }

  const parsed = ReviewSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const profile = await client.query<{ status: string; country_code: string }>(
      "SELECT status, country_code FROM seller_compliance_profiles WHERE seller_id = $1 FOR UPDATE",
      [sellerId]
    );
    if ((profile.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "COMPLIANCE_PROFILE_NOT_FOUND", message: "Profile not found" } });
    }

    await client.query(
      `UPDATE seller_compliance_profiles
       SET status = $1,
           approved_at = CASE WHEN $1 = 'approved' THEN now() ELSE approved_at END,
           rejected_at = CASE WHEN $1 = 'rejected' THEN now() ELSE rejected_at END,
           reviewed_by_admin_id = $2,
           review_notes = $3,
           updated_at = now()
       WHERE seller_id = $4`,
      [targetStatus, req.auth!.userId, parsed.data.reviewNotes ?? null, sellerId]
    );
    await client.query(
      `INSERT INTO seller_compliance_events (seller_id, actor_admin_id, event_type, payload_json)
       VALUES ($1, $2, $3, $4)`,
      [sellerId, req.auth!.userId, `admin_${targetStatus}`, JSON.stringify({ reviewNotes: parsed.data.reviewNotes ?? null })]
    );
    await enqueueOutboxEvent(client, {
      eventType: "compliance_status_changed",
      aggregateType: "seller_compliance_profiles",
      aggregateId: sellerId,
      payload: { sellerId, status: targetStatus, reviewedBy: req.auth!.userId },
    });

    const adminUser = await client.query<{ email: string; role: string }>("SELECT email, role FROM admin_users WHERE id = $1", [
      req.auth!.userId,
    ]);
    await client.query(
      `INSERT INTO admin_audit_logs (actor_admin_id, actor_email, actor_role, action, entity_type, entity_id, before_json, after_json)
       VALUES ($1, $2, $3, $4, 'seller_compliance_profiles', $5, $6, $7)`,
      [
        req.auth!.userId,
        adminUser.rows[0]?.email ?? "unknown",
        adminUser.rows[0]?.role ?? "admin",
        `compliance_${targetStatus}`,
        sellerId,
        JSON.stringify({ status: profile.rows[0].status }),
        JSON.stringify({ status: targetStatus }),
      ]
    );

    await client.query("COMMIT");
    return res.json({ data: { sellerId, status: targetStatus } });
  } catch {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Compliance review failed" } });
  } finally {
    client.release();
  }
}
