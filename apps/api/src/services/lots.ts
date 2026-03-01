import type { PoolClient } from "pg";

export async function recalculateFoodStockTx(client: PoolClient, foodId: string): Promise<void> {
  await client.query(
    `UPDATE foods
     SET current_stock = coalesce((
       SELECT sum(quantity_available)
       FROM production_lots
       WHERE food_id = $1 AND status = 'open'
     ), 0),
     updated_at = now()
     WHERE id = $1`,
    [foodId]
  );
}

export async function allocateLotsFefoTx(params: {
  client: PoolClient;
  orderId: string;
  sellerId: string;
}): Promise<void> {
  const { client, orderId, sellerId } = params;
  const items = await client.query<{ id: string; food_id: string; quantity: number }>(
    "SELECT id, food_id, quantity FROM order_items WHERE order_id = $1 ORDER BY created_at ASC",
    [orderId]
  );

  for (const item of items.rows) {
    let remaining = Number(item.quantity);
    const lots = await client.query<{
      id: string;
      quantity_available: number;
    }>(
      `SELECT id, quantity_available
       FROM production_lots
       WHERE seller_id = $1
         AND food_id = $2
         AND status = 'open'
         AND quantity_available > 0
       ORDER BY coalesce(use_by, best_before, produced_at) ASC, created_at ASC
       FOR UPDATE`,
      [sellerId, item.food_id]
    );

    for (const lot of lots.rows) {
      if (remaining <= 0) break;
      const alloc = Math.min(remaining, Number(lot.quantity_available));
      if (alloc <= 0) continue;

      await client.query(
        `INSERT INTO order_item_lot_allocations (order_id, order_item_id, lot_id, quantity_allocated, created_at)
         VALUES ($1, $2, $3, $4, now())`,
        [orderId, item.id, lot.id, alloc]
      );
      await client.query(
        `UPDATE production_lots
         SET quantity_available = quantity_available - $2,
             status = CASE WHEN quantity_available - $2 <= 0 THEN 'depleted' ELSE status END,
             updated_at = now()
         WHERE id = $1`,
        [lot.id, alloc]
      );
      remaining -= alloc;
    }

    if (remaining > 0) {
      throw new Error(`INSUFFICIENT_LOT_STOCK:${item.food_id}`);
    }

    await recalculateFoodStockTx(client, item.food_id);
  }
}

