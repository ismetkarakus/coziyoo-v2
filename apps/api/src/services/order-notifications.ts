import { pool } from "../db/client.js";
import { createNotificationEventTx, type PushNotificationPayload } from "./push-notifications.js";

type Queryable = { query: typeof pool.query };

type MilestoneType =
  | "order_received"
  | "order_preparing"
  | "order_in_delivery"
  | "order_halfway"
  | "eta_10m"
  | "eta_5m"
  | "eta_2m"
  | "at_door"
  | "profile_long";

type PgLikeError = { code?: string; message?: string };

function isIgnorableNotificationInfraError(err: unknown): boolean {
  const e = err as PgLikeError;
  return ["42P01", "42703", "42883", "3F000"].includes(String(e?.code ?? ""));
}

function milestoneMessage(milestone: Exclude<MilestoneType, "profile_long">): { title: string; body: string } {
  switch (milestone) {
    case "order_received":
      return { title: "Sipariş Alındı", body: "Siparişin alındı. Usta onayı sonrası hazırlık başlayacak." };
    case "order_preparing":
      return { title: "Sipariş Hazırlanıyor", body: "Siparişin hazırlanıyor. Çok az kaldı." };
    case "order_in_delivery":
      return { title: "Sipariş Yola Çıktı", body: "Siparişin yola çıktı. Canlı süre güncelleniyor." };
    case "order_halfway":
      return { title: "Sipariş Yarı Yolda", body: "Siparişin yarı yolu geçti. Çok yakında sende." };
    case "eta_10m":
      return { title: "10 Dakika Kaldı", body: "Siparişin yaklaşık 10 dakika içinde sende." };
    case "eta_5m":
      return { title: "5 Dakika Kaldı", body: "Siparişin çok yaklaştı. 5 dakika içinde kapında." };
    case "eta_2m":
      return { title: "2 Dakika Kaldı", body: "Siparişin 2 dakika içinde kapında." };
    case "at_door":
      return { title: "Sipariş Kapında", body: "Siparişin kapında, teslim alabilirsin." };
  }
}

export async function emitOrderMilestoneTx(
  queryable: Queryable,
  input: {
    orderId: string;
    buyerId: string;
    milestone: Exclude<MilestoneType, "profile_long">;
  },
  pushQueue: PushNotificationPayload[],
): Promise<boolean> {
  try {
    const milestoneInsert = await queryable.query<{ id: string }>(
      `INSERT INTO order_notification_milestones (order_id, milestone_type, sent_at, created_at)
       VALUES ($1, $2, now(), now())
       ON CONFLICT (order_id, milestone_type) DO NOTHING
       RETURNING id::text`,
      [input.orderId, input.milestone],
    );

    if (milestoneInsert.rowCount === 0) return false;

    const msg = milestoneMessage(input.milestone);
    await createNotificationEventTx(queryable, {
      userId: input.buyerId,
      type: input.milestone,
      title: msg.title,
      body: msg.body,
      dataJson: { orderId: input.orderId, milestone: input.milestone },
    });

    pushQueue.push({
      userId: input.buyerId,
      title: msg.title,
      body: msg.body,
      data: { orderId: input.orderId, type: "order_update", milestone: input.milestone },
    });
    return true;
  } catch (err) {
    if (isIgnorableNotificationInfraError(err)) {
      console.warn("[order-notifications] milestone skipped due to missing notification infra");
      return false;
    }
    throw err;
  }
}

export async function markLongProfileIfNeededTx(
  queryable: Queryable,
  input: { orderId: string; routeDurationSec: number | null },
): Promise<boolean> {
  if (input.routeDurationSec === null || input.routeDurationSec < 12 * 60) return false;
  try {
    const inserted = await queryable.query<{ id: string }>(
      `INSERT INTO order_notification_milestones (order_id, milestone_type, sent_at, created_at)
       VALUES ($1, 'profile_long', now(), now())
       ON CONFLICT (order_id, milestone_type) DO NOTHING
       RETURNING id::text`,
      [input.orderId],
    );
    return (inserted.rowCount ?? 0) > 0;
  } catch (err) {
    if (isIgnorableNotificationInfraError(err)) {
      console.warn("[order-notifications] profile_long skipped due to missing notification infra");
      return false;
    }
    throw err;
  }
}

async function isLongProfileOrderTx(queryable: Queryable, orderId: string): Promise<boolean> {
  try {
    const row = await queryable.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1
         FROM order_notification_milestones
         WHERE order_id = $1
           AND milestone_type = 'profile_long'
       ) AS exists`,
      [orderId],
    );
    return Boolean(row.rows[0]?.exists);
  } catch (err) {
    if (isIgnorableNotificationInfraError(err)) {
      return false;
    }
    throw err;
  }
}

export async function emitEtaMilestonesTx(
  queryable: Queryable,
  input: {
    orderId: string;
    buyerId: string;
    remainingSeconds: number;
    routeDurationSec: number | null;
  },
  pushQueue: PushNotificationPayload[],
): Promise<void> {
  await markLongProfileIfNeededTx(queryable, { orderId: input.orderId, routeDurationSec: input.routeDurationSec });
  const isLongProfile = await isLongProfileOrderTx(queryable, input.orderId);

  if (input.routeDurationSec !== null && input.routeDurationSec > 0) {
    const halfwayThreshold = Math.ceil(input.routeDurationSec * 0.5);
    if (input.remainingSeconds <= halfwayThreshold) {
      await emitOrderMilestoneTx(
        queryable,
        { orderId: input.orderId, buyerId: input.buyerId, milestone: "order_halfway" },
        pushQueue,
      );
    }
  }

  const milestones: Array<{ milestone: Exclude<MilestoneType, "profile_long">; thresholdSeconds: number }> = [];
  if (isLongProfile) milestones.push({ milestone: "eta_10m", thresholdSeconds: 10 * 60 });
  milestones.push({ milestone: "eta_5m", thresholdSeconds: 5 * 60 });
  milestones.push({ milestone: "eta_2m", thresholdSeconds: 2 * 60 });
  milestones.push({ milestone: "at_door", thresholdSeconds: 60 });

  for (const item of milestones) {
    if (input.remainingSeconds <= item.thresholdSeconds) {
      await emitOrderMilestoneTx(
        queryable,
        { orderId: input.orderId, buyerId: input.buyerId, milestone: item.milestone },
        pushQueue,
      );
    }
  }
}
