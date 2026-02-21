import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/client.js";
import { requireAuth } from "../middleware/auth.js";

const AuditQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  source: z
    .enum([
      "admin_audit",
      "auth_audit",
      "admin_auth_audit",
      "abuse_risk",
      "order_event",
      "compliance_event",
      "lot_event",
    ])
    .optional(),
  eventType: z.string().min(1).max(120).optional(),
  actorId: z.string().min(1).max(120).optional(),
  entityType: z.string().min(1).max(120).optional(),
  search: z.string().min(1).max(200).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  sortBy: z.enum(["createdAt", "source", "eventType"]).default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

type AuditQuery = z.infer<typeof AuditQuerySchema>;

type AuditRow = {
  event_id: string;
  source: string;
  event_type: string;
  actor_id: string | null;
  actor_label: string | null;
  entity_type: string | null;
  entity_id: string | null;
  ip: string | null;
  user_agent: string | null;
  payload_json: unknown;
  created_at: string;
};

const SORT_MAP: Record<AuditQuery["sortBy"], string> = {
  createdAt: "created_at",
  source: "source",
  eventType: "event_type",
};

const EVENTS_CTE = `
  WITH events AS (
    SELECT
      id::text AS event_id,
      'admin_audit'::text AS source,
      action::text AS event_type,
      actor_admin_id::text AS actor_id,
      actor_email::text AS actor_label,
      entity_type::text AS entity_type,
      entity_id::text AS entity_id,
      NULL::text AS ip,
      NULL::text AS user_agent,
      jsonb_build_object('before', before_json, 'after', after_json, 'actorRole', actor_role) AS payload_json,
      created_at
    FROM admin_audit_logs

    UNION ALL

    SELECT
      id::text AS event_id,
      'auth_audit'::text AS source,
      event_type::text AS event_type,
      user_id::text AS actor_id,
      NULL::text AS actor_label,
      'user'::text AS entity_type,
      user_id::text AS entity_id,
      ip::text AS ip,
      user_agent::text AS user_agent,
      NULL::jsonb AS payload_json,
      created_at
    FROM auth_audit

    UNION ALL

    SELECT
      id::text AS event_id,
      'admin_auth_audit'::text AS source,
      event_type::text AS event_type,
      admin_user_id::text AS actor_id,
      NULL::text AS actor_label,
      'admin_user'::text AS entity_type,
      admin_user_id::text AS entity_id,
      ip::text AS ip,
      user_agent::text AS user_agent,
      NULL::jsonb AS payload_json,
      created_at
    FROM admin_auth_audit

    UNION ALL

    SELECT
      id::text AS event_id,
      'abuse_risk'::text AS source,
      flow::text AS event_type,
      subject_id::text AS actor_id,
      decision::text AS actor_label,
      subject_type::text AS entity_type,
      subject_id::text AS entity_id,
      NULL::text AS ip,
      NULL::text AS user_agent,
      jsonb_build_object(
        'riskScore', risk_score,
        'reasonCodes', reason_codes_json,
        'decision', decision,
        'requestFingerprint', request_fingerprint
      ) AS payload_json,
      created_at
    FROM abuse_risk_events

    UNION ALL

    SELECT
      id::text AS event_id,
      'order_event'::text AS source,
      event_type::text AS event_type,
      actor_user_id::text AS actor_id,
      NULL::text AS actor_label,
      'order'::text AS entity_type,
      order_id::text AS entity_id,
      NULL::text AS ip,
      NULL::text AS user_agent,
      jsonb_build_object('fromStatus', from_status, 'toStatus', to_status, 'payload', payload_json) AS payload_json,
      created_at
    FROM order_events

    UNION ALL

    SELECT
      id::text AS event_id,
      'compliance_event'::text AS source,
      event_type::text AS event_type,
      actor_admin_id::text AS actor_id,
      NULL::text AS actor_label,
      'seller_compliance'::text AS entity_type,
      seller_id::text AS entity_id,
      NULL::text AS ip,
      NULL::text AS user_agent,
      payload_json,
      created_at
    FROM seller_compliance_events

    UNION ALL

    SELECT
      id::text AS event_id,
      'lot_event'::text AS source,
      event_type::text AS event_type,
      created_by::text AS actor_id,
      NULL::text AS actor_label,
      'lot'::text AS entity_type,
      lot_id::text AS entity_id,
      NULL::text AS ip,
      NULL::text AS user_agent,
      event_payload_json AS payload_json,
      created_at
    FROM lot_events
  )
`;

export const adminAuditRouter = Router();

adminAuditRouter.get("/audit/events", requireAuth("admin"), async (req, res) => {
  const parsed = AuditQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "PAGINATION_INVALID", details: parsed.error.flatten() } });
  }

  const query = parsed.data;
  const offset = (query.page - 1) * query.pageSize;

  const where = buildWhere(query);
  const sortField = SORT_MAP[query.sortBy];
  const sortDir = query.sortDir === "asc" ? "ASC" : "DESC";

  const countResult = await pool.query<{ count: string }>(
    `${EVENTS_CTE}
     SELECT count(*)::text AS count
     FROM events e
     ${where.sql}`,
    where.params
  );

  const listParams = [...where.params, query.pageSize, offset];
  const list = await pool.query<AuditRow>(
    `${EVENTS_CTE}
     SELECT
       e.event_id,
       e.source,
       e.event_type,
       e.actor_id,
       e.actor_label,
       e.entity_type,
       e.entity_id,
       e.ip,
       e.user_agent,
       e.payload_json,
       e.created_at::text
     FROM events e
     ${where.sql}
     ORDER BY ${sortField} ${sortDir}, e.event_id ${sortDir}
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  const total = Number(countResult.rows[0].count);
  return res.json({
    data: list.rows.map(mapAuditRow),
    pagination: {
      mode: "offset",
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    },
  });
});

adminAuditRouter.get("/audit/events/export", requireAuth("admin"), async (req, res) => {
  const parsed = AuditQuerySchema.safeParse({ ...req.query, page: 1, pageSize: 5000, sortBy: "createdAt", sortDir: "desc" });
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const query = parsed.data;
  const where = buildWhere(query);

  const rows = await pool.query<AuditRow>(
    `${EVENTS_CTE}
     SELECT
       e.event_id,
       e.source,
       e.event_type,
       e.actor_id,
       e.actor_label,
       e.entity_type,
       e.entity_id,
       e.ip,
       e.user_agent,
       e.payload_json,
       e.created_at::text
     FROM events e
     ${where.sql}
     ORDER BY e.created_at DESC, e.event_id DESC
     LIMIT 5000`,
    where.params
  );

  const header = [
    "eventId",
    "source",
    "eventType",
    "actorId",
    "actorLabel",
    "entityType",
    "entityId",
    "ip",
    "userAgent",
    "payload",
    "createdAt",
  ];

  const csvRows = rows.rows.map((row) => [
    row.event_id,
    row.source,
    row.event_type,
    row.actor_id ?? "",
    row.actor_label ?? "",
    row.entity_type ?? "",
    row.entity_id ?? "",
    row.ip ?? "",
    row.user_agent ?? "",
    row.payload_json ? JSON.stringify(row.payload_json) : "",
    row.created_at,
  ]);

  const csv = [header, ...csvRows].map(toCsvLine).join("\n");
  const fileName = `audit-events-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;

  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename=\"${fileName}\"`);
  return res.send(csv);
});

function buildWhere(query: AuditQuery): { sql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (query.source) {
    params.push(query.source);
    where.push(`e.source = $${params.length}`);
  }

  if (query.eventType) {
    params.push(`%${query.eventType.toLowerCase()}%`);
    where.push(`lower(e.event_type) LIKE $${params.length}`);
  }

  if (query.actorId) {
    params.push(query.actorId);
    where.push(`e.actor_id = $${params.length}`);
  }

  if (query.entityType) {
    params.push(query.entityType);
    where.push(`e.entity_type = $${params.length}`);
  }

  if (query.from) {
    params.push(query.from);
    where.push(`e.created_at >= $${params.length}::timestamptz`);
  }

  if (query.to) {
    params.push(query.to);
    where.push(`e.created_at <= $${params.length}::timestamptz`);
  }

  if (query.search) {
    params.push(`%${query.search.toLowerCase()}%`);
    const idx = params.length;
    where.push(
      `(lower(coalesce(e.actor_label, '')) LIKE $${idx}
        OR lower(coalesce(e.entity_id, '')) LIKE $${idx}
        OR lower(coalesce(e.event_type, '')) LIKE $${idx}
        OR lower(coalesce(e.source, '')) LIKE $${idx}
        OR lower(coalesce(e.payload_json::text, '')) LIKE $${idx})`
    );
  }

  if (where.length === 0) {
    return { sql: "", params };
  }

  return { sql: `WHERE ${where.join(" AND ")}`, params };
}

function mapAuditRow(row: AuditRow) {
  return {
    eventId: row.event_id,
    source: row.source,
    eventType: row.event_type,
    actorId: row.actor_id,
    actorLabel: row.actor_label,
    entityType: row.entity_type,
    entityId: row.entity_id,
    ip: row.ip,
    userAgent: row.user_agent,
    payload: row.payload_json,
    createdAt: row.created_at,
  };
}

function toCsvLine(cells: string[]): string {
  return cells
    .map((value) => {
      const escaped = String(value ?? "").replace(/"/g, '""');
      return `"${escaped}"`;
    })
    .join(",");
}
