import { pool } from "../db/client.js";
import { env } from "../config/env.js";

export type PushPlatform = "ios" | "android";

export type PushNotificationPayload = {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

type Queryable = {
  query: typeof pool.query;
};

export async function createNotificationEventTx(
  queryable: Queryable,
  input: {
    userId: string;
    type: string;
    title: string;
    body: string;
    dataJson?: Record<string, unknown> | null;
  },
): Promise<void> {
  await queryable.query(
    `INSERT INTO notification_events (user_id, type, title, body, data_json, is_read, created_at)
     VALUES ($1, $2, $3, $4, $5, FALSE, now())`,
    [input.userId, input.type, input.title, input.body, input.dataJson ?? null],
  );
}

function isExpoPushToken(token: string): boolean {
  return /^ExponentPushToken\[[^\]]+\]$/.test(token) || /^ExpoPushToken\[[^\]]+\]$/.test(token);
}

export async function flushPushNotifications(payloads: PushNotificationPayload[]): Promise<void> {
  if (payloads.length === 0) return;

  const uniqueUserIds = Array.from(new Set(payloads.map((p) => p.userId)));
  const tokenRows = await pool.query<{ user_id: string; token: string }>(
    `SELECT user_id::text, token
     FROM user_device_tokens
     WHERE is_active = TRUE
       AND user_id = ANY($1::uuid[])`,
    [uniqueUserIds],
  );

  if (tokenRows.rowCount === 0) return;

  const tokenByUser = new Map<string, string[]>();
  for (const row of tokenRows.rows) {
    const token = String(row.token ?? "").trim();
    if (!isExpoPushToken(token)) continue;
    const list = tokenByUser.get(row.user_id) ?? [];
    list.push(token);
    tokenByUser.set(row.user_id, list);
  }

  const messages: Array<Record<string, unknown>> = [];
  for (const payload of payloads) {
    const tokens = tokenByUser.get(payload.userId) ?? [];
    for (const token of tokens) {
      messages.push({
        to: token,
        sound: "default",
        title: payload.title,
        body: payload.body,
        data: payload.data ?? {},
      });
    }
  }

  if (messages.length === 0) return;

  const chunkSize = 100;
  for (let i = 0; i < messages.length; i += chunkSize) {
    const chunk = messages.slice(i, i + chunkSize);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (env.EXPO_PUSH_ACCESS_TOKEN) {
        headers.Authorization = `Bearer ${env.EXPO_PUSH_ACCESS_TOKEN}`;
      }
      const response = await fetch(env.EXPO_PUSH_API_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(chunk),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error("[push] expo send failed", response.status, text.slice(0, 300));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[push] expo send error", message);
    }
  }
}
