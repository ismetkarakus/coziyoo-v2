const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const users = await client.query(
    `select id, email, display_name, full_name, user_type, created_at
     from users
     where lower(display_name) like lower($1)
        or lower(full_name) like lower($2)
        or lower(email) like lower($3)
     order by created_at desc
     limit 20`,
    ['%ismet%', '%ismet%krak%','%ismet%']
  );

  const userIds = users.rows.map((u) => u.id);
  let orderCounts = [];
  if (userIds.length) {
    const orders = await client.query(
      `select buyer_id, count(*)::int as total
       from orders
       where buyer_id = any($1::uuid[])
       group by buyer_id`,
      [userIds]
    );
    orderCounts = orders.rows;
  }

  console.log(JSON.stringify({ users: users.rows, orderCounts }, null, 2));
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
