import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "../db/client.js";

export type PayoutBatchStatus = "pending" | "processing" | "paid" | "failed";

const DEFAULT_CURRENCY = "TRY";

function utcDateString(input: Date): string {
  return input.toISOString().slice(0, 10);
}

function toMoney(value: number): number {
  return Number(value.toFixed(2));
}

export async function appendSellerLedgerEntryTx(params: {
  client: PoolClient;
  sellerId: string;
  orderId?: string | null;
  sourceType: "order_finance" | "finance_adjustment" | "payout_debit" | "payout_reversal";
  sourceId: string;
  amount: number;
  currency?: string;
  occurredAt?: string;
}): Promise<void> {
  const { client, sellerId, orderId = null, sourceType, sourceId, amount, currency = DEFAULT_CURRENCY, occurredAt } = params;
  await client.query(
    `INSERT INTO seller_ledger_entries (seller_id, order_id, source_type, source_id, amount, currency, occurred_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, coalesce($7::timestamptz, now()), now())
     ON CONFLICT (source_type, source_id) DO NOTHING`,
    [sellerId, orderId, sourceType, sourceId, toMoney(amount), currency, occurredAt ?? null]
  );
}

export async function backfillSellerLedgerTx(client: PoolClient): Promise<void> {
  await client.query(
    `INSERT INTO seller_ledger_entries (seller_id, order_id, source_type, source_id, amount, currency, occurred_at, created_at)
     SELECT ofn.seller_id, ofn.order_id, 'order_finance', ofn.order_id::text, ofn.seller_net_amount, $1, ofn.finalized_at, now()
     FROM order_finance ofn
     WHERE NOT EXISTS (
       SELECT 1 FROM seller_ledger_entries sle
       WHERE sle.source_type = 'order_finance' AND sle.source_id = ofn.order_id::text
     )`,
    [DEFAULT_CURRENCY]
  );

  await client.query(
    `INSERT INTO seller_ledger_entries (seller_id, order_id, source_type, source_id, amount, currency, occurred_at, created_at)
     SELECT fa.seller_id, fa.order_id, 'finance_adjustment', fa.id::text, fa.amount, $1, fa.created_at, now()
     FROM finance_adjustments fa
     WHERE NOT EXISTS (
       SELECT 1 FROM seller_ledger_entries sle
       WHERE sle.source_type = 'finance_adjustment' AND sle.source_id = fa.id::text
     )`,
    [DEFAULT_CURRENCY]
  );
}

export async function getSellerBalance(sellerId: string): Promise<{
  sellerId: string;
  currency: string;
  availableBalance: number;
  pendingPayoutBalance: number;
  paidOutTotal: number;
  ledgerBalance: number;
}> {
  const result = await pool.query<{
    ledger_balance: string;
    pending_balance: string;
    paid_total: string;
  }>(
    `SELECT
      coalesce((SELECT sum(amount) FROM seller_ledger_entries WHERE seller_id = $1), 0)::text AS ledger_balance,
      coalesce((SELECT sum(total_amount) FROM seller_payout_batches WHERE seller_id = $1 AND status IN ('pending', 'processing')), 0)::text AS pending_balance,
      coalesce((SELECT sum(total_amount) FROM seller_payout_batches WHERE seller_id = $1 AND status = 'paid'), 0)::text AS paid_total`,
    [sellerId]
  );

  const ledgerBalance = Number(result.rows[0].ledger_balance);
  const pendingPayoutBalance = Number(result.rows[0].pending_balance);
  const paidOutTotal = Number(result.rows[0].paid_total);
  return {
    sellerId,
    currency: DEFAULT_CURRENCY,
    availableBalance: toMoney(ledgerBalance - pendingPayoutBalance),
    pendingPayoutBalance: toMoney(pendingPayoutBalance),
    paidOutTotal: toMoney(paidOutTotal),
    ledgerBalance: toMoney(ledgerBalance),
  };
}

async function acquirePayoutGenerationLock(client: PoolClient): Promise<boolean> {
  const lockResult = await client.query<{ acquired: boolean }>(
    "SELECT pg_try_advisory_xact_lock(hashtext('seller_payout_daily_generation')) AS acquired"
  );
  return lockResult.rows[0]?.acquired === true;
}

async function createDailyBatchForSellerTx(params: {
  client: PoolClient;
  sellerId: string;
  payoutDate: string;
  batchKey: string;
}): Promise<{ batchId: string; totalAmount: number } | null> {
  const { client, sellerId, payoutDate, batchKey } = params;

  const activeExists = await client.query<{ id: string }>(
    `SELECT id
     FROM seller_payout_batches
     WHERE seller_id = $1
       AND payout_date = $2::date
       AND status IN ('pending', 'processing', 'paid')
     LIMIT 1`,
    [sellerId, payoutDate]
  );
  if ((activeExists.rowCount ?? 0) > 0) return null;

  const entries = await client.query<{ id: string; amount: string }>(
    `SELECT sle.id, sle.amount::text
     FROM seller_ledger_entries sle
     WHERE sle.seller_id = $1
       AND sle.source_type <> 'payout_debit'
       AND NOT EXISTS (
         SELECT 1
         FROM seller_payout_items spi
         JOIN seller_payout_batches spb ON spb.id = spi.batch_id
         WHERE spi.ledger_entry_id = sle.id
           AND spb.status IN ('pending', 'processing', 'paid')
       )
     ORDER BY sle.occurred_at ASC, sle.id ASC
     FOR UPDATE`,
    [sellerId]
  );

  if ((entries.rowCount ?? 0) === 0) return null;

  const totalAmount = toMoney(entries.rows.reduce((sum, row) => sum + Number(row.amount), 0));
  if (totalAmount <= 0) return null;

  const insertedBatch = await client.query<{ id: string }>(
    `INSERT INTO seller_payout_batches
       (seller_id, payout_date, batch_key, currency, total_amount, status, created_at, updated_at)
     VALUES ($1, $2::date, $3, $4, $5, 'pending', now(), now())
     ON CONFLICT (batch_key) DO NOTHING
     RETURNING id`,
    [sellerId, payoutDate, batchKey, DEFAULT_CURRENCY, totalAmount]
  );
  if ((insertedBatch.rowCount ?? 0) === 0) return null;

  const batchId = insertedBatch.rows[0].id;
  for (const row of entries.rows) {
    await client.query(
      `INSERT INTO seller_payout_items (batch_id, ledger_entry_id, amount, created_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (batch_id, ledger_entry_id) DO NOTHING`,
      [batchId, row.id, Number(row.amount)]
    );
  }

  const transferReference = `mocktr_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  await client.query(
    `UPDATE seller_payout_batches
     SET status = 'processing', transfer_reference = $2, updated_at = now()
     WHERE id = $1`,
    [batchId, transferReference]
  );

  return { batchId, totalAmount };
}

export async function generateDailyPayoutBatches(params?: {
  payoutDate?: string;
}): Promise<{ payoutDate: string; createdBatchCount: number; createdTotalAmount: number; skippedSellers: number }> {
  const now = new Date();
  const payoutDate = params?.payoutDate ?? utcDateString(now);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lockAcquired = await acquirePayoutGenerationLock(client);
    if (!lockAcquired) {
      await client.query("ROLLBACK");
      return { payoutDate, createdBatchCount: 0, createdTotalAmount: 0, skippedSellers: 0 };
    }

    await backfillSellerLedgerTx(client);

    const sellers = await client.query<{ seller_id: string }>(
      `SELECT seller_id
       FROM seller_bank_accounts
       WHERE is_active = TRUE
         AND verification_status = 'verified'
         AND payout_hold = FALSE`
    );

    let createdBatchCount = 0;
    let createdTotalAmount = 0;
    let skippedSellers = 0;

    for (const row of sellers.rows) {
      const batch = await createDailyBatchForSellerTx({
        client,
        sellerId: row.seller_id,
        payoutDate,
        batchKey: `daily:${payoutDate}:${row.seller_id}`,
      });
      if (!batch) {
        skippedSellers += 1;
        continue;
      }
      createdBatchCount += 1;
      createdTotalAmount = toMoney(createdTotalAmount + batch.totalAmount);
    }

    await client.query("COMMIT");
    return { payoutDate, createdBatchCount, createdTotalAmount, skippedSellers };
  } catch {
    await client.query("ROLLBACK");
    throw new Error("Daily payout generation failed");
  } finally {
    client.release();
  }
}

export async function markPayoutBatchPaid(params: { batchId: string; providerPayload?: Record<string, unknown> | null }): Promise<void> {
  const { batchId, providerPayload = null } = params;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const batch = await client.query<{ id: string; seller_id: string; total_amount: string; status: PayoutBatchStatus }>(
      `SELECT id, seller_id, total_amount::text, status
       FROM seller_payout_batches
       WHERE id = $1
       FOR UPDATE`,
      [batchId]
    );
    if ((batch.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      throw new Error("Payout batch not found");
    }

    const row = batch.rows[0];
    if (row.status === "paid") {
      await client.query("COMMIT");
      return;
    }
    if (row.status === "failed") {
      await client.query("ROLLBACK");
      throw new Error("Cannot mark failed batch as paid directly; use retry");
    }

    await client.query(
      `UPDATE seller_payout_batches
       SET status = 'paid',
           paid_at = now(),
           provider_response_json = coalesce(provider_response_json, '{}'::jsonb) || coalesce($2::jsonb, '{}'::jsonb),
           updated_at = now()
       WHERE id = $1`,
      [batchId, providerPayload ? JSON.stringify(providerPayload) : null]
    );

    await appendSellerLedgerEntryTx({
      client,
      sellerId: row.seller_id,
      sourceType: "payout_debit",
      sourceId: batchId,
      amount: -Number(row.total_amount),
      currency: DEFAULT_CURRENCY,
    });

    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK");
    throw new Error("Mark payout batch paid failed");
  } finally {
    client.release();
  }
}

export async function markPayoutBatchFailed(params: {
  batchId: string;
  failureReason: string;
  providerPayload?: Record<string, unknown> | null;
}): Promise<void> {
  const { batchId, failureReason, providerPayload = null } = params;

  const result = await pool.query(
    `UPDATE seller_payout_batches
     SET status = 'failed',
         failure_reason = $2,
         provider_response_json = coalesce(provider_response_json, '{}'::jsonb) || coalesce($3::jsonb, '{}'::jsonb),
         updated_at = now()
     WHERE id = $1
       AND status IN ('pending', 'processing')`,
    [batchId, failureReason, providerPayload ? JSON.stringify(providerPayload) : null]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new Error("Payout batch not found or cannot be failed");
  }
}

export async function retryFailedPayoutBatch(batchId: string): Promise<{ newBatchId: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const batch = await client.query<{ seller_id: string; status: PayoutBatchStatus }>(
      `SELECT seller_id, status
       FROM seller_payout_batches
       WHERE id = $1
       FOR UPDATE`,
      [batchId]
    );
    if ((batch.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      throw new Error("Payout batch not found");
    }
    if (batch.rows[0].status !== "failed") {
      await client.query("ROLLBACK");
      throw new Error("Only failed payout batches can be retried");
    }

    const payoutDate = utcDateString(new Date());
    const recreated = await createDailyBatchForSellerTx({
      client,
      sellerId: batch.rows[0].seller_id,
      payoutDate,
      batchKey: `retry:${batchId}`,
    });

    if (!recreated) {
      await client.query("ROLLBACK");
      throw new Error("No available ledger entries for retry");
    }

    await client.query("COMMIT");
    return { newBatchId: recreated.batchId };
  } catch {
    await client.query("ROLLBACK");
    throw new Error("Retry payout failed");
  } finally {
    client.release();
  }
}

export async function setSellerPayoutHold(params: { sellerId: string; hold: boolean; reason?: string | null }): Promise<void> {
  const { sellerId, hold, reason = null } = params;
  await pool.query(
    `UPDATE seller_bank_accounts
     SET payout_hold = $2,
         last_error = CASE WHEN $2 = TRUE THEN coalesce($3, last_error) ELSE NULL END,
         updated_at = now()
     WHERE seller_id = $1`,
    [sellerId, hold, reason]
  );
}
