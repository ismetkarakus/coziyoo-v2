import { type NextFunction, type Request, type Response, Router } from "express";
import { randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";
import { env } from "../config/env.js";
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

const PresignDocumentUploadSchema = z.object({
  docType: z.string().trim().min(2).max(80),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(3).max(120).optional(),
});

const ComplianceDocumentParamSchema = z.object({
  documentId: z.string().uuid(),
});

const OptionalUploadParamSchema = z.object({
  uploadId: z.string().uuid(),
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
    if ((normalized === "rejected" || normalized === "requested") && !value.rejectionReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rejectionReason"],
        message: "rejectionReason is required when status is rejected or requested",
      });
    }
  });

const UpdateDocTypeSchema = z.object({
  required: z.boolean(),
});

const OptionalUploadCreateSchema = z
  .object({
    documentListId: z.string().uuid().optional(),
    customTitle: z.string().trim().max(180).optional(),
    customDescription: z.string().trim().max(1500).optional(),
    fileUrl: z.string().url(),
  })
  .superRefine((value, ctx) => {
    if (!value.documentListId && !value.customTitle?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customTitle"],
        message: "customTitle is required when documentListId is not provided",
      });
    }
  });

const OptionalUploadStatusUpdateSchema = z
  .object({
    status: z.enum(["uploaded", "approved", "rejected"]),
    rejectionReason: z.string().trim().min(3).max(1000).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.status === "rejected" || value.status === "uploaded") && !value.rejectionReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rejectionReason"],
        message: "rejectionReason is required when status is rejected or uploaded",
      });
    }
  });

const DocumentListParamsSchema = z.object({
  documentListId: z.string().uuid(),
});

const OptionalValidityYearsSchema = z.preprocess((value) => {
  if (value === "" || value === null || value === undefined) return null;
  return value;
}, z.number().int().positive().max(100).nullable());

const ComplianceDocumentListCreateSchema = z.object({
  code: z.string().trim().min(2).max(80),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  sourceInfo: z.string().trim().max(1000).nullable().optional(),
  details: z.string().trim().max(4000).nullable().optional(),
  validityYears: OptionalValidityYearsSchema.optional(),
  isActive: z.boolean().optional(),
  isRequiredDefault: z.boolean().optional(),
});

const ComplianceDocumentListUpdateSchema = z
  .object({
    code: z.string().trim().min(2).max(80).optional(),
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    sourceInfo: z.string().trim().max(1000).nullable().optional(),
    details: z.string().trim().max(4000).nullable().optional(),
    validityYears: OptionalValidityYearsSchema.optional(),
    isActive: z.boolean().optional(),
    isRequiredDefault: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.code === undefined &&
      value.name === undefined &&
      value.description === undefined &&
      value.sourceInfo === undefined &&
      value.details === undefined &&
      value.validityYears === undefined &&
      value.isActive === undefined &&
      value.isRequiredDefault === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one field must be provided",
      });
    }
  });

type SellerDocumentStatus = "requested" | "uploaded" | "approved" | "rejected" | "expired";
type OptionalUploadStatus = "uploaded" | "approved" | "rejected" | "archived" | "expired";
type SellerComplianceProfileStatus = "not_started" | "in_progress" | "under_review" | "approved" | "rejected";

export const sellerComplianceRouter = Router();
export const adminComplianceRouter = Router();
let ensureComplianceDocumentValiditySchemaPromise: Promise<void> | null = null;
let s3Client: S3Client | null = null;

function isS3StorageConfigured() {
  return Boolean(env.S3_ENDPOINT && env.S3_BUCKET_SELLER_DOCS && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY);
}

function getS3Client() {
  if (!isS3StorageConfigured()) {
    throw new Error("S3_STORAGE_NOT_CONFIGURED");
  }
  if (s3Client) return s3Client;
  s3Client = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
    },
  });
  return s3Client;
}

function sanitizeFileName(value: string) {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
  return normalized || "document.bin";
}

function buildSellerDocumentStorageKey(sellerId: string, docType: string, fileName: string) {
  const normalizedType = docType.toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
  return `seller/${sellerId}/documents/${normalizedType}/${Date.now()}-${randomUUID().slice(0, 8)}-${sanitizeFileName(fileName)}`;
}

function toStoragePointer(bucket: string, key: string) {
  return `s3://${bucket}/${key}`;
}

function parseStoragePointer(value: string | null | undefined): { bucket: string; key: string } | null {
  if (!value) return null;
  if (!value.startsWith("s3://")) return null;
  const raw = value.slice("s3://".length);
  const splitIndex = raw.indexOf("/");
  if (splitIndex <= 0 || splitIndex >= raw.length - 1) return null;
  return {
    bucket: raw.slice(0, splitIndex),
    key: raw.slice(splitIndex + 1),
  };
}

async function signStorageGetUrl(value: string | null) {
  if (!value) return null;
  const pointer = parseStoragePointer(value);
  if (!pointer) return value;
  const client = getS3Client();
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: pointer.bucket,
      Key: pointer.key,
    }),
    { expiresIn: env.S3_SIGNED_URL_TTL_SECONDS }
  );
}

async function hydrateSignedFileUrls<T extends { file_url: string | null }>(rows: T[]): Promise<T[]> {
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      file_url: await signStorageGetUrl(row.file_url),
    }))
  );
}

function normalizeDocumentStatus(value: string): SellerDocumentStatus {
  return value === "pending" ? "requested" : (value as SellerDocumentStatus);
}

function resolveExpiresAt(uploadedAt: string | null, validityYears: number | null): string | null {
  if (!uploadedAt || !validityYears || validityYears <= 0) return null;
  const expiresAt = new Date(uploadedAt);
  if (Number.isNaN(expiresAt.getTime())) return null;
  expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + validityYears);
  return expiresAt.toISOString();
}

function resolveEffectiveDocumentStatus(status: SellerDocumentStatus, expired: boolean): SellerDocumentStatus {
  if (status === "expired" || expired) return "expired";
  return status;
}

function resolveEffectiveOptionalStatus(status: OptionalUploadStatus, expired: boolean): OptionalUploadStatus {
  if (status === "expired" || expired) return "expired";
  return status;
}

async function ensureComplianceDocumentValiditySchema() {
  if (!ensureComplianceDocumentValiditySchemaPromise) {
    ensureComplianceDocumentValiditySchemaPromise = (async () => {
      const client = await pool.connect();
      try {
        await client.query(`
          DO $$
          BEGIN
            IF NOT EXISTS (
              SELECT 1
              FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'compliance_documents_list'
                AND column_name = 'validity_years'
            ) THEN
              IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'compliance_documents_list'
                  AND column_name = 'validity_days'
              ) THEN
                ALTER TABLE compliance_documents_list
                  RENAME COLUMN validity_days TO validity_years;
              ELSE
                ALTER TABLE compliance_documents_list
                  ADD COLUMN validity_years integer;
              END IF;
            END IF;

            IF NOT EXISTS (
              SELECT 1
              FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'seller_compliance_documents'
                AND column_name = 'notes'
            ) THEN
              ALTER TABLE seller_compliance_documents
                ADD COLUMN notes text;
            END IF;
          END
          $$;
        `);
        await client.query(`
          ALTER TABLE compliance_documents_list
            DROP CONSTRAINT IF EXISTS compliance_documents_list_validity_days_check;
          ALTER TABLE compliance_documents_list
            DROP CONSTRAINT IF EXISTS compliance_documents_list_validity_years_check;
          ALTER TABLE compliance_documents_list
            ADD CONSTRAINT compliance_documents_list_validity_years_check
            CHECK (validity_years IS NULL OR validity_years > 0);
        `);
      } finally {
        client.release();
      }
    })().catch((error) => {
      ensureComplianceDocumentValiditySchemaPromise = null;
      throw error;
    });
  }

  await ensureComplianceDocumentValiditySchemaPromise;
}

async function complianceSchemaMiddleware(_req: Request, res: Response, next: NextFunction) {
  try {
    await ensureComplianceDocumentValiditySchema();
    return next();
  } catch (error) {
    console.error("[compliance] validity schema guard failed:", error);
    return res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Compliance schema validation failed",
      },
    });
  }
}

sellerComplianceRouter.use(complianceSchemaMiddleware);
adminComplianceRouter.use(complianceSchemaMiddleware);

async function syncSellerDocumentExpiry(client: { query: typeof pool.query }, sellerId?: string | null) {
  await client.query(
    `UPDATE seller_compliance_documents scd
     SET
       expires_at = CASE
         WHEN scd.uploaded_at IS NOT NULL
           AND cdl.validity_years IS NOT NULL
           AND cdl.validity_years > 0
         THEN scd.uploaded_at + make_interval(years => cdl.validity_years)
         ELSE NULL
       END,
       expired = CASE
         WHEN scd.status IN ('uploaded', 'approved', 'expired')
           AND scd.uploaded_at IS NOT NULL
           AND cdl.validity_years IS NOT NULL
           AND cdl.validity_years > 0
           AND scd.uploaded_at + make_interval(years => cdl.validity_years) <= now()
         THEN TRUE
         ELSE FALSE
       END,
       updated_at = CASE
         WHEN scd.expires_at IS DISTINCT FROM CASE
           WHEN scd.uploaded_at IS NOT NULL
             AND cdl.validity_years IS NOT NULL
             AND cdl.validity_years > 0
           THEN scd.uploaded_at + make_interval(years => cdl.validity_years)
           ELSE NULL
         END
         OR scd.expired IS DISTINCT FROM CASE
           WHEN scd.status IN ('uploaded', 'approved', 'expired')
             AND scd.uploaded_at IS NOT NULL
             AND cdl.validity_years IS NOT NULL
             AND cdl.validity_years > 0
             AND scd.uploaded_at + make_interval(years => cdl.validity_years) <= now()
           THEN TRUE
           ELSE FALSE
         END
         THEN now()
         ELSE scd.updated_at
       END
     FROM compliance_documents_list cdl
     WHERE cdl.id = scd.document_list_id
       AND ($1::uuid IS NULL OR scd.seller_id = $1::uuid)`,
    [sellerId ?? null]
  );
}

async function syncSellerOptionalUploadExpiry(client: { query: typeof pool.query }, sellerId?: string | null) {
  await client.query(
    `UPDATE seller_optional_uploads sou
     SET
       expires_at = CASE
         WHEN sou.created_at IS NOT NULL
           AND cdl.validity_years IS NOT NULL
           AND cdl.validity_years > 0
         THEN sou.created_at + make_interval(years => cdl.validity_years)
         ELSE NULL
       END,
       expired = CASE
         WHEN sou.status IN ('uploaded', 'approved', 'expired')
           AND sou.created_at IS NOT NULL
           AND cdl.validity_years IS NOT NULL
           AND cdl.validity_years > 0
           AND sou.created_at + make_interval(years => cdl.validity_years) <= now()
         THEN TRUE
         ELSE FALSE
       END,
       updated_at = CASE
         WHEN sou.expires_at IS DISTINCT FROM CASE
           WHEN sou.created_at IS NOT NULL
             AND cdl.validity_years IS NOT NULL
             AND cdl.validity_years > 0
           THEN sou.created_at + make_interval(years => cdl.validity_years)
           ELSE NULL
         END
         OR sou.expired IS DISTINCT FROM CASE
           WHEN sou.status IN ('uploaded', 'approved', 'expired')
             AND sou.created_at IS NOT NULL
             AND cdl.validity_years IS NOT NULL
             AND cdl.validity_years > 0
             AND sou.created_at + make_interval(years => cdl.validity_years) <= now()
           THEN TRUE
           ELSE FALSE
         END
         THEN now()
         ELSE sou.updated_at
       END
     FROM compliance_documents_list cdl
     WHERE cdl.id = sou.document_list_id
       AND ($1::uuid IS NULL OR sou.seller_id = $1::uuid)`,
    [sellerId ?? null]
  );
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
  const requestedRequiredCount = requiredRows.filter((row) => row.status === "requested" || row.status === "expired").length;
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
  await syncSellerDocumentExpiry(client, sellerId);
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
    validity_years: number | null;
    is_active: boolean;
    version: number;
    is_current: boolean;
    expired: boolean;
    expires_at: string | null;
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
       cdl.validity_years,
       cdl.is_active,
       scd.version,
       scd.is_current,
       scd.expired,
       scd.expires_at::text
     FROM seller_compliance_documents scd
     JOIN compliance_documents_list cdl ON cdl.id = scd.document_list_id
     WHERE scd.seller_id = $1
     ORDER BY cdl.name ASC, scd.version DESC, scd.created_at DESC`,
    [sellerId]
  ).then((result) => ({
    ...result,
    rows: result.rows.map((row) => ({
      ...row,
      status: resolveEffectiveDocumentStatus(row.status, row.expired),
    })),
  }));
}

function filterCurrentDocuments<T extends { is_current: boolean }>(rows: T[]) {
  return rows.filter((row) => row.is_current);
}

async function ensureSellerAssignments(sellerId: string) {
  await pool.query(
    `INSERT INTO seller_compliance_documents (
       seller_id,
       document_list_id,
       is_required,
       status,
       version,
       is_current,
       created_at,
       updated_at
     )
     SELECT $1, cdl.id, cdl.is_required_default, 'requested', 1, TRUE, now(), now()
     FROM compliance_documents_list cdl
     WHERE cdl.is_active = TRUE
       AND NOT EXISTS (
         SELECT 1
         FROM seller_compliance_documents scd
         WHERE scd.seller_id = $1
           AND scd.document_list_id = cdl.id
           AND scd.is_current = TRUE
       )`,
    [sellerId]
  );
}

async function getSellerOptionalUploads(client: { query: typeof pool.query }, sellerId: string) {
  await syncSellerOptionalUploadExpiry(client, sellerId);
  return client.query<{
    id: string;
    seller_id: string;
    document_list_id: string | null;
    catalog_doc_code: string | null;
    catalog_doc_name: string | null;
    custom_title: string | null;
    custom_description: string | null;
    file_url: string;
    status: OptionalUploadStatus;
    reviewed_at: string | null;
    rejection_reason: string | null;
    created_at: string;
    updated_at: string;
    validity_years: number | null;
    expired: boolean;
    expires_at: string | null;
  }>(
    `SELECT
       sou.id::text,
       sou.seller_id::text,
       sou.document_list_id::text,
       cdl.code AS catalog_doc_code,
       cdl.name AS catalog_doc_name,
       sou.custom_title,
       sou.custom_description,
       sou.file_url,
       sou.status,
       sou.reviewed_at::text,
       sou.rejection_reason,
       sou.created_at::text,
       sou.updated_at::text,
       cdl.validity_years,
       sou.expired,
       sou.expires_at::text
     FROM seller_optional_uploads sou
     LEFT JOIN compliance_documents_list cdl ON cdl.id = sou.document_list_id
     WHERE sou.seller_id = $1
     ORDER BY sou.created_at DESC`,
    [sellerId]
  ).then((result) => ({
    ...result,
    rows: result.rows.map((row) => ({
      ...row,
      status: resolveEffectiveOptionalStatus(row.status, row.expired),
    })),
  }));
}

sellerComplianceRouter.get("/profile", requireAuth("app"), async (req, res) => {
  const role = resolveActorRole(req);
  if (role !== "seller") {
    return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Seller role required" } });
  }

  await ensureSellerAssignments(req.auth!.userId);
  const docs = await getSellerDocuments(pool, req.auth!.userId);
  const optionalUploads = await getSellerOptionalUploads(pool, req.auth!.userId);
  const docsWithSignedUrls = await hydrateSignedFileUrls(docs.rows);
  const optionalUploadsWithSignedUrls = await hydrateSignedFileUrls(optionalUploads.rows);
  const currentDocs = filterCurrentDocuments(docsWithSignedUrls);
  const profile = computeSellerComplianceProfile(currentDocs);
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
      documents: currentDocs,
      optionalUploads: optionalUploadsWithSignedUrls,
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

  const docType = await pool.query<{ id: string; is_required_default: boolean; validity_years: number | null }>(
    "SELECT id::text, is_required_default, validity_years FROM compliance_documents_list WHERE code = $1 AND is_active = TRUE",
    [input.docType]
  );
  if ((docType.rowCount ?? 0) === 0) {
    return res.status(404).json({ error: { code: "DOCUMENT_TYPE_NOT_FOUND", message: "Document type not found" } });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const uploadedAt = new Date().toISOString();
    const expiresAt = resolveExpiresAt(uploadedAt, docType.rows[0].validity_years);
    const currentRow = await client.query<{
      id: string;
      is_required: boolean;
      version: number;
      status: SellerDocumentStatus;
      file_url: string | null;
      uploaded_at: string | null;
    }>(
      `SELECT
         id::text,
         is_required,
         version,
         status,
         file_url,
         uploaded_at::text
       FROM seller_compliance_documents
       WHERE seller_id = $1
         AND document_list_id = $2
         AND is_current = TRUE
       FOR UPDATE`,
      [req.auth!.userId, docType.rows[0].id]
    );

    let documentId: string;
    if ((currentRow.rowCount ?? 0) === 0) {
      const inserted = await client.query<{ id: string }>(
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
         VALUES ($1, $2, $3, 'uploaded', $4, $5, NULL, NULL, NULL, $6, $7, FALSE, 1, TRUE, now(), now())
         RETURNING id::text`,
        [req.auth!.userId, docType.rows[0].id, docType.rows[0].is_required_default, input.fileUrl, uploadedAt, input.notes ?? null, expiresAt]
      );
      documentId = inserted.rows[0].id;
    } else {
      const current = currentRow.rows[0];
      const canReuseCurrentVersion =
        current.version === 1 &&
        current.status === "requested" &&
        current.file_url === null &&
        current.uploaded_at === null;

      if (canReuseCurrentVersion) {
        const updated = await client.query<{ id: string }>(
          `UPDATE seller_compliance_documents
           SET
             status = 'uploaded',
             file_url = $3,
             uploaded_at = $4,
             reviewed_at = NULL,
             reviewed_by_admin_id = NULL,
             rejection_reason = NULL,
             notes = $5,
             expires_at = $6,
             expired = FALSE,
             updated_at = now()
           WHERE id = $1
             AND seller_id = $2
           RETURNING id::text`,
          [current.id, req.auth!.userId, input.fileUrl, uploadedAt, input.notes ?? null, expiresAt]
        );
        documentId = updated.rows[0].id;
      } else {
        await client.query(
          `UPDATE seller_compliance_documents
           SET is_current = FALSE,
               updated_at = now()
           WHERE id = $1`,
          [current.id]
        );
        const inserted = await client.query<{ id: string }>(
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
           VALUES ($1, $2, $3, 'uploaded', $4, $5, NULL, NULL, NULL, $6, $7, FALSE, $8, TRUE, now(), now())
           RETURNING id::text`,
          [req.auth!.userId, docType.rows[0].id, current.is_required, input.fileUrl, uploadedAt, input.notes ?? null, expiresAt, current.version + 1]
        );
        documentId = inserted.rows[0].id;
      }
    }

    await client.query("COMMIT");
    return res.status(201).json({ data: { documentId } });
  } catch {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Document upload failed" } });
  } finally {
    client.release();
  }
});

sellerComplianceRouter.get("/documents", requireAuth("app"), async (req, res) => {
  const role = resolveActorRole(req);
  if (role !== "seller") {
    return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Seller role required" } });
  }
  await ensureSellerAssignments(req.auth!.userId);
  const docs = await getSellerDocuments(pool, req.auth!.userId);
  const docsWithSignedUrls = await hydrateSignedFileUrls(docs.rows);
  return res.json({ data: filterCurrentDocuments(docsWithSignedUrls) });
});

sellerComplianceRouter.get("/optional-uploads", requireAuth("app"), async (req, res) => {
  const role = resolveActorRole(req);
  if (role !== "seller") {
    return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Seller role required" } });
  }
  const uploads = await getSellerOptionalUploads(pool, req.auth!.userId);
  const uploadsWithSignedUrls = await hydrateSignedFileUrls(uploads.rows);
  return res.json({ data: uploadsWithSignedUrls });
});

sellerComplianceRouter.post("/optional-uploads", requireAuth("app"), async (req, res) => {
  const role = resolveActorRole(req);
  if (role !== "seller") {
    return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Seller role required" } });
  }
  const parsed = OptionalUploadCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let validityYears: number | null = null;
    if (input.documentListId) {
      const docType = await client.query<{ id: string; validity_years: number | null }>(
        "SELECT id::text, validity_years FROM compliance_documents_list WHERE id = $1 AND is_active = TRUE",
        [input.documentListId]
      );
      if ((docType.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: { code: "DOCUMENT_TYPE_NOT_FOUND", message: "Document type not found" } });
      }
      validityYears = docType.rows[0].validity_years;
    }
    const createdAt = new Date().toISOString();
    const expiresAt = resolveExpiresAt(createdAt, validityYears);

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO seller_optional_uploads (
         seller_id,
         document_list_id,
         custom_title,
         custom_description,
         file_url,
         status,
         expires_at,
         expired,
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, 'uploaded', $6, FALSE, $7, now())
       RETURNING id::text`,
      [req.auth!.userId, input.documentListId ?? null, input.customTitle?.trim() || null, input.customDescription?.trim() || null, input.fileUrl, expiresAt, createdAt]
    );

    await client.query("COMMIT");
    return res.status(201).json({ data: { uploadId: inserted.rows[0].id } });
  } catch {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Optional upload create failed" } });
  } finally {
    client.release();
  }
});

sellerComplianceRouter.delete("/optional-uploads/:uploadId", requireAuth("app"), async (req, res) => {
  const role = resolveActorRole(req);
  if (role !== "seller") {
    return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Seller role required" } });
  }
  const params = OptionalUploadParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const archived = await pool.query<{ id: string }>(
    `UPDATE seller_optional_uploads
     SET status = 'archived',
         expired = FALSE,
         updated_at = now()
     WHERE id = $1
       AND seller_id = $2
     RETURNING id::text`,
    [params.data.uploadId, req.auth!.userId]
  );
  if ((archived.rowCount ?? 0) === 0) {
    return res.status(404).json({ error: { code: "OPTIONAL_UPLOAD_NOT_FOUND", message: "Optional upload not found" } });
  }
  return res.json({ data: { archived: true, uploadId: archived.rows[0].id } });
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
       expires_at = NULL,
       expired = FALSE,
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
  const profile = computeSellerComplianceProfile(filterCurrentDocuments(docs.rows));
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
     WHERE scd.is_current = TRUE
       AND (scd.expires_at IS NULL OR scd.expires_at > now())
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
    validity_years: number | null;
    is_active: boolean;
    is_required_default: boolean;
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
       cdl.validity_years,
       cdl.is_active,
       cdl.is_required_default,
       count(scd.id) FILTER (WHERE scd.is_current = TRUE)::text AS seller_assignment_count,
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
    validity_years: number | null;
    is_active: boolean;
    is_required_default: boolean;
      created_at: string;
      updated_at: string;
    }>(
      `INSERT INTO compliance_documents_list (
         code,
         name,
         description,
         source_info,
         details,
         validity_years,
         is_active,
         is_required_default,
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
       RETURNING
         id::text,
         code,
         name,
         description,
         source_info,
         details,
         validity_years,
         is_active,
         is_required_default,
         created_at::text,
         updated_at::text`,
      [input.code, input.name, input.description ?? null, input.sourceInfo ?? null, input.details ?? null, input.validityYears ?? null, input.isActive ?? true, input.isRequiredDefault ?? true]
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
    console.error("[compliance] document list create failed:", error);
    if (String((error as { code?: string } | undefined)?.code ?? "") === "42703") {
      return res.status(500).json({
        error: {
          code: "DB_SCHEMA_OUTDATED",
          message: "Database schema is missing compliance document columns. Run the compliance schema fix script.",
        },
      });
    }
    if (String((error as { code?: string } | undefined)?.code ?? "") === "23505") {
      return res.status(409).json({ error: { code: "DOCUMENT_CODE_EXISTS", message: "Document code already exists" } });
    }
    const detail = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Document list create failed", detail } });
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
      validity_years: number | null;
      is_active: boolean;
      is_required_default: boolean;
    }>(
      `SELECT
         id::text,
         code,
         name,
         description,
         source_info,
         details,
         validity_years,
         is_active,
         is_required_default
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
      validity_years: number | null;
      is_active: boolean;
      is_required_default: boolean;
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
         validity_years = CASE WHEN $10::boolean THEN $11 ELSE validity_years END,
         is_active = COALESCE($12, is_active),
         is_required_default = COALESCE($13, is_required_default),
         updated_at = now()
       WHERE id = $1
       RETURNING
         id::text,
         code,
         name,
         description,
         source_info,
         details,
         validity_years,
         is_active,
         is_required_default,
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
        input.validityYears !== undefined,
        input.validityYears ?? null,
        input.isActive ?? null,
        input.isRequiredDefault ?? null,
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
    console.error("[compliance] document list update failed:", error);
    if (String((error as { code?: string } | undefined)?.code ?? "") === "42703") {
      return res.status(500).json({
        error: {
          code: "DB_SCHEMA_OUTDATED",
          message: "Database schema is missing compliance document columns. Run the compliance schema fix script.",
        },
      });
    }
    if (String((error as { code?: string } | undefined)?.code ?? "") === "23505") {
      return res.status(409).json({ error: { code: "DOCUMENT_CODE_EXISTS", message: "Document code already exists" } });
    }
    const detail = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Document list update failed", detail } });
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
    const before = await client.query<{
      id: string;
      code: string;
      name: string;
      is_active: boolean;
    }>(
      `SELECT id::text, code, name, is_active
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
      is_active: boolean;
      is_required_default: boolean;
      updated_at: string;
    }>(
      `UPDATE compliance_documents_list
       SET is_active = FALSE,
           is_required_default = FALSE,
           updated_at = now()
       WHERE id = $1
       RETURNING id::text, code, name, is_active, is_required_default, updated_at::text`,
      [params.data.documentListId]
    );

    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "compliance_document_list_soft_deleted",
      entityType: "compliance_documents_list",
      entityId: params.data.documentListId,
      before: before.rows[0],
      after: updated.rows[0],
    });

    await client.query("COMMIT");
    return res.json({
      data: {
        deleted: true,
        id: params.data.documentListId,
        isActive: updated.rows[0].is_active,
      },
    });
  } catch {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Document list delete failed" } });
  } finally {
    client.release();
  }
});

adminComplianceRouter.post("/:sellerId/documents/presign-upload", requireAuth("admin"), async (req, res) => {
  const sellerId = String(req.params.sellerId ?? "");
  if (!z.string().uuid().safeParse(sellerId).success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid sellerId" } });
  }
  const parsed = PresignDocumentUploadSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  if (!isS3StorageConfigured()) {
    return res.status(503).json({ error: { code: "STORAGE_NOT_CONFIGURED", message: "S3 storage is not configured" } });
  }

  const docType = await pool.query<{ id: string }>(
    "SELECT id::text FROM compliance_documents_list WHERE code = $1 AND is_active = TRUE",
    [parsed.data.docType]
  );
  if ((docType.rowCount ?? 0) === 0) {
    return res.status(404).json({ error: { code: "DOCUMENT_TYPE_NOT_FOUND", message: "Document type not found" } });
  }

  try {
    const key = buildSellerDocumentStorageKey(sellerId, parsed.data.docType, parsed.data.fileName);
    const bucket = env.S3_BUCKET_SELLER_DOCS!;
    const client = getS3Client();
    const uploadUrl = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: parsed.data.contentType || "application/octet-stream",
      }),
      { expiresIn: env.S3_SIGNED_URL_TTL_SECONDS }
    );
    return res.json({
      data: {
        uploadUrl,
        fileUrl: toStoragePointer(bucket, key),
        objectKey: key,
        expiresInSeconds: env.S3_SIGNED_URL_TTL_SECONDS,
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Upload URL generation failed", detail } });
  }
});

adminComplianceRouter.post("/:sellerId/documents/upload", requireAuth("admin"), async (req, res) => {
  const sellerId = String(req.params.sellerId ?? "");
  if (!z.string().uuid().safeParse(sellerId).success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid sellerId" } });
  }
  const parsed = UploadDocumentSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;

  const docType = await pool.query<{ id: string; is_required_default: boolean; validity_years: number | null }>(
    "SELECT id::text, is_required_default, validity_years FROM compliance_documents_list WHERE code = $1 AND is_active = TRUE",
    [input.docType]
  );
  if ((docType.rowCount ?? 0) === 0) {
    return res.status(404).json({ error: { code: "DOCUMENT_TYPE_NOT_FOUND", message: "Document type not found" } });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const uploadedAt = new Date().toISOString();
    const expiresAt = resolveExpiresAt(uploadedAt, docType.rows[0].validity_years);
    const currentRow = await client.query<{
      id: string;
      is_required: boolean;
      version: number;
      status: SellerDocumentStatus;
      file_url: string | null;
      uploaded_at: string | null;
    }>(
      `SELECT
         id::text,
         is_required,
         version,
         status,
         file_url,
         uploaded_at::text
       FROM seller_compliance_documents
       WHERE seller_id = $1
         AND document_list_id = $2
         AND is_current = TRUE
       FOR UPDATE`,
      [sellerId, docType.rows[0].id]
    );

    const before = currentRow.rows[0]
      ? {
          status: currentRow.rows[0].status,
          fileUrl: currentRow.rows[0].file_url,
        }
      : null;

    let documentId: string;
    if ((currentRow.rowCount ?? 0) === 0) {
      const inserted = await client.query<{ id: string }>(
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
         VALUES ($1, $2, $3, 'uploaded', $4, $5, NULL, NULL, NULL, $6, $7, FALSE, 1, TRUE, now(), now())
         RETURNING id::text`,
        [sellerId, docType.rows[0].id, docType.rows[0].is_required_default, input.fileUrl, uploadedAt, input.notes ?? null, expiresAt]
      );
      documentId = inserted.rows[0].id;
    } else {
      const current = currentRow.rows[0];
      const canReuseCurrentVersion =
        current.version === 1 &&
        current.status === "requested" &&
        current.file_url === null &&
        current.uploaded_at === null;

      if (canReuseCurrentVersion) {
        const updated = await client.query<{ id: string }>(
          `UPDATE seller_compliance_documents
           SET
             status = 'uploaded',
             file_url = $3,
             uploaded_at = $4,
             reviewed_at = NULL,
             reviewed_by_admin_id = NULL,
             rejection_reason = NULL,
             notes = $5,
             expires_at = $6,
             expired = FALSE,
             updated_at = now()
           WHERE id = $1
             AND seller_id = $2
           RETURNING id::text`,
          [current.id, sellerId, input.fileUrl, uploadedAt, input.notes ?? null, expiresAt]
        );
        documentId = updated.rows[0].id;
      } else {
        await client.query(
          `UPDATE seller_compliance_documents
           SET is_current = FALSE,
               updated_at = now()
           WHERE id = $1`,
          [current.id]
        );
        const inserted = await client.query<{ id: string }>(
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
           VALUES ($1, $2, $3, 'uploaded', $4, $5, NULL, NULL, NULL, $6, $7, FALSE, $8, TRUE, now(), now())
           RETURNING id::text`,
          [sellerId, docType.rows[0].id, current.is_required, input.fileUrl, uploadedAt, input.notes ?? null, expiresAt, current.version + 1]
        );
        documentId = inserted.rows[0].id;
      }
    }

    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "compliance_document_uploaded_by_admin",
      entityType: "seller_compliance_documents",
      entityId: documentId,
      before,
      after: { sellerId, docType: input.docType, fileUrl: input.fileUrl, status: "uploaded" },
    });

    await client.query("COMMIT");
    return res.status(201).json({ data: { documentId } });
  } catch {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Document upload failed" } });
  } finally {
    client.release();
  }
});

adminComplianceRouter.get("/:sellerId/optional-uploads", requireAuth("admin"), async (req, res) => {
  const sellerId = String(req.params.sellerId ?? "");
  if (!z.string().uuid().safeParse(sellerId).success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid sellerId" } });
  }
  const uploads = await getSellerOptionalUploads(pool, sellerId);
  const uploadsWithSignedUrls = await hydrateSignedFileUrls(uploads.rows);
  return res.json({ data: uploadsWithSignedUrls });
});

adminComplianceRouter.patch("/:sellerId/optional-uploads/:uploadId", requireAuth("admin"), async (req, res) => {
  const sellerId = String(req.params.sellerId ?? "");
  if (!z.string().uuid().safeParse(sellerId).success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid sellerId" } });
  }
  const params = OptionalUploadParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }
  const parsed = OptionalUploadStatusUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await client.query<{
      id: string;
      status: OptionalUploadStatus;
      rejection_reason: string | null;
    }>(
      `SELECT id::text, status, rejection_reason
       FROM seller_optional_uploads
       WHERE id = $1
         AND seller_id = $2
       FOR UPDATE`,
      [params.data.uploadId, sellerId]
    );
    if ((before.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "OPTIONAL_UPLOAD_NOT_FOUND", message: "Optional upload not found" } });
    }

    const updated = await client.query<{ id: string; status: OptionalUploadStatus }>(
      `UPDATE seller_optional_uploads
       SET
         status = $3,
         rejection_reason = CASE WHEN $3 IN ('rejected', 'uploaded') THEN $4 ELSE NULL END,
         expired = CASE
           WHEN $3 IN ('uploaded', 'approved') AND expires_at IS NOT NULL AND expires_at <= now() THEN TRUE
           ELSE FALSE
         END,
         reviewed_at = CASE WHEN $3 IN ('approved', 'rejected') THEN now() ELSE NULL END,
         reviewed_by_admin_id = CASE WHEN $3 IN ('approved', 'rejected') THEN $5 ELSE NULL END,
         updated_at = now()
       WHERE id = $1
         AND seller_id = $2
       RETURNING id::text, status`,
      [params.data.uploadId, sellerId, parsed.data.status, parsed.data.rejectionReason ?? null, req.auth!.userId]
    );

    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "seller_optional_upload_status_updated",
      entityType: "seller_optional_uploads",
      entityId: params.data.uploadId,
      before: {
        status: before.rows[0].status,
        rejectionReason: before.rows[0].rejection_reason,
      },
      after: {
        status: updated.rows[0].status,
        rejectionReason: parsed.data.status === "rejected" || parsed.data.status === "uploaded" ? parsed.data.rejectionReason ?? null : null,
        sellerId,
      },
    });

    await client.query("COMMIT");
    return res.json({
      data: {
        sellerId,
        uploadId: updated.rows[0].id,
        status: updated.rows[0].status,
      },
    });
  } catch {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Optional upload status update failed" } });
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
  const optionalUploads = await getSellerOptionalUploads(pool, sellerId);
  const docsWithSignedUrls = await hydrateSignedFileUrls(docs.rows);
  const optionalUploadsWithSignedUrls = await hydrateSignedFileUrls(optionalUploads.rows);
  const currentDocs = filterCurrentDocuments(docsWithSignedUrls);
  const profile = computeSellerComplianceProfile(currentDocs);

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
      documents: docsWithSignedUrls.map((row) => ({
        ...row,
        doc_type: row.code,
      })),
      profileDocuments: currentDocs.map((row) => ({
        id: row.id,
        seller_id: row.seller_id,
        doc_type: row.code,
        latest_document_id: row.id,
        status: row.status,
        required: row.is_required,
        updated_at: row.updated_at,
      })),
      optionalUploads: optionalUploadsWithSignedUrls,
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
         rejection_reason = CASE WHEN $3 IN ('rejected', 'requested') THEN $4 ELSE NULL END,
         expired = CASE
           WHEN $3 IN ('uploaded', 'approved') AND expires_at IS NOT NULL AND expires_at <= now() THEN TRUE
           ELSE FALSE
         END,
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
        rejectionReason: normalizedStatus === "rejected" || normalizedStatus === "requested" ? parsed.data.rejectionReason ?? null : null,
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
  } catch (err) {
    console.error("[compliance] document status update failed:", err);
    await client.query("ROLLBACK");
    const detail = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Compliance document update failed", detail } });
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

    const before = await client.query<{ id: string; is_required: boolean }>(
      `SELECT id::text, is_required
       FROM seller_compliance_documents
       WHERE seller_id = $1
         AND document_list_id = $2
         AND is_current = TRUE
       FOR UPDATE`,
      [sellerId, list.rows[0].id]
    );

    let documentId = before.rows[0]?.id ?? null;
    let required = parsed.data.required;
    if (documentId) {
      const updated = await client.query<{ id: string; is_required: boolean }>(
        `UPDATE seller_compliance_documents
         SET is_required = $3,
             updated_at = now()
         WHERE id = $1
           AND seller_id = $2
         RETURNING id::text, is_required`,
        [documentId, sellerId, parsed.data.required]
      );
      documentId = updated.rows[0].id;
      required = updated.rows[0].is_required;
    } else {
      const inserted = await client.query<{ id: string; is_required: boolean }>(
        `INSERT INTO seller_compliance_documents (
           seller_id,
           document_list_id,
           is_required,
           status,
           version,
           is_current,
           created_at,
           updated_at
         )
         VALUES ($1, $2, $3, 'requested', 1, TRUE, now(), now())
         RETURNING id::text, is_required`,
        [sellerId, list.rows[0].id, parsed.data.required]
      );
      documentId = inserted.rows[0].id;
      required = inserted.rows[0].is_required;
    }

    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "compliance_document_requirement_updated",
      entityType: "seller_compliance_documents",
      entityId: documentId!,
      before: { required: before.rows[0]?.is_required ?? null, docType, sellerId },
      after: { required, docType, sellerId },
    });

    await client.query("COMMIT");
    return res.json({
      data: {
        sellerId,
        docType,
        required,
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
         expired = CASE WHEN expires_at IS NOT NULL AND expires_at <= now() THEN TRUE ELSE FALSE END,
         reviewed_at = now(),
         reviewed_by_admin_id = $2,
         notes = COALESCE($3, notes),
         updated_at = now()
     WHERE seller_id = $1
       AND is_required = TRUE
       AND is_current = TRUE
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
         expired = FALSE,
         reviewed_at = now(),
         reviewed_by_admin_id = $2,
         updated_at = now()
     WHERE seller_id = $1
       AND is_required = TRUE
       AND is_current = TRUE
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
         expired = FALSE,
         reviewed_at = NULL,
         reviewed_by_admin_id = NULL,
         updated_at = now()
     WHERE seller_id = $1
       AND is_required = TRUE
       AND is_current = TRUE`,
    [sellerId, req.auth!.userId, parsed.data.reviewNotes ?? null]
  );
  return res.json({ data: { sellerId, updatedCount: result.rowCount ?? 0, status: "in_progress" } });
});
