import { pool } from "../db/client.js";

type PresenceSubjectType = "app_user" | "admin_user";
type PresenceEventType = "login" | "refresh" | "logout";

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<unknown>;
};

export async function recordPresenceEvent(
  input: {
    subjectType: PresenceSubjectType;
    subjectId: string;
    sessionId?: string | null;
    eventType: PresenceEventType;
    ip?: string | null;
    userAgent?: string | null;
  },
  db: Queryable = pool
) {
  await db.query(
    `WITH inserted AS (
       INSERT INTO user_presence_events (subject_type, subject_id, session_id, event_type, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id
     )
     DELETE FROM user_presence_events
     WHERE happened_at < (now() - interval '30 days')`,
    [
      input.subjectType,
      input.subjectId,
      input.sessionId ?? null,
      input.eventType,
      input.ip ?? null,
      input.userAgent ?? null,
    ]
  );
}
