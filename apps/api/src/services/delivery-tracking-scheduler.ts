import { pool } from "../db/client.js";
import { env } from "../config/env.js";
import { emitEtaMilestonesTx } from "./order-notifications.js";
import { flushPushNotifications, type PushNotificationPayload } from "./push-notifications.js";

let timer: NodeJS.Timeout | null = null;

export async function triggerDeliveryTrackingSweep(): Promise<void> {
  const rows = await pool.query<{
    order_id: string;
    buyer_id: string;
    estimated_delivery_time: string;
  }>(
    `SELECT id::text AS order_id, buyer_id::text, estimated_delivery_time::text
     FROM orders
     WHERE status = 'in_delivery'
       AND delivery_type = 'delivery'
       AND estimated_delivery_time IS NOT NULL
       AND estimated_delivery_time >= now() - interval '15 minutes'`,
  );

  for (const row of rows.rows) {
    const eta = new Date(row.estimated_delivery_time);
    if (Number.isNaN(eta.getTime())) continue;
    const remainingSec = Math.max(0, Math.round((eta.getTime() - Date.now()) / 1000));

    const client = await pool.connect();
    const pushQueue: PushNotificationPayload[] = [];
    try {
      await client.query("BEGIN");
      await emitEtaMilestonesTx(
        client,
        {
          orderId: row.order_id,
          buyerId: row.buyer_id,
          remainingSeconds: remainingSec,
          routeDurationSec: null,
        },
        pushQueue,
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      const message = error instanceof Error ? error.message : String(error);
      console.error("[delivery-tracking-scheduler] milestone sweep failed", row.order_id, message);
    } finally {
      client.release();
    }

    if (pushQueue.length > 0) {
      await flushPushNotifications(pushQueue);
    }
  }
}

export function startDeliveryTrackingScheduler(): void {
  if (!env.DELIVERY_TRACKING_SCHEDULER_ENABLED) return;
  if (timer) return;

  void triggerDeliveryTrackingSweep().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[delivery-tracking-scheduler] initial run failed", message);
  });

  timer = setInterval(() => {
    void triggerDeliveryTrackingSweep().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[delivery-tracking-scheduler] run failed", message);
    });
  }, env.DELIVERY_TRACKING_SCHEDULER_INTERVAL_MS);

  timer.unref();
}

export function stopDeliveryTrackingScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
