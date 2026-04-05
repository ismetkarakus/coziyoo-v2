import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/client.js";
import { requireAuth } from "../middleware/auth.js";
import { writeAdminAudit } from "../services/admin-audit.js";
import { createNotificationEventTx, flushPushNotifications, type PushNotificationPayload } from "../services/push-notifications.js";

const SendTestNotificationSchema = z.object({
  targetUserId: z.string().uuid(),
  audience: z.enum(["buyer", "seller"]),
  title: z.string().trim().min(2).max(120),
  body: z.string().trim().min(2).max(500),
  dataJson: z.record(z.string(), z.unknown()).optional(),
});

type UserType = "buyer" | "seller" | "both";

function audienceMatchesUserType(audience: "buyer" | "seller", userType: UserType): boolean {
  if (userType === "both") return true;
  return userType === audience;
}

export const adminNotificationsRouter = Router();

adminNotificationsRouter.use(requireAuth("admin"));

adminNotificationsRouter.post("/notifications/test", async (req, res) => {
  const parsed = SendTestNotificationSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const client = await pool.connect();
  const pushQueue: PushNotificationPayload[] = [];
  let committed = false;

  try {
    await client.query("BEGIN");

    const targetUser = await client.query<{
      id: string;
      email: string;
      display_name: string;
      user_type: UserType;
    }>(
      `SELECT id::text, email, display_name, user_type
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [input.targetUserId],
    );

    if ((targetUser.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "Target user not found" } });
    }

    const target = targetUser.rows[0];
    if (!audienceMatchesUserType(input.audience, target.user_type)) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: {
          code: "USER_AUDIENCE_MISMATCH",
          message: `User role mismatch for audience=${input.audience}`,
        },
      });
    }

    const tokenStats = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM user_device_tokens
       WHERE user_id = $1
         AND is_active = TRUE`,
      [input.targetUserId],
    );
    const activeDeviceTokenCount = Number(tokenStats.rows[0]?.count ?? "0");

    const dataJson = {
      ...(input.dataJson ?? {}),
      source: "admin_test_panel",
      audience: input.audience,
      sentByAdminId: req.auth!.userId,
    };

    await createNotificationEventTx(client, {
      userId: input.targetUserId,
      type: "admin_test",
      title: input.title,
      body: input.body,
      dataJson,
    });

    pushQueue.push({
      userId: input.targetUserId,
      title: input.title,
      body: input.body,
      data: {
        type: "admin_test",
        source: "admin_test_panel",
        audience: input.audience,
      },
    });

    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "admin_test_notification_sent",
      entityType: "users",
      entityId: input.targetUserId,
      after: {
        audience: input.audience,
        title: input.title,
        body: input.body,
        activeDeviceTokenCount,
      },
    });

    await client.query("COMMIT");
    committed = true;

    if (pushQueue.length > 0) {
      try {
        await flushPushNotifications(pushQueue);
      } catch (pushError) {
        console.error("[admin-notifications] push flush failed", pushError);
      }
    }

    return res.status(201).json({
      data: {
        ok: true,
        target: {
          id: target.id,
          email: target.email,
          displayName: target.display_name,
          userType: target.user_type,
        },
        activeDeviceTokenCount,
      },
    });
  } catch (error) {
    if (!committed) {
      await client.query("ROLLBACK");
    }
    console.error("[admin-notifications] send test notification failed", error);
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to send test notification" } });
  } finally {
    client.release();
  }
});
