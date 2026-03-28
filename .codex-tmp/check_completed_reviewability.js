const { Client } = require('pg');

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const buyerId = '58f0010a-5c99-4234-b7f4-09c2bb13e0b4';
  const rows = await c.query(
    `select o.id,
            o.status,
            (select count(*) from order_items oi where oi.order_id=o.id)::int as item_count,
            (select count(*) from reviews r where r.order_id=o.id)::int as review_count
     from orders o
     where o.buyer_id=$1
     order by o.created_at desc
     limit 30`,
    [buyerId]
  );

  console.log(JSON.stringify(rows.rows, null, 2));
  await c.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
