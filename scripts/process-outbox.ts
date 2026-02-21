import { pool } from "../src/db/client.js";

const BATCH_SIZE = 50;
const MAX_RETRIES = 5;

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const events = await client.query<{
      id: string;
      event_type: string;
      aggregate_type: string;
      aggregate_id: string;
      payload_json: unknown;
      attempt_count: number;
    }>(
      `SELECT id, event_type, aggregate_type, aggregate_id, payload_json, attempt_count
       FROM outbox_events
       WHERE status IN ('pending', 'failed') AND next_attempt_at <= now()
       ORDER BY created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $1`,
      [BATCH_SIZE]
    );

    for (const event of events.rows) {
      try {
        await dispatchEvent(event);
        await client.query(
          "UPDATE outbox_events SET status = 'processed', processed_at = now(), last_error = NULL WHERE id = $1",
          [event.id]
        );
      } catch (error) {
        const nextAttempt = event.attempt_count + 1;
        const message = error instanceof Error ? error.message : "dispatch error";
        if (nextAttempt >= MAX_RETRIES) {
          await client.query(
            `INSERT INTO outbox_dead_letters (outbox_event_id, event_type, aggregate_type, aggregate_id, payload_json, last_error, failed_at)
             VALUES ($1, $2, $3, $4, $5, $6, now())`,
            [event.id, event.event_type, event.aggregate_type, event.aggregate_id, JSON.stringify(event.payload_json), message]
          );
          await client.query(
            "UPDATE outbox_events SET status = 'failed', attempt_count = $2, last_error = $3 WHERE id = $1",
            [event.id, nextAttempt, message]
          );
        } else {
          const delayMinutes = Math.pow(2, nextAttempt);
          await client.query(
            `UPDATE outbox_events
             SET status = 'failed',
                 attempt_count = $2,
                 last_error = $3,
                 next_attempt_at = now() + ($4 || ' minutes')::interval
             WHERE id = $1`,
            [event.id, nextAttempt, message, String(delayMinutes)]
          );
        }
      }
    }
    await client.query("COMMIT");
    console.log(`Outbox processed. scanned=${events.rowCount ?? 0}`);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Outbox worker failed:", error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

async function dispatchEvent(event: { event_type: string }) {
  if (
    [
      "order_created",
      "payment_session_started",
      "payment_confirmed",
      "compliance_status_changed",
      "dispute_opened",
      "dispute_resolved",
      "order_completed",
      "finance_snapshot_finalized",
      "delivery_pin_sent",
      "delivery_pin_verified",
      "delivery_pin_override",
      "lot_created",
      "lot_recalled",
    ].includes(event.event_type)
  ) {
    return;
  }
  throw new Error(`Unsupported event_type: ${event.event_type}`);
}

main();
