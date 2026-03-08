import type { PoolClient } from "pg";
import { appendSellerLedgerEntryTx } from "./payouts.js";

export async function getActiveCommissionRate(client: PoolClient): Promise<number> {
  const result = await client.query<{ commission_rate: string }>(
    `SELECT commission_rate::text
     FROM commission_settings
     WHERE is_active = TRUE AND effective_from <= now()
     ORDER BY effective_from DESC, created_at DESC
     LIMIT 1`
  );
  if ((result.rowCount ?? 0) === 0) {
    return 0.1;
  }
  return Number(result.rows[0].commission_rate);
}

export async function finalizeOrderFinanceTx(params: {
  client: PoolClient;
  orderId: string;
  sellerId: string;
  grossAmount: number;
}): Promise<void> {
  const { client, orderId, sellerId, grossAmount } = params;
  const commissionRate = await getActiveCommissionRate(client);
  const commissionAmount = Number((grossAmount * commissionRate).toFixed(2));
  const sellerNetAmount = Number((grossAmount - commissionAmount).toFixed(2));

  await client.query(
    `INSERT INTO order_finance (order_id, seller_id, gross_amount, commission_rate_snapshot, commission_amount, seller_net_amount, finalized_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (order_id) DO NOTHING`,
    [orderId, sellerId, grossAmount, commissionRate, commissionAmount, sellerNetAmount]
  );

  await appendSellerLedgerEntryTx({
    client,
    sellerId,
    orderId,
    sourceType: "order_finance",
    sourceId: orderId,
    amount: sellerNetAmount,
  });
}

export async function createFinanceAdjustmentTx(params: {
  client: PoolClient;
  orderId: string;
  sellerId: string;
  disputeCaseId?: string | null;
  type: string;
  amount: number;
  reason?: string | null;
}): Promise<{ adjustmentId: string }> {
  const { client, orderId, sellerId, disputeCaseId = null, type, amount, reason = null } = params;

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO finance_adjustments (order_id, seller_id, dispute_case_id, type, amount, reason, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     RETURNING id`,
    [orderId, sellerId, disputeCaseId, type, Number(amount.toFixed(2)), reason]
  );

  const adjustmentId = inserted.rows[0].id;
  await appendSellerLedgerEntryTx({
    client,
    sellerId,
    orderId,
    sourceType: "finance_adjustment",
    sourceId: adjustmentId,
    amount,
  });

  return { adjustmentId };
}
