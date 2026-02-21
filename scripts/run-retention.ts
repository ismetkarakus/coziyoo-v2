import { pool } from "../src/db/client.js";

const RETENTION_DAYS = 730;
const DRY_RUN = process.env.RETENTION_DRY_RUN !== "false";

type Target = {
  table: string;
  idColumn: string;
  entityType: string;
  timeColumn: string;
};

const targets: Target[] = [
  { table: "payment_attempts", idColumn: "id", entityType: "payment_attempts", timeColumn: "created_at" },
  { table: "payment_dispute_cases", idColumn: "id", entityType: "payment_dispute_cases", timeColumn: "created_at" },
  { table: "allergen_disclosure_records", idColumn: "id", entityType: "allergen_disclosure_records", timeColumn: "created_at" },
  { table: "seller_compliance_documents", idColumn: "id", entityType: "seller_compliance_documents", timeColumn: "uploaded_at" },
  { table: "seller_compliance_events", idColumn: "id", entityType: "seller_compliance_events", timeColumn: "created_at" },
  { table: "lot_events", idColumn: "id", entityType: "lot_events", timeColumn: "created_at" },
  { table: "production_lots", idColumn: "id", entityType: "production_lots", timeColumn: "created_at" },
  { table: "order_item_lot_allocations", idColumn: "id", entityType: "order_item_lot_allocations", timeColumn: "created_at" },
  { table: "delivery_proof_records", idColumn: "id", entityType: "delivery_proof_records", timeColumn: "created_at" },
];

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const summary: Array<{ table: string; candidates: number; deleted: number }> = [];

    for (const target of targets) {
      const candidateCount = await client.query<{ c: string }>(
        `SELECT count(*)::text AS c
         FROM ${target.table} t
         WHERE t.${target.timeColumn} < now() - ($1 || ' days')::interval
           AND NOT EXISTS (
             SELECT 1 FROM legal_holds lh
             WHERE lh.entity_type = $2 AND lh.entity_id = t.${target.idColumn} AND lh.active = TRUE
           )`,
        [String(RETENTION_DAYS), target.entityType]
      );
      const candidates = Number(candidateCount.rows[0].c);
      let deleted = 0;

      if (!DRY_RUN && candidates > 0) {
        const del = await client.query<{ c: string }>(
          `WITH doomed AS (
             SELECT t.${target.idColumn}
             FROM ${target.table} t
             WHERE t.${target.timeColumn} < now() - ($1 || ' days')::interval
               AND NOT EXISTS (
                 SELECT 1 FROM legal_holds lh
                 WHERE lh.entity_type = $2 AND lh.entity_id = t.${target.idColumn} AND lh.active = TRUE
               )
           )
           DELETE FROM ${target.table} d
           USING doomed
           WHERE d.${target.idColumn} = doomed.${target.idColumn}
           RETURNING 1`,
          [String(RETENTION_DAYS), target.entityType]
        );
        deleted = del.rowCount ?? 0;
      }

      summary.push({ table: target.table, candidates, deleted });
    }

    if (DRY_RUN) {
      await client.query("ROLLBACK");
    } else {
      await client.query("COMMIT");
    }

    console.log(`Retention job completed. dryRun=${DRY_RUN} retentionDays=${RETENTION_DAYS}`);
    for (const row of summary) {
      console.log(`${row.table}: candidates=${row.candidates} deleted=${row.deleted}`);
    }
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Retention job failed:", error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();

