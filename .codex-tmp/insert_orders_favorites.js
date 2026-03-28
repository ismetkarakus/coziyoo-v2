const { Client } = require('pg');

async function run() {
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await c.connect();
  await c.query('BEGIN');

  try {
    const userRes = await c.query(
      `select id,email,display_name,user_type
       from users
       where lower(display_name)=lower($1)
          or lower(email) like $2
       order by created_at desc
       limit 1`,
      ['ismetkarakus1', 'ismetkarakus1%']
    );

    if (!userRes.rows.length) {
      throw new Error('Kullanici bulunamadi: ismetkarakus1');
    }

    const buyer = userRes.rows[0];

    const addrRes = await c.query(
      `select id,title,address_line,is_default
       from user_addresses
       where user_id=$1
       order by is_default desc, created_at asc
       limit 1`,
      [buyer.id]
    );

    const address = addrRes.rows[0] || null;

    const foodsRes = await c.query(
      `select f.id,f.name,f.price,f.seller_id,u.display_name as seller_name
       from foods f
       join users u on u.id=f.seller_id
       where f.is_active=true and f.seller_id<>$1
       order by f.rating desc nulls last, f.review_count desc, f.created_at desc
       limit 20`,
      [buyer.id]
    );

    if (foodsRes.rows.length < 3) {
      throw new Error('Siparis icin yeterli aktif yemek yok (min 3)');
    }

    const picked = foodsRes.rows.slice(0, 3);
    const insertedOrders = [];

    for (const food of picked) {
      const total = Number(food.price);
      const deliveryAddressJson = address
        ? {
            basis: 'address',
            addressId: address.id,
            title: address.title,
            addressLine: address.address_line,
          }
        : {
            basis: 'fallback',
            note: 'Adres kaydi yok',
          };

      const ord = await c.query(
        `insert into orders
          (buyer_id,seller_id,status,delivery_type,delivery_address_json,total_price,requested_at,estimated_delivery_time,payment_completed)
         values
          ($1,$2,$3,$4,$5::jsonb,$6,now(),now()+interval '45 minutes',true)
         returning id`,
        [buyer.id, food.seller_id, 'confirmed', 'delivery', JSON.stringify(deliveryAddressJson), total]
      );

      const orderId = ord.rows[0].id;

      await c.query(
        `insert into order_items (order_id,lot_id,food_id,quantity,unit_price,line_total)
         values ($1,null,$2,1,$3,$3)`,
        [orderId, food.id, total]
      );

      insertedOrders.push({
        orderId,
        foodId: food.id,
        foodName: food.name,
        sellerId: food.seller_id,
        sellerName: food.seller_name,
        price: total,
      });
    }

    const favInsertRes = await c.query(
      `insert into favorites (user_id,food_id)
       values ($1,$2),($1,$3),($1,$4)
       on conflict (user_id,food_id) do nothing
       returning food_id`,
      [buyer.id, picked[0].id, picked[1].id, picked[2].id]
    );

    await c.query('COMMIT');

    console.log(
      JSON.stringify(
        {
          buyer: {
            id: buyer.id,
            email: buyer.email,
            display_name: buyer.display_name,
            user_type: buyer.user_type,
          },
          ordersInserted: insertedOrders.length,
          orders: insertedOrders,
          favoritesInserted: favInsertRes.rowCount,
          favoriteFoodIdsInserted: favInsertRes.rows.map((r) => r.food_id),
          addressBasis: address ? `Adres: ${address.title}` : 'Adres kaydi yok (fallback json)',
        },
        null,
        2
      )
    );
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    await c.end();
  }
}

run().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
