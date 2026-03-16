#!/usr/bin/env tsx

import { pool } from "../src/db/client.js";

type Args = {
  sellerId?: string;
  sellerName?: string;
  allSellers: boolean;
  missingOnly: boolean;
  limit: number;
};

function parseArgs(argv: string[]): Args {
  const out: Args = { allSellers: false, missingOnly: true, limit: 8 };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--seller-id") out.sellerId = argv[index + 1];
    if (item === "--seller-name") out.sellerName = argv[index + 1];
    if (item === "--limit") out.limit = Number(argv[index + 1] ?? "8");
    if (item === "--all-sellers") out.allSellers = true;
    if (item === "--include-existing") out.missingOnly = false;
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
    let sellerRows: Array<{ id: string; display_name: string | null; email: string }> = [];
    if (args.allSellers) {
      const sellers = await pool.query<{ id: string; display_name: string | null; email: string }>(
        `SELECT id::text, display_name, email
         FROM users
         WHERE user_type IN ('seller', 'both')
         ORDER BY updated_at DESC`
      );
      sellerRows = sellers.rows;
    } else {
      const seller = await resolveSeller(args);
      if (seller) {
        sellerRows = [{ id: seller.id, display_name: seller.displayName, email: seller.email }];
      }
    }

    if (sellerRows.length === 0) {
      console.error("Satıcı bulunamadı.");
      process.exit(1);
      return;
    }

    let upserted = 0;
    const seeded: Array<{ orderId: string; referenceId: string; sessionId: string }> = [];
    for (const seller of sellerRows) {
      const orders = await pool.query<{
        id: string;
        buyer_id: string;
        created_at: string;
        existing_reference_id: string | null;
        existing_session_id: string | null;
      }>(
        `SELECT
           o.id::text,
           o.buyer_id::text,
           o.created_at::text,
           pa.provider_reference_id AS existing_reference_id,
           pa.provider_session_id AS existing_session_id
         FROM orders o
         LEFT JOIN LATERAL (
           SELECT provider_reference_id, provider_session_id
           FROM payment_attempts
           WHERE order_id = o.id
           ORDER BY updated_at DESC NULLS LAST, created_at DESC
           LIMIT 1
         ) pa ON TRUE
         WHERE o.seller_id = $1::uuid
           AND o.payment_completed = TRUE
         ORDER BY o.created_at DESC
         LIMIT $2`,
        [seller.id, Math.max(1, args.limit)]
      );

      for (const [index, row] of orders.rows.entries()) {
        if (
          args.missingOnly
          && String(row.existing_reference_id ?? "").trim()
          && String(row.existing_session_id ?? "").trim()
        ) {
          continue;
        }

        const orderShort = row.id.slice(0, 8);
        const sellerShort = seller.id.slice(0, 8);
        const referenceId = String(row.existing_reference_id ?? "").trim() || `seed-ref-${sellerShort}-${orderShort}-${String(index + 1).padStart(2, "0")}`;
        const sessionId = String(row.existing_session_id ?? "").trim() || `seed-session-${sellerShort}-${orderShort}-${String(index + 1).padStart(2, "0")}`;

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
            JSON.stringify({ source: "seed-seller-wallet-transactions", sellerId: seller.id, orderId: row.id }),
          ]
        );

        upserted += 1;
        seeded.push({ orderId: row.id, referenceId, sessionId });
      }
    }

    console.log(`Satıcı sayısı: ${sellerRows.length}`);
    console.log(`Upsert edilen payment_attempts: ${upserted}`);
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
