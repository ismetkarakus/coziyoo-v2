const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const users = await client.query(
    `select u.id, u.email, u.display_name, u.full_name, u.created_at,
            coalesce(o.total,0)::int as order_total
     from users u
     left join (
       select buyer_id, count(*)::int as total
       from orders
       group by buyer_id
     ) o on o.buyer_id = u.id
     where lower(coalesce(u.full_name,'')) like lower($1)
        or lower(coalesce(u.display_name,'')) like lower($2)
        or lower(coalesce(u.email,'')) like lower($3)
     order by u.created_at desc
     limit 50`,
    ['%karak%', '%ismet%', '%ismet%']
  );

  console.log(JSON.stringify(users.rows, null, 2));
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
