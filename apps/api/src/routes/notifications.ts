import { Router } from "express";
import { pool } from "../db/client.js";
import { requireAuth } from "../middleware/auth.js";

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth("app"));

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
