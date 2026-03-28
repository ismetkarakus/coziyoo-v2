const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query('BEGIN');

  try {
    const buyer = await client.query(
      `select id, email, display_name from users
       where lower(display_name)=lower($1) or lower(email) like lower($2)
       order by created_at desc
       limit 1`,
      ['ismetkarakus1', 'ismetkarakus1%']
    );
    if (!buyer.rows.length) throw new Error('Test buyer bulunamadi');

    const buyerId = buyer.rows[0].id;

    const orders = await client.query(
      `select id
       from orders
       where buyer_id=$1
       order by created_at desc
       limit 3`,
      [buyerId]
    );
    if (orders.rows.length < 3) throw new Error('En az 3 siparis gerekli');

    const categories = await client.query(
      `select id, code from complaint_categories where code = any($1::text[]) and is_active=true`,
      [['teslimat_gecikmesi', 'urun_kalitesi', 'yanlis_urun']]
    );

    const catByCode = Object.fromEntries(categories.rows.map((r) => [r.code, r.id]));
    const missing = ['teslimat_gecikmesi', 'urun_kalitesi', 'yanlis_urun'].filter((c) => !catByCode[c]);
    if (missing.length) throw new Error(`Eksik kategori: ${missing.join(', ')}`);

    const payloads = [
      {
        orderId: orders.rows[0].id,
        code: 'teslimat_gecikmesi',
        description: 'Kurye teslimata belirtilen saatten cok daha gec geldi.',
        priority: 'medium',
      },
      {
        orderId: orders.rows[1].id,
        code: 'urun_kalitesi',
        description: 'Yemek soguk geldi ve paketleme kalitesi beklentimin altindaydi.',
        priority: 'high',
      },
      {
        orderId: orders.rows[2].id,
        code: 'yanlis_urun',
        description: 'Siparis verdigim urun yerine farkli bir yemek teslim edildi.',
        priority: 'medium',
      },
    ];

    const inserted = [];
    for (const item of payloads) {
      const result = await client.query(
        `insert into complaints
           (order_id, complainant_buyer_id, complainant_type, complainant_user_id, description, category_id, status, priority)
         values
           ($1, $2, 'buyer', $2, $3, $4, 'open', $5)
         returning id, ticket_no, order_id, status, priority, created_at`,
        [item.orderId, buyerId, item.description, catByCode[item.code], item.priority]
      );
      inserted.push({ ...result.rows[0], categoryCode: item.code });
    }

    await client.query('COMMIT');

    console.log(
      JSON.stringify(
        {
          buyer: buyer.rows[0],
          insertedCount: inserted.length,
          inserted,
        },
        null,
        2
      )
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
