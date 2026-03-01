import type { PoolClient } from "pg";

type Queryable = PoolClient;

export async function enqueueOutboxEvent(
  queryable: Queryable,
  event: {
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    payload: unknown;
  }
) {
  await queryable.query(
    `INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload_json, status, attempt_count, next_attempt_at, created_at)
     VALUES ($1, $2, $3, $4, 'pending', 0, now(), now())`,
    [event.eventType, event.aggregateType, event.aggregateId, JSON.stringify(event.payload)]
  );
}

