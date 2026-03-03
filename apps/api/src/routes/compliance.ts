import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/client.js";
import { resolveActorRole } from "../middleware/app-role.js";
import { requireAuth } from "../middleware/auth.js";
import { writeAdminAudit } from "../services/admin-audit.js";

const SellerProfileSchema = z.object({
  countryCode: z.enum(["TR", "UK"]).optional(),
});

const UploadDocumentSchema = z.object({
  docType: z.string().trim().min(2).max(80),
  fileUrl: z.string().url(),
  notes: z.string().trim().max(1500).optional(),
});

const ComplianceDocumentParamSchema = z.object({
  documentId: z.string().uuid(),
});

const ReviewSchema = z.object({
  reviewNotes: z.string().min(3).max(1000).optional(),
});

const UpdateDocumentStatusSchema = z
  .object({
    status: z.enum(["requested", "uploaded", "approved", "rejected", "pending"]),
    rejectionReason: z.string().trim().min(3).max(1000).nullable().optional(),
    notes: z.string().trim().max(1500).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const normalized = normalizeDocumentStatus(value.status);
    if (normalized === "rejected" && !value.rejectionReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rejectionReason"],
        message: "rejectionReason is required when status is rejected",
      });
    }
  });

const UpdateDocTypeSchema = z.object({
  required: z.boolean(),
});

const DocumentListParamsSchema = z.object({
  documentListId: z.string().uuid(),
});

const ComplianceDocumentListCreateSchema = z.object({
  code: z.string().trim().min(2).max(80),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  sourceInfo: z.string().trim().max(1000).nullable().optional(),
  details: z.string().trim().max(4000).nullable().optional(),
  isActive: z.boolean().optional(),
});

const ComplianceDocumentListUpdateSchema = z
  .object({
    code: z.string().trim().min(2).max(80).optional(),
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    sourceInfo: z.string().trim().max(1000).nullable().optional(),
    details: z.string().trim().max(4000).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.code === undefined &&
      value.name === undefined &&
      value.description === undefined &&
      value.sourceInfo === undefined &&
      value.details === undefined &&
      value.isActive === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one field must be provided",
      });
    }
  });

type SellerDocumentStatus = "requested" | "uploaded" | "approved" | "rejected";
type SellerComplianceProfileStatus = "not_started" | "in_progress" | "under_review" | "approved" | "rejected";

export const sellerComplianceRouter = Router();
export const adminComplianceRouter = Router();

function normalizeDocumentStatus(value: string): SellerDocumentStatus {
  return value === "pending" ? "requested" : (value as SellerDocumentStatus);
}

function computeSellerComplianceProfile(rows: Array<{ is_required: boolean; status: SellerDocumentStatus; updated_at: string }>): {
  status: SellerComplianceProfileStatus;
  requiredCount: number;
  approvedRequiredCount: number;
  uploadedRequiredCount: number;
  requestedRequiredCount: number;
  rejectedRequiredCount: number;
  updatedAt: string | null;
} {
  const requiredRows = rows.filter((row) => row.is_required);
  const requiredCount = requiredRows.length;
  const approvedRequiredCount = requiredRows.filter((row) => row.status === "approved").length;
  const uploadedRequiredCount = requiredRows.filter((row) => row.status === "uploaded").length;
  const requestedRequiredCount = requiredRows.filter((row) => row.status === "requested").length;
  const rejectedRequiredCount = requiredRows.filter((row) => row.status === "rejected").length;

  const updatedAt = rows
    .map((row) => row.updated_at)
    .filter(Boolean)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;

  if (requiredCount === 0) {
    return {
      status: "not_started",
      requiredCount,
      approvedRequiredCount,
      uploadedRequiredCount,
      requestedRequiredCount,
      rejectedRequiredCount,
      updatedAt,
    };
  }
  if (rejectedRequiredCount > 0) {
    return {
      status: "rejected",
      requiredCount,
      approvedRequiredCount,
      uploadedRequiredCount,
      requestedRequiredCount,
      rejectedRequiredCount,
      updatedAt,
    };
  }
  if (approvedRequiredCount === requiredCount) {
    return {
      status: "approved",
      requiredCount,
      approvedRequiredCount,
      uploadedRequiredCount,
      requestedRequiredCount,
      rejectedRequiredCount,
      updatedAt,
    };
  }
  if (requestedRequiredCount > 0) {
    return {
      status: "in_progress",
      requiredCount,
      approvedRequiredCount,
      uploadedRequiredCount,
      requestedRequiredCount,
      rejectedRequiredCount,
      updatedAt,
    };
  }
  return {
    status: "under_review",
    requiredCount,
    approvedRequiredCount,
    uploadedRequiredCount,
    requestedRequiredCount,
    rejectedRequiredCount,
    updatedAt,
  };
}

async function getSellerDocuments(client: { query: typeof pool.query }, sellerId: string) {
  return client.query<{
    id: string;
    seller_id: string;
    document_list_id: string;
    is_required: boolean;
    status: SellerDocumentStatus;
    file_url: string | null;
    uploaded_at: string | null;
    reviewed_at: string | null;
    reviewed_by_admin_id: string | null;
    rejection_reason: string | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
    code: string;
    name: string;
    description: string | null;
    source_info: string | null;
    details: string | null;
    is_active: boolean;
  }>(
    `SELECT
       scd.id::text,
       scd.seller_id::text,
       scd.document_list_id::text,
       scd.is_required,
       scd.status,
       scd.file_url,
       scd.uploaded_at::text,
       scd.reviewed_at::text,
       scd.reviewed_by_admin_id::text,
       scd.rejection_reason,
       scd.notes,
       scd.created_at::text,
       scd.updated_at::text,
       cdl.code,
       cdl.name,
       cdl.description,
       cdl.source_info,
       cdl.details,
       cdl.is_active
     FROM seller_compliance_documents scd
     JOIN compliance_documents_list cdl ON cdl.id = scd.document_list_id
     WHERE scd.seller_id = $1
     ORDER BY scd.is_required DESC, cdl.name ASC, scd.created_at ASC`,
    [sellerId]
  );
}

async function ensureSellerAssignments(sellerId: string) {
  await pool.query(
    `INSERT INTO seller_compliance_documents (seller_id, document_list_id, is_required, status, created_at, updated_at)
     SELECT $1, cdl.id, TRUE, 'requested', now(), now()
     FROM compliance_documents_list cdl
     WHERE cdl.is_active = TRUE
     ON CONFLICT (seller_id, document_list_id) DO NOTHING`,
    [sellerId]
  );
}

sellerComplianceRouter.get("/profile", requireAuth("app"), async (req, res) => {
  const role = resolveActorRole(req);
  if (role !== "seller") {
    return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Seller role required" } });
  }

  await ensureSellerAssignments(req.auth!.userId);
  const docs = await getSellerDocuments(pool, req.auth!.userId);
  const profile = computeSellerComplianceProfile(docs.rows);
  return res.json({
    data: {
      profile: {
        seller_id: req.auth!.userId,
        status: profile.status,
        required_count: profile.requiredCount,
        approved_required_count: profile.approvedRequiredCount,
        uploaded_required_count: profile.uploadedRequiredCount,
        requested_required_count: profile.requestedRequiredCount,
        rejected_required_count: profile.rejectedRequiredCount,
        updated_at: profile.updatedAt,
      },
      documents: docs.rows,
    },
  });
});

sellerComplianceRouter.put("/profile", requireAuth("app"), async (req, res) => {
  const role = resolveActorRole(req);
  if (role !== "seller") {
    return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Seller role required" } });
  }
  const parsed = SellerProfileSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  await ensureSellerAssignments(req.auth!.userId);
  return res.json({ data: { success: true } });
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

  const docType = await pool.query<{ id: string }>(
    "SELECT id::text FROM compliance_documents_list WHERE code = $1 AND is_active = TRUE",
    [input.docType]
  );
  if ((docType.rowCount ?? 0) === 0) {
    return res.status(404).json({ error: { code: "DOCUMENT_TYPE_NOT_FOUND", message: "Document type not found" } });
  }

  const row = await pool.query<{ id: string }>(
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
       updated_at
     )
     VALUES ($1, $2, TRUE, 'uploaded', $3, now(), NULL, NULL, NULL, $4, now())
     ON CONFLICT (seller_id, document_list_id)
     DO UPDATE SET
       status = 'uploaded',
       file_url = EXCLUDED.file_url,
       uploaded_at = now(),
       reviewed_at = NULL,
       reviewed_by_admin_id = NULL,
       rejection_reason = NULL,
       notes = EXCLUDED.notes,
       updated_at = now()
     RETURNING id::text`,
    [req.auth!.userId, docType.rows[0].id, input.fileUrl, input.notes ?? null]
  );

  return res.status(201).json({ data: { documentId: row.rows[0].id } });
});

sellerComplianceRouter.get("/documents", requireAuth("app"), async (req, res) => {
  const role = resolveActorRole(req);
  if (role !== "seller") {
    return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Seller role required" } });
  }
  await ensureSellerAssignments(req.auth!.userId);
  const docs = await getSellerDocuments(pool, req.auth!.userId);
  return res.json({ data: docs.rows });
});

sellerComplianceRouter.delete("/documents/:documentId", requireAuth("app"), async (req, res) => {
  const role = resolveActorRole(req);
  if (role !== "seller") {
    return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Seller role required" } });
  }
  const params = ComplianceDocumentParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const updated = await pool.query<{ id: string }>(
    `UPDATE seller_compliance_documents
     SET
       status = 'requested',
       file_url = NULL,
       uploaded_at = NULL,
       reviewed_at = NULL,
       reviewed_by_admin_id = NULL,
       rejection_reason = NULL,
       updated_at = now()
     WHERE id = $1
       AND seller_id = $2
     RETURNING id::text`,
    [params.data.documentId, req.auth!.userId]
  );
  if ((updated.rowCount ?? 0) === 0) {
    return res.status(404).json({ error: { code: "DOCUMENT_NOT_FOUND", message: "Document not found" } });
  }
  return res.json({ data: { deleted: true, documentId: updated.rows[0].id } });
});

sellerComplianceRouter.post("/submit", requireAuth("app"), async (req, res) => {
  const role = resolveActorRole(req);
  if (role !== "seller") {
    return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Seller role required" } });
  }
  await ensureSellerAssignments(req.auth!.userId);
  const docs = await getSellerDocuments(pool, req.auth!.userId);
  const profile = computeSellerComplianceProfile(docs.rows);
  if (profile.requestedRequiredCount > 0 || profile.rejectedRequiredCount > 0) {
    return res.status(409).json({
      error: {
        code: "COMPLIANCE_REQUIRED_DOCUMENTS_MISSING",
        message: "All required documents must be uploaded and not rejected before submit",
      },
    });
  }
  return res.json({ data: { success: true, status: profile.status } });
});

adminComplianceRouter.get("/queue", requireAuth("admin"), async (_req, res) => {
  const queue = await pool.query<{
    seller_id: string;
    uploaded_required_count: string;
    updated_at: string;
  }>(
    `SELECT
       scd.seller_id::text,
       count(*) FILTER (WHERE scd.is_required = TRUE AND scd.status = 'uploaded')::text AS uploaded_required_count,
       max(scd.updated_at)::text AS updated_at
     FROM seller_compliance_documents scd
     GROUP BY scd.seller_id
     HAVING count(*) FILTER (WHERE scd.is_required = TRUE AND scd.status = 'uploaded') > 0
     ORDER BY max(scd.updated_at) DESC`
  );
  return res.json({ data: queue.rows });
});

adminComplianceRouter.get("/document-list", requireAuth("admin"), async (_req, res) => {
  const rows = await pool.query<{
    id: string;
    code: string;
    name: string;
    description: string | null;
    source_info: string | null;
    details: string | null;
    is_active: boolean;
    seller_assignment_count: string;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT
       cdl.id::text,
       cdl.code,
       cdl.name,
       cdl.description,
       cdl.source_info,
       cdl.details,
       cdl.is_active,
       count(scd.id)::text AS seller_assignment_count,
       cdl.created_at::text,
       cdl.updated_at::text
     FROM compliance_documents_list cdl
     LEFT JOIN seller_compliance_documents scd ON scd.document_list_id = cdl.id
     GROUP BY cdl.id
     ORDER BY cdl.is_active DESC, cdl.name ASC, cdl.created_at ASC`
  );
  return res.json({ data: rows.rows });
});

adminComplianceRouter.post("/document-list", requireAuth("admin"), async (req, res) => {
  const parsed = ComplianceDocumentListCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query<{
      id: string;
      code: string;
      name: string;
      description: string | null;
      source_info: string | null;
      details: string | null;
      is_active: boolean;
      created_at: string;
      updated_at: string;
    }>(
      `INSERT INTO compliance_documents_list (
         code,
         name,
         description,
         source_info,
         details,
         is_active,
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, now(), now())
       RETURNING
         id::text,
         code,
         name,
         description,
         source_info,
         details,
         is_active,
         created_at::text,
         updated_at::text`,
      [input.code, input.name, input.description ?? null, input.sourceInfo ?? null, input.details ?? null, input.isActive ?? true]
    );

    await client.query(
      `INSERT INTO seller_compliance_documents (
         seller_id,
         document_list_id,
         is_required,
         status,
         created_at,
         updated_at
       )
       SELECT
         u.id,
         $1,
         TRUE,
         'requested',
         now(),
         now()
       FROM users u
       WHERE u.user_type IN ('seller', 'both')
       ON CONFLICT (seller_id, document_list_id) DO NOTHING`,
      [inserted.rows[0].id]
    );

    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "compliance_document_list_created",
      entityType: "compliance_documents_list",
      entityId: inserted.rows[0].id,
      before: null,
      after: inserted.rows[0],
    });

    await client.query("COMMIT");
    return res.status(201).json({ data: inserted.rows[0] });
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    if (String((error as { code?: string } | undefined)?.code ?? "") === "23505") {
      return res.status(409).json({ error: { code: "DOCUMENT_CODE_EXISTS", message: "Document code already exists" } });
    }
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Document list create failed" } });
  } finally {
    client.release();
  }
});

adminComplianceRouter.patch("/document-list/:documentListId", requireAuth("admin"), async (req, res) => {
  const params = DocumentListParamsSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }
  const parsed = ComplianceDocumentListUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await client.query<{
      id: string;
      code: string;
      name: string;
      description: string | null;
      source_info: string | null;
      details: string | null;
      is_active: boolean;
    }>(
      `SELECT
         id::text,
         code,
         name,
         description,
         source_info,
         details,
         is_active
       FROM compliance_documents_list
       WHERE id = $1
       FOR UPDATE`,
      [params.data.documentListId]
    );
    if ((before.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "DOCUMENT_TYPE_NOT_FOUND", message: "Document type not found" } });
    }

    const updated = await client.query<{
      id: string;
      code: string;
      name: string;
      description: string | null;
      source_info: string | null;
      details: string | null;
      is_active: boolean;
      created_at: string;
      updated_at: string;
    }>(
      `UPDATE compliance_documents_list
       SET
         code = COALESCE($2, code),
         name = COALESCE($3, name),
         description = CASE WHEN $4::boolean THEN $5 ELSE description END,
         source_info = CASE WHEN $6::boolean THEN $7 ELSE source_info END,
         details = CASE WHEN $8::boolean THEN $9 ELSE details END,
         is_active = COALESCE($10, is_active),
         updated_at = now()
       WHERE id = $1
       RETURNING
         id::text,
         code,
         name,
         description,
         source_info,
         details,
         is_active,
         created_at::text,
         updated_at::text`,
      [
        params.data.documentListId,
        input.code ?? null,
        input.name ?? null,
        input.description !== undefined,
        input.description ?? null,
        input.sourceInfo !== undefined,
        input.sourceInfo ?? null,
        input.details !== undefined,
        input.details ?? null,
        input.isActive ?? null,
      ]
    );

    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "compliance_document_list_updated",
      entityType: "compliance_documents_list",
      entityId: params.data.documentListId,
      before: before.rows[0],
      after: updated.rows[0],
    });

    await client.query("COMMIT");
    return res.json({ data: updated.rows[0] });
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    if (String((error as { code?: string } | undefined)?.code ?? "") === "23505") {
      return res.status(409).json({ error: { code: "DOCUMENT_CODE_EXISTS", message: "Document code already exists" } });
    }
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Document list update failed" } });
  } finally {
    client.release();
  }
});

adminComplianceRouter.delete("/document-list/:documentListId", requireAuth("admin"), async (req, res) => {
  const params = DocumentListParamsSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await client.query<{ id: string; code: string; name: string }>(
      `SELECT id::text, code, name
       FROM compliance_documents_list
       WHERE id = $1
       FOR UPDATE`,
      [params.data.documentListId]
    );
    if ((before.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "DOCUMENT_TYPE_NOT_FOUND", message: "Document type not found" } });
    }

    await client.query("DELETE FROM seller_compliance_documents WHERE document_list_id = $1", [params.data.documentListId]);
    await client.query("DELETE FROM compliance_documents_list WHERE id = $1", [params.data.documentListId]);

    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "compliance_document_list_deleted",
      entityType: "compliance_documents_list",
      entityId: params.data.documentListId,
      before: before.rows[0],
      after: null,
    });

    await client.query("COMMIT");
    return res.json({ data: { deleted: true, id: params.data.documentListId } });
  } catch {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Document list delete failed" } });
  } finally {
    client.release();
  }
});

adminComplianceRouter.get("/:sellerId", requireAuth("admin"), async (req, res) => {
  const sellerId = String(req.params.sellerId ?? "");
  if (!z.string().uuid().safeParse(sellerId).success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid sellerId" } });
  }
  await ensureSellerAssignments(sellerId);
  const docs = await getSellerDocuments(pool, sellerId);
  const profile = computeSellerComplianceProfile(docs.rows);

  return res.json({
    data: {
      profile: {
        seller_id: sellerId,
        status: profile.status,
        required_count: profile.requiredCount,
        approved_required_count: profile.approvedRequiredCount,
        uploaded_required_count: profile.uploadedRequiredCount,
        requested_required_count: profile.requestedRequiredCount,
        rejected_required_count: profile.rejectedRequiredCount,
        review_notes: null,
        updated_at: profile.updatedAt,
      },
      checks: [],
      documents: docs.rows.map((row) => ({
        ...row,
        doc_type: row.code,
      })),
      profileDocuments: docs.rows.map((row) => ({
        id: row.id,
        seller_id: row.seller_id,
        doc_type: row.code,
        latest_document_id: row.id,
        status: row.status,
        required: row.is_required,
        updated_at: row.updated_at,
      })),
    },
  });
});

adminComplianceRouter.patch("/:sellerId/documents/:documentId", requireAuth("admin"), async (req, res) => {
  const sellerId = String(req.params.sellerId ?? "");
  if (!z.string().uuid().safeParse(sellerId).success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid sellerId" } });
  }
  const params = ComplianceDocumentParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }
  const parsed = UpdateDocumentStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const normalizedStatus = normalizeDocumentStatus(parsed.data.status);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await client.query<{
      id: string;
      status: SellerDocumentStatus;
      rejection_reason: string | null;
      reviewed_by_admin_id: string | null;
      document_list_id: string;
      code: string;
    }>(
      `SELECT
         scd.id::text,
         scd.status,
         scd.rejection_reason,
         scd.reviewed_by_admin_id::text,
         scd.document_list_id::text,
         cdl.code
       FROM seller_compliance_documents scd
       JOIN compliance_documents_list cdl ON cdl.id = scd.document_list_id
       WHERE scd.id = $1
         AND scd.seller_id = $2
       FOR UPDATE`,
      [params.data.documentId, sellerId]
    );
    if ((before.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "DOCUMENT_NOT_FOUND", message: "Document not found" } });
    }

    const updated = await client.query<{ id: string; status: SellerDocumentStatus }>(
      `UPDATE seller_compliance_documents
       SET
         status = $3,
         rejection_reason = CASE WHEN $3 = 'rejected' THEN $4 ELSE NULL END,
         reviewed_at = CASE WHEN $3 IN ('approved', 'rejected') THEN now() ELSE NULL END,
         reviewed_by_admin_id = CASE WHEN $3 IN ('approved', 'rejected') THEN $5 ELSE NULL END,
         notes = CASE WHEN $6::boolean THEN $7 ELSE notes END,
         updated_at = now()
       WHERE id = $1
         AND seller_id = $2
       RETURNING id::text, status`,
      [
        params.data.documentId,
        sellerId,
        normalizedStatus,
        parsed.data.rejectionReason ?? null,
        req.auth!.userId,
        parsed.data.notes !== undefined,
        parsed.data.notes ?? null,
      ]
    );

    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "compliance_document_status_updated",
      entityType: "seller_compliance_documents",
      entityId: params.data.documentId,
      before: {
        status: before.rows[0].status,
        rejectionReason: before.rows[0].rejection_reason,
      },
      after: {
        status: updated.rows[0].status,
        rejectionReason: normalizedStatus === "rejected" ? parsed.data.rejectionReason ?? null : null,
        sellerId,
        docType: before.rows[0].code,
      },
    });

    await client.query("COMMIT");
    return res.json({
      data: {
        sellerId,
        documentId: updated.rows[0].id,
        status: updated.rows[0].status,
      },
    });
  } catch {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Compliance document update failed" } });
  } finally {
    client.release();
  }
});

adminComplianceRouter.patch("/:sellerId/doc-types/:docType", requireAuth("admin"), async (req, res) => {
  const sellerId = String(req.params.sellerId ?? "");
  if (!z.string().uuid().safeParse(sellerId).success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid sellerId" } });
  }
  const docType = String(req.params.docType ?? "").trim();
  if (docType.length < 2) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid docType" } });
  }
  const parsed = UpdateDocTypeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const list = await client.query<{ id: string }>(
      "SELECT id::text FROM compliance_documents_list WHERE code = $1 FOR UPDATE",
      [docType]
    );
    if ((list.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "DOCUMENT_TYPE_NOT_FOUND", message: "Document type not found" } });
    }

    const before = await client.query<{ is_required: boolean }>(
      `SELECT is_required
       FROM seller_compliance_documents
       WHERE seller_id = $1
         AND document_list_id = $2`,
      [sellerId, list.rows[0].id]
    );

    const upserted = await client.query<{ id: string; is_required: boolean }>(
      `INSERT INTO seller_compliance_documents (
         seller_id,
         document_list_id,
         is_required,
         status,
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, 'requested', now(), now())
       ON CONFLICT (seller_id, document_list_id)
       DO UPDATE SET
         is_required = EXCLUDED.is_required,
         updated_at = now()
       RETURNING id::text, is_required`,
      [sellerId, list.rows[0].id, parsed.data.required]
    );

    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "compliance_document_requirement_updated",
      entityType: "seller_compliance_documents",
      entityId: upserted.rows[0].id,
      before: { required: before.rows[0]?.is_required ?? null, docType, sellerId },
      after: { required: upserted.rows[0].is_required, docType, sellerId },
    });

    await client.query("COMMIT");
    return res.json({
      data: {
        sellerId,
        docType,
        required: upserted.rows[0].is_required,
      },
    });
  } catch {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Document requirement update failed" } });
  } finally {
    client.release();
  }
});

adminComplianceRouter.post("/:sellerId/approve", requireAuth("admin"), async (req, res) => {
  const sellerId = String(req.params.sellerId ?? "");
  if (!z.string().uuid().safeParse(sellerId).success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid sellerId" } });
  }
  const parsed = ReviewSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const result = await pool.query(
    `UPDATE seller_compliance_documents
     SET status = 'approved',
         rejection_reason = NULL,
         reviewed_at = now(),
         reviewed_by_admin_id = $2,
         notes = COALESCE($3, notes),
         updated_at = now()
     WHERE seller_id = $1
       AND is_required = TRUE
       AND status IN ('uploaded', 'requested', 'rejected')`,
    [sellerId, req.auth!.userId, parsed.data.reviewNotes ?? null]
  );
  return res.json({ data: { sellerId, updatedCount: result.rowCount ?? 0, status: "approved" } });
});

adminComplianceRouter.post("/:sellerId/reject", requireAuth("admin"), async (req, res) => {
  const sellerId = String(req.params.sellerId ?? "");
  if (!z.string().uuid().safeParse(sellerId).success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid sellerId" } });
  }
  const parsed = ReviewSchema.safeParse(req.body ?? {});
  if (!parsed.success || !parsed.data.reviewNotes) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "reviewNotes is required" } });
  }
  const result = await pool.query(
    `UPDATE seller_compliance_documents
     SET status = 'rejected',
         rejection_reason = $3,
         reviewed_at = now(),
         reviewed_by_admin_id = $2,
         updated_at = now()
     WHERE seller_id = $1
       AND is_required = TRUE
       AND status IN ('uploaded', 'requested', 'approved')`,
    [sellerId, req.auth!.userId, parsed.data.reviewNotes]
  );
  return res.json({ data: { sellerId, updatedCount: result.rowCount ?? 0, status: "rejected" } });
});

adminComplianceRouter.post("/:sellerId/request-changes", requireAuth("admin"), async (req, res) => {
  const sellerId = String(req.params.sellerId ?? "");
  if (!z.string().uuid().safeParse(sellerId).success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid sellerId" } });
  }
  const parsed = ReviewSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const result = await pool.query(
    `UPDATE seller_compliance_documents
     SET status = 'requested',
         notes = COALESCE($3, notes),
         rejection_reason = NULL,
         reviewed_at = NULL,
         reviewed_by_admin_id = NULL,
         updated_at = now()
     WHERE seller_id = $1
       AND is_required = TRUE`,
    [sellerId, req.auth!.userId, parsed.data.reviewNotes ?? null]
  );
  return res.json({ data: { sellerId, updatedCount: result.rowCount ?? 0, status: "in_progress" } });
});
