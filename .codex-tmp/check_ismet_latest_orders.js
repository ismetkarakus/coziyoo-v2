const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const user = await client.query(
    `select id, email, display_name, full_name from users where id = $1`,
    ['58f0010a-5c99-4234-b7f4-09c2bb13e0b4']
  );

  const orders = await client.query(
    `select id, status, total_price, created_at
     from orders
     where buyer_id = $1
     order by created_at desc
     limit 10`,
    ['58f0010a-5c99-4234-b7f4-09c2bb13e0b4']
  );

  console.log(JSON.stringify({ user: user.rows[0], totalShown: orders.rows.length, latest: orders.rows }, null, 2));
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
