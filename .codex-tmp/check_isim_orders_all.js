const { Client } = require('pg');

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const u = await c.query(
    `select id,email,display_name,full_name,user_type,is_active,created_at
     from users
     where user_type in ('buyer','both')
     order by created_at desc`
  );

  const rows = u.rows.filter((r) => {
    const s = [r.email, r.display_name, r.full_name].map((x) => String(x || '')).join(' ').toLowerCase();
    return s.includes('ismet') || s.includes('karakus') || s.includes('krakus') || s.includes('karakuş') || s.includes('krakuş');
  });

  if (!rows.length) {
    console.log('no-match');
    await c.end();
    return;
  }

  const ids = rows.map((r) => r.id);
  const o = await c.query(
    `select buyer_id,count(*)::int as total
     from orders
     where buyer_id = any($1::uuid[])
     group by buyer_id`,
    [ids]
  );

  const byId = Object.fromEntries(o.rows.map((x) => [x.buyer_id, x.total]));
  console.log(JSON.stringify(rows.map((r) => ({ ...r, order_total: byId[r.id] || 0 })), null, 2));

  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
