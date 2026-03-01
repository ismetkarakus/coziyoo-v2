import type { PoolClient } from "pg";

type AuditInput = {
  actorAdminId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
};

export async function writeAdminAudit(client: PoolClient, input: AuditInput): Promise<void> {
  const admin = await client.query<{ email: string; role: string }>(
    "SELECT email, role FROM admin_users WHERE id = $1 LIMIT 1",
    [input.actorAdminId]
  );

  const actor = admin.rows[0];
  await client.query(
    `INSERT INTO admin_audit_logs (actor_admin_id, actor_email, actor_role, action, entity_type, entity_id, before_json, after_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.actorAdminId,
      actor?.email ?? "unknown",
      actor?.role ?? "admin",
      input.action,
      input.entityType,
      input.entityId ?? null,
      input.before ? JSON.stringify(input.before) : null,
      input.after ? JSON.stringify(input.after) : null,
    ]
  );
}
