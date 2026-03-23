import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/client.js";

const QuerySchema = z.object({
  profileId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const adminAgentCallLogsRouter = Router();

adminAgentCallLogsRouter.get("/", async (req, res) => {
  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const { profileId, from, to, limit = 50, offset = 0 } = parsed.data;
  const whereParts: string[] = [];
  const params: unknown[] = [];

  if (profileId) {
    params.push(profileId);
    whereParts.push(`l.profile_id = $${params.length}`);
  }
  if (from) {
    params.push(from);
    whereParts.push(`l.started_at >= $${params.length}::timestamptz`);
  }
  if (to) {
    params.push(to);
    whereParts.push(`l.started_at <= $${params.length}::timestamptz`);
  }

  params.push(limit);
  const limitParam = `$${params.length}`;
  params.push(offset);
  const offsetParam = `$${params.length}`;

  const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

  try {
    const result = await pool.query(
      `SELECT l.id,
              l.room_name,
              l.profile_id,
              p.name AS profile_name,
              l.started_at,
              l.ended_at,
              l.duration_seconds,
              l.outcome,
              l.summary,
              l.device_id,
              l.created_at
         FROM agent_call_logs l
    LEFT JOIN agent_profiles p ON p.id = l.profile_id
        ${whereClause}
     ORDER BY l.started_at DESC
        LIMIT ${limitParam}
       OFFSET ${offsetParam}`,
      params,
    );

    return res.json({ data: result.rows });
  } catch (err) {
    return res.status(500).json({
      error: {
        code: "DB_ERROR",
        message: err instanceof Error ? err.message : "Query failed",
      },
    });
  }
});

