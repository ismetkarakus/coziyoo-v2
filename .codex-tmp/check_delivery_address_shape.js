const { Client } = require('pg');

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const userId = '58f0010a-5c99-4234-b7f4-09c2bb13e0b4';
  const orders = await c.query(
    `select id, status, delivery_type, delivery_address_json, created_at
     from orders
     where buyer_id=$1
     order by created_at desc
     limit 12`,
    [userId]
  );

  console.log(JSON.stringify(orders.rows, null, 2));
  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
