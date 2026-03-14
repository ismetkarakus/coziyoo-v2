import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/client.js";
import { requireAuth } from "../middleware/auth.js";

export const adminSecurityRouter = Router();

adminSecurityRouter.get(
  "/security/login-risk/summary",
  requireAuth("admin"),
  async (_req, res) => {
    const riskyResult = await pool.query<{ risky_count: string }>(
      `SELECT COUNT(DISTINCT identifier) AS risky_count
       FROM security_login_state
       WHERE realm = 'app' AND consecutive_failed_count >= 3`
    );

    const softLockedResult = await pool.query<{ soft_locked_count: string }>(
      `SELECT COUNT(*) AS soft_locked_count
       FROM security_login_state
       WHERE realm = 'app' AND soft_locked = TRUE`
    );

    const sharedDeviceResult = await pool.query<{ shared_device_count: string }>(
      `SELECT COUNT(*) AS shared_device_count
       FROM (
         SELECT device_id
         FROM security_login_events
         WHERE realm = 'app'
           AND created_at > now() - interval '24 hours'
           AND device_id IS NOT NULL
         GROUP BY device_id
         HAVING COUNT(DISTINCT identifier) >= 3
       ) sub`
    );

    return res.json({
      data: {
        riskyAccountCount: Number(riskyResult.rows[0].risky_count),
        softLockedCount: Number(softLockedResult.rows[0].soft_locked_count),
        sharedDeviceAlarmCount: Number(sharedDeviceResult.rows[0].shared_device_count),
      },
    });
  }
);

const EventsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  realm: z.string().min(1).max(64).optional(),
  success: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  identifier: z.string().min(1).max(256).optional(),
  deviceId: z.string().min(1).max(128).optional(),
  ip: z.string().min(1).max(64).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  minFailedCount: z.coerce.number().int().min(0).optional(),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

adminSecurityRouter.get(
  "/security/login-risk/events",
  requireAuth("admin"),
  async (req, res) => {
    const parsed = EventsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
    }

    const q = parsed.data;
    const params: unknown[] = [];
    const conditions: string[] = [];

    let baseQuery = `
      SELECT
        e.id,
        e.realm,
        e.actor_user_id,
        e.identifier,
        e.success,
        e.failure_reason,
        e.device_id,
        e.device_name,
        e.ip,
        e.user_agent,
        e.created_at,
        COUNT(*) OVER() AS total_count
      FROM security_login_events e
    `;

    if (q.minFailedCount !== undefined) {
      baseQuery += `
      LEFT JOIN security_login_state sls ON sls.realm = e.realm AND sls.identifier = e.identifier
      `;
    }

    if (q.realm !== undefined) {
      params.push(q.realm);
      conditions.push(`e.realm = $${params.length}`);
    }

    if (q.success !== undefined) {
      params.push(q.success);
      conditions.push(`e.success = $${params.length}`);
    }

    if (q.identifier !== undefined) {
      params.push(`%${q.identifier}%`);
      conditions.push(`e.identifier ILIKE $${params.length}`);
    }

    if (q.deviceId !== undefined) {
      params.push(q.deviceId);
      conditions.push(`e.device_id = $${params.length}`);
    }

    if (q.ip !== undefined) {
      params.push(q.ip);
      conditions.push(`e.ip = $${params.length}`);
    }

    if (q.from !== undefined) {
      params.push(q.from);
      conditions.push(`e.created_at >= $${params.length}`);
    }

    if (q.to !== undefined) {
      params.push(q.to);
      conditions.push(`e.created_at <= $${params.length}`);
    }

    if (q.minFailedCount !== undefined) {
      params.push(q.minFailedCount);
      conditions.push(`sls.consecutive_failed_count >= $${params.length}`);
    }

    if (conditions.length > 0) {
      baseQuery += ` WHERE ${conditions.join(" AND ")}`;
    }

    const sortDir = q.sortDir === "asc" ? "ASC" : "DESC";
    baseQuery += ` ORDER BY e.created_at ${sortDir}`;

    const offset = (q.page - 1) * q.pageSize;
    params.push(q.pageSize);
    baseQuery += ` LIMIT $${params.length}`;
    params.push(offset);
    baseQuery += ` OFFSET $${params.length}`;

    const result = await pool.query<{
      id: string;
      realm: string;
      actor_user_id: string | null;
      identifier: string;
      success: boolean;
      failure_reason: string | null;
      device_id: string | null;
      device_name: string | null;
      ip: string | null;
      user_agent: string | null;
      created_at: string;
      total_count: string;
    }>(baseQuery, params);

    const total = result.rows.length > 0 ? Number(result.rows[0].total_count) : 0;

    const events = result.rows.map((row) => ({
      id: row.id,
      realm: row.realm,
      actorUserId: row.actor_user_id,
      identifier: row.identifier,
      success: row.success,
      failureReason: row.failure_reason,
      deviceId: row.device_id,
      deviceName: row.device_name,
      ip: row.ip,
      userAgent: row.user_agent,
      createdAt: row.created_at,
    }));

    return res.json({
      data: {
        events,
        total,
        page: q.page,
        pageSize: q.pageSize,
      },
    });
  }
);
