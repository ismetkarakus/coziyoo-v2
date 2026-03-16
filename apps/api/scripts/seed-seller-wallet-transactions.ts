#!/usr/bin/env tsx

import { pool } from "../src/db/client.js";

type Args = {
  sellerId?: string;
  sellerName?: string;
  limit: number;
};

function parseArgs(argv: string[]): Args {
  const out: Args = { limit: 8 };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--seller-id") out.sellerId = argv[index + 1];
    if (item === "--seller-name") out.sellerName = argv[index + 1];
    if (item === "--limit") out.limit = Number(argv[index + 1] ?? "8");
  }
  return out;
}

async function resolveSeller(input: Args): Promise<{ id: string; displayName: string | null; email: string } | null> {
  if (input.sellerId) {
    const byId = await pool.query<{ id: string; display_name: string | null; email: string }>(
      `SELECT id::text, display_name, email
       FROM users
       WHERE id = $1::uuid
         AND user_type IN ('seller', 'both')
       LIMIT 1`,
      [input.sellerId]
    );
    return byId.rows[0] ?? null;
  }

  if (input.sellerName && input.sellerName.trim()) {
    const needle = `%${input.sellerName.trim().toLowerCase()}%`;
    const byName = await pool.query<{ id: string; display_name: string | null; email: string }>(
      `SELECT id::text, display_name, email
       FROM users
       WHERE user_type IN ('seller', 'both')
         AND (lower(coalesce(display_name, '')) LIKE $1 OR lower(email) LIKE $1)
       ORDER BY updated_at DESC
       LIMIT 1`,
      [needle]
    );
    return byName.rows[0] ?? null;
  }

  const latest = await pool.query<{ id: string; display_name: string | null; email: string }>(
    `SELECT id::text, display_name, email
     FROM users
     WHERE user_type IN ('seller', 'both')
     ORDER BY updated_at DESC
     LIMIT 1`
  );
  return latest.rows[0] ?? null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const seller = await resolveSeller(args);
    if (!seller) {
      console.error("Satıcı bulunamadı.");
      process.exit(1);
      return;
    }

    const orders = await pool.query<{
      id: string;
      buyer_id: string;
      created_at: string;
    }>(
      `SELECT id::text, buyer_id::text, created_at::text
       FROM orders
       WHERE seller_id = $1::uuid
         AND payment_completed = TRUE
       ORDER BY created_at DESC
       LIMIT $2`,
      [seller.id, Math.max(1, args.limit)]
    );

    if (orders.rowCount === 0) {
      console.error("Bu satıcı için ödeme tamamlanmış sipariş bulunamadı.");
      process.exit(1);
      return;
    }

    let inserted = 0;
    const seeded: Array<{ orderId: string; referenceId: string; sessionId: string }> = [];
    for (const [index, row] of orders.rows.entries()) {
      const shortId = row.id.slice(0, 8);
      const referenceId = `seed-ref-${shortId}-wallet-${String(index + 1).padStart(2, "0")}`;
      const sessionId = `seed-session-${shortId}-wallet-${String(index + 1).padStart(2, "0")}`;

      await pool.query(
        `INSERT INTO payment_attempts (
          order_id,
          buyer_id,
          provider,
          provider_session_id,
          provider_reference_id,
          status,
          callback_payload_json,
          signature_valid,
          created_at,
          updated_at
        ) VALUES (
          $1::uuid,
          $2::uuid,
          'seedpay',
          $3,
          $4,
          'succeeded',
          $5::jsonb,
          TRUE,
          now(),
          now()
        )
        ON CONFLICT (provider_reference_id)
        DO UPDATE SET
          order_id = EXCLUDED.order_id,
          buyer_id = EXCLUDED.buyer_id,
          provider_session_id = EXCLUDED.provider_session_id,
          status = EXCLUDED.status,
          callback_payload_json = EXCLUDED.callback_payload_json,
          signature_valid = EXCLUDED.signature_valid,
          updated_at = now()`,
        [
          row.id,
          row.buyer_id,
          sessionId,
          referenceId,
          JSON.stringify({ source: "seed-seller-wallet-transactions", orderId: row.id }),
        ]
      );

      inserted += 1;
      seeded.push({ orderId: row.id, referenceId, sessionId });
    }

    console.log(`Satıcı: ${seller.displayName ?? seller.email} (${seller.id})`);
    console.log(`Seeded payment_attempts: ${inserted}`);
    for (const item of seeded) {
      console.log(`${item.orderId} | ${item.referenceId} | ${item.sessionId}`);
    }
  } catch (error) {
    console.error("Seed işlemi başarısız:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

void main();
