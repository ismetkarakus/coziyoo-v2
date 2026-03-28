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
    if (!userRes.rows.length) throw new Error('Kullanici bulunamadi: ismetkarakus1');

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
      `select f.id,f.name,f.price,f.seller_id,u.display_name as seller_name,
              exists(select 1 from favorites fav where fav.user_id=$1 and fav.food_id=f.id) as already_favorited
       from foods f
       join users u on u.id=f.seller_id
       where f.is_active=true and f.seller_id<>$1
       order by already_favorited asc, f.rating desc nulls last, f.review_count desc, f.created_at desc
       limit 50`,
      [buyer.id]
    );
    if (foodsRes.rows.length < 3) throw new Error('Siparis icin yeterli aktif yemek yok (min 3)');

    const pickedForOrders = foodsRes.rows.slice(0, 3);
    const pickedForFavorites = foodsRes.rows.filter((f) => !f.already_favorited).slice(0, 3);

    const insertedOrders = [];
    for (const food of pickedForOrders) {
      const total = Number(food.price);
      const deliveryAddressJson = address
        ? { basis: 'address', addressId: address.id, title: address.title, addressLine: address.address_line }
        : { basis: 'fallback', note: 'Adres kaydi yok' };

      const ord = await c.query(
        `insert into orders
          (buyer_id,seller_id,status,delivery_type,delivery_address_json,total_price,requested_at,estimated_delivery_time,payment_completed)
         values ($1,$2,$3,$4,$5::jsonb,$6,now(),now()+interval '45 minutes',true)
         returning id`,
        [buyer.id, food.seller_id, 'confirmed', 'delivery', JSON.stringify(deliveryAddressJson), total]
      );

      await c.query(
        `insert into order_items (order_id,lot_id,food_id,quantity,unit_price,line_total)
         values ($1,null,$2,1,$3,$3)`,
        [ord.rows[0].id, food.id, total]
      );

      insertedOrders.push({ orderId: ord.rows[0].id, foodId: food.id, foodName: food.name });
    }

    let favoritesInserted = 0;
    let favoriteFoodIdsInserted = [];
    if (pickedForFavorites.length > 0) {
      const params = [buyer.id, ...pickedForFavorites.map((f) => f.id)];
      const valuesSql = pickedForFavorites.map((_, i) => `($1,$${i + 2})`).join(',');
      const favRes = await c.query(
        `insert into favorites (user_id,food_id)
         values ${valuesSql}
         on conflict (user_id,food_id) do nothing
         returning food_id`,
        params
      );
      favoritesInserted = favRes.rowCount;
      favoriteFoodIdsInserted = favRes.rows.map((r) => r.food_id);
    }

    await c.query('COMMIT');

    console.log(JSON.stringify({
      buyerId: buyer.id,
      ordersInserted: insertedOrders.length,
      orders: insertedOrders,
      favoritesInserted,
      favoriteFoodIdsInserted
    }, null, 2));
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
