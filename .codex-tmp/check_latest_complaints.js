const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const result = await client.query(
    `select c.id, c.ticket_no, c.status, c.priority, c.created_at,
            coalesce(cat.code, '-') as category_code,
            u.display_name as complainant
     from complaints c
     left join complaint_categories cat on cat.id = c.category_id
     left join users u on u.id = c.complainant_user_id
     order by c.created_at desc
     limit 5`
  );
  console.log(JSON.stringify(result.rows, null, 2));
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
