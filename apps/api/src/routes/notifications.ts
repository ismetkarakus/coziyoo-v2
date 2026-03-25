import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/client.js";
import { requireAuth } from "../middleware/auth.js";

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth("app"));

const DeviceTokenSchema = z.object({
  token: z.string().min(10).max(512),
  platform: z.enum(["ios", "android"]),
  appVersion: z.string().max(64).optional(),
});

const DeviceTokenDeleteSchema = z.object({
  token: z.string().min(10).max(512).optional(),
});

/**
 * GET /v1/notifications
 * List notifications for the authenticated user.
 */
notificationsRouter.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, type, title, body, is_read, data_json, created_at
       FROM notification_events
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [req.auth!.userId],
    );

    const notifications = rows.map((r) => ({
      id: r.id as string,
      type: r.type as string,
      title: r.title as string,
      body: r.body as string,
      isRead: r.is_read as boolean,
      dataJson: r.data_json,
      createdAt: new Date(r.created_at).toISOString(),
    }));

    res.json({ data: notifications });
  } catch (err) {
    console.error("[notifications] list error:", err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to load notifications" } });
  }
});

/**
 * PATCH /v1/notifications/:id/read
 * Mark a notification as read.
 */
notificationsRouter.patch("/:id/read", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "UPDATE notification_events SET is_read = true WHERE id = $1 AND user_id = $2 RETURNING id",
      [id, req.auth!.userId],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Notification not found" } });
    }
    res.json({ data: { id, isRead: true } });
  } catch (err) {
    console.error("[notifications] mark read error:", err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to update notification" } });
  }
});

/**
 * PUT /v1/notifications/device-token
 * Register or refresh push token for authenticated user.
 */
notificationsRouter.put("/device-token", async (req, res) => {
  const parsed = DeviceTokenSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  try {
    const input = parsed.data;
    await pool.query(
      `INSERT INTO user_device_tokens (user_id, token, platform, app_version, is_active, last_seen_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, TRUE, now(), now(), now())
       ON CONFLICT (token)
       DO UPDATE SET
         user_id = EXCLUDED.user_id,
         platform = EXCLUDED.platform,
         app_version = EXCLUDED.app_version,
         is_active = TRUE,
         last_seen_at = now(),
         updated_at = now()`,
      [req.auth!.userId, input.token.trim(), input.platform, input.appVersion ?? null],
    );
    return res.json({ data: { ok: true } });
  } catch (err) {
    console.error("[notifications] device-token put error:", err);
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to register device token" } });
  }
});

/**
 * DELETE /v1/notifications/device-token
 * Unregister push token for authenticated user. If token omitted, deactivate all user tokens.
 */
notificationsRouter.delete("/device-token", async (req, res) => {
  const parsed = DeviceTokenDeleteSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  try {
    if (parsed.data.token) {
      await pool.query(
        `UPDATE user_device_tokens
         SET is_active = FALSE, updated_at = now()
         WHERE user_id = $1 AND token = $2`,
        [req.auth!.userId, parsed.data.token.trim()],
      );
    } else {
      await pool.query(
        `UPDATE user_device_tokens
         SET is_active = FALSE, updated_at = now()
         WHERE user_id = $1`,
        [req.auth!.userId],
      );
    }
    return res.json({ data: { ok: true } });
  } catch (err) {
    console.error("[notifications] device-token delete error:", err);
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to unregister device token" } });
  }
});
