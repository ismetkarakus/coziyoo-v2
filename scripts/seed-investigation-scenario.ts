import { pool } from "../src/db/client.js";
import { normalizeDisplayName } from "../src/utils/normalize.js";
import { hashPassword } from "../src/utils/security.js";

type FoodSeed = {
  name: string;
  summary: string;
  description: string;
  recipe: string;
  ingredients: string[];
  allergens: string[];
  price: number;
  imageUrl: string;
};

type SellerSeed = {
  email: string;
  displayName: string;
  fullName: string;
  foods: FoodSeed[];
};

type BuyerSeed = {
  email: string;
  displayName: string;
  fullName: string;
  district: string;
  city: string;
};

const sellers: SellerSeed[] = [
  {
    email: "investigation.seller1@coziyoo.local",
    displayName: "investigation_seller_1",
    fullName: "Lezzet Duragi 1",
    foods: [
      {
        name: "Mercimek Corbasi",
        summary: "Klasik kirmizi mercimek corbasi",
        description: "INVESTIGATION-SEED: Taze malzemelerle gunluk hazirlanir.",
        recipe: "Mercimek, sogan, havuc ve tereyagi ile pisirilir.",
        ingredients: ["kirmizi mercimek", "sogan", "havuc", "tereyagi", "tuz", "kimyon"],
        allergens: ["sut"],
        price: 99.9,
        imageUrl: "https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=80",
      },
      {
        name: "Izgara Tavuk",
        summary: "Marine tavuk izgara",
        description: "INVESTIGATION-SEED: Komur atesinde pisirilir.",
        recipe: "Tavuk yogurtlu marine ile izgara edilir.",
        ingredients: ["tavuk", "yogurt", "zeytinyagi", "sarimsak", "tuz", "karabiber"],
        allergens: ["sut"],
        price: 219.9,
        imageUrl: "https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?auto=format&fit=crop&w=900&q=80",
      },
    ],
  },
  {
    email: "investigation.seller2@coziyoo.local",
    displayName: "investigation_seller_2",
    fullName: "Anadolu Mutfagi 2",
    foods: [
      {
        name: "Adana Kebap",
        summary: "Acili adana kebap",
        description: "INVESTIGATION-SEED: Usta usulu adana kebap.",
        recipe: "Kuzu kiyma ve baharatla hazirlanir.",
        ingredients: ["kuzu kiyma", "kuyruk yagi", "pul biber", "isot", "tuz", "lavas"],
        allergens: ["gluten"],
        price: 279,
        imageUrl: "https://images.unsplash.com/photo-1529692236671-f1f6cf9683ba?auto=format&fit=crop&w=900&q=80",
      },
      {
        name: "Etli Kuru Fasulye",
        summary: "Dana etli kuru fasulye",
        description: "INVESTIGATION-SEED: Kemik suyu ile pisirilir.",
        recipe: "Fasulye bir gece bekletilip etle pisirilir.",
        ingredients: ["kuru fasulye", "dana eti", "sogan", "domates salcasi", "tuz", "karabiber"],
        allergens: [],
        price: 189.5,
        imageUrl: "https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=900&q=80",
      },
    ],
  },
  {
    email: "investigation.seller3@coziyoo.local",
    displayName: "investigation_seller_3",
    fullName: "Tatli Kosesi 3",
    foods: [
      {
        name: "Firinda Sutlac",
        summary: "Geleneksel firin sutlac",
        description: "INVESTIGATION-SEED: Ustu nar gibi kizarmis.",
        recipe: "Sut, pirinc ve sekerle hazirlanir.",
        ingredients: ["sut", "pirinc", "toz seker", "nisasta", "vanilya"],
        allergens: ["sut"],
        price: 94.5,
        imageUrl: "https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=900&q=80",
      },
      {
        name: "Fistikli Baklava",
        summary: "Antep fistikli baklava",
        description: "INVESTIGATION-SEED: Tereyagli ince yufka.",
        recipe: "Yufka katlari fistik ve serbetle hazirlanir.",
        ingredients: ["baklava yufkasi", "antep fistigi", "tereyagi", "serbet"],
        allergens: ["gluten", "sut", "kabuklu yemis"],
        price: 169,
        imageUrl: "https://images.unsplash.com/photo-1626803775151-61d756612f97?auto=format&fit=crop&w=900&q=80",
      },
    ],
  },
  {
    email: "investigation.seller4@coziyoo.local",
    displayName: "investigation_seller_4",
    fullName: "Ege Sofrasi 4",
    foods: [
      {
        name: "Levrek Izgara",
        summary: "Limonlu levrek izgara",
        description: "INVESTIGATION-SEED: Roka salatasi ile servis.",
        recipe: "Levrek fileto zeytinyagi ve limonla izgara edilir.",
        ingredients: ["levrek fileto", "zeytinyagi", "limon", "tuz", "karabiber", "roka"],
        allergens: ["balik"],
        price: 312,
        imageUrl: "https://images.unsplash.com/photo-1612874742237-6526221588e3?auto=format&fit=crop&w=900&q=80",
      },
      {
        name: "Zeytinyagli Yaprak Sarma",
        summary: "Soguk zeytinyagli sarma",
        description: "INVESTIGATION-SEED: Limonla soguk servis.",
        recipe: "Pirinc harci yapraklara sarilip kisik ateste pisirilir.",
        ingredients: ["asma yapragi", "pirinc", "sogan", "zeytinyagi", "kus uzumu", "limon"],
        allergens: [],
        price: 129.5,
        imageUrl: "https://images.unsplash.com/photo-1611584186769-0a53b5f7f350?auto=format&fit=crop&w=900&q=80",
      },
    ],
  },
  {
    email: "investigation.seller5@coziyoo.local",
    displayName: "investigation_seller_5",
    fullName: "Karakoy Lezzet 5",
    foods: [
      {
        name: "Kasarli Sucuklu Pide",
        summary: "Odun firini pidesi",
        description: "INVESTIGATION-SEED: Taze kasar ve sucuk ile.",
        recipe: "Hamur acilip odun firininda pisirilir.",
        ingredients: ["un", "kasar peyniri", "sucuk", "maya", "tereyagi"],
        allergens: ["gluten", "sut"],
        price: 214,
        imageUrl: "https://images.unsplash.com/photo-1590947132387-155cc02f3212?auto=format&fit=crop&w=900&q=80",
      },
      {
        name: "Tavuklu Pilav",
        summary: "Nohutlu tavuklu pilav",
        description: "INVESTIGATION-SEED: Sokak usulu servis.",
        recipe: "Tavuk haslanip pirinc pilavi ile servis edilir.",
        ingredients: ["pirinc", "tavuk", "tereyagi", "nohut", "tuz", "karabiber"],
        allergens: ["sut"],
        price: 119,
        imageUrl: "https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=900&q=80",
      },
    ],
  },
];

const buyers: BuyerSeed[] = [
  { email: "investigation.buyer1@coziyoo.local", displayName: "investigation_buyer_1", fullName: "Ayse Kara", district: "Kadikoy", city: "Istanbul" },
  { email: "investigation.buyer2@coziyoo.local", displayName: "investigation_buyer_2", fullName: "Mert Acar", district: "Cankaya", city: "Ankara" },
  { email: "investigation.buyer3@coziyoo.local", displayName: "investigation_buyer_3", fullName: "Selin Aksoy", district: "Karsiyaka", city: "Izmir" },
  { email: "investigation.buyer4@coziyoo.local", displayName: "investigation_buyer_4", fullName: "Emir Yalcin", district: "Nilufer", city: "Bursa" },
  { email: "investigation.buyer5@coziyoo.local", displayName: "investigation_buyer_5", fullName: "Deniz Ucar", district: "Muratpasa", city: "Antalya" },
];

async function ensureCategory(nameTr: string, nameEn: string): Promise<string> {
  const existing = await pool.query<{ id: string }>("SELECT id FROM categories WHERE lower(name_tr) = lower($1) LIMIT 1", [nameTr]);
  if ((existing.rowCount ?? 0) > 0) return existing.rows[0].id;
  const inserted = await pool.query<{ id: string }>(
    "INSERT INTO categories (name_tr, name_en, sort_order, is_active) VALUES ($1, $2, 1, TRUE) RETURNING id",
    [nameTr, nameEn]
  );
  return inserted.rows[0].id;
}

async function upsertUser(params: {
  email: string;
  displayName: string;
  fullName: string;
  userType: "buyer" | "seller" | "both";
  passwordHash: string;
}): Promise<string> {
  const displayNameNormalized = normalizeDisplayName(params.displayName);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, display_name, display_name_normalized, full_name, user_type, is_active, country_code, language)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE, 'TR', 'tr')
     ON CONFLICT (email)
     DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       display_name = EXCLUDED.display_name,
       display_name_normalized = EXCLUDED.display_name_normalized,
       full_name = EXCLUDED.full_name,
       user_type = EXCLUDED.user_type,
       is_active = TRUE,
       country_code = 'TR',
       language = 'tr',
       updated_at = now()
     RETURNING id`,
    [params.email.toLowerCase(), params.passwordHash, params.displayName, displayNameNormalized, params.fullName, params.userType]
  );
  return result.rows[0].id;
}

async function main() {
  const passwordHash = await hashPassword("Seller12345!");
  const buyerPasswordHash = await hashPassword("Buyer12345!");
  const grilledCategoryId = await ensureCategory("Demo Yemek", "Demo Food");
  const sellerIds: string[] = [];
  const buyerIds: string[] = [];

  await pool.query("BEGIN");
  try {
    for (const seller of sellers) {
      const sellerId = await upsertUser({
        email: seller.email,
        displayName: seller.displayName,
        fullName: seller.fullName,
        userType: "seller",
        passwordHash,
      });
      sellerIds.push(sellerId);

      await pool.query(
        `INSERT INTO seller_compliance_profiles (seller_id, country_code, status, approved_at, updated_at)
         VALUES ($1, 'TR', 'approved', now(), now())
         ON CONFLICT (seller_id)
         DO UPDATE SET status = 'approved', approved_at = now(), updated_at = now()`,
        [sellerId]
      );

      await pool.query("DELETE FROM foods WHERE seller_id = $1 AND description LIKE 'INVESTIGATION-SEED:%'", [sellerId]);
      for (const food of seller.foods) {
        await pool.query(
          `INSERT INTO foods (
            seller_id, category_id, name, card_summary, description, recipe, country_code,
            price, image_url, ingredients_json, allergens_json, preparation_time_minutes,
            serving_size, delivery_fee, max_delivery_distance_km, delivery_options_json,
            current_stock, daily_stock, is_available, is_active, rating, review_count, favorite_count
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, 'TR', $7, $8, $9::jsonb, $10::jsonb, 20, '1 porsiyon',
            20.00, 8.00, $11::jsonb, 50, 50, TRUE, TRUE, 4.6, 0, 0
          )`,
          [
            sellerId,
            grilledCategoryId,
            food.name,
            food.summary,
            food.description,
            food.recipe,
            food.price,
            food.imageUrl,
            JSON.stringify(food.ingredients),
            JSON.stringify(food.allergens),
            JSON.stringify(["pickup", "delivery"]),
          ]
        );
      }
    }

    for (const buyer of buyers) {
      const buyerId = await upsertUser({
        email: buyer.email,
        displayName: buyer.displayName,
        fullName: buyer.fullName,
        userType: "buyer",
        passwordHash: buyerPasswordHash,
      });
      buyerIds.push(buyerId);

      await pool.query(
        `INSERT INTO user_addresses (user_id, title, address_line, is_default)
         VALUES ($1, 'Ev', $2, TRUE)
         ON CONFLICT ON CONSTRAINT uniq_user_default_address
         DO UPDATE SET address_line = EXCLUDED.address_line, updated_at = now()`,
        [buyerId, `${buyer.district}, ${buyer.city}, TR`]
      );
    }

    await pool.query("DELETE FROM payment_attempts WHERE buyer_id = ANY($1::uuid[])", [buyerIds]);
    await pool.query("DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE buyer_id = ANY($1::uuid[]))", [buyerIds]);
    await pool.query("DELETE FROM order_events WHERE order_id IN (SELECT id FROM orders WHERE buyer_id = ANY($1::uuid[]))", [buyerIds]);
    await pool.query("DELETE FROM orders WHERE buyer_id = ANY($1::uuid[])", [buyerIds]);

    let createdOrders = 0;
    let createdPayments = 0;
    const sessionSuffix = Date.now();

    for (let sellerIndex = 0; sellerIndex < sellerIds.length; sellerIndex += 1) {
      const sellerId = sellerIds[sellerIndex];
      const buyerIndex = sellerIndex % buyerIds.length;
      const buyerId = buyerIds[buyerIndex];
      const buyer = buyers[buyerIndex];

      const foods = await pool.query<{ id: string; price: string }>(
        "SELECT id, price::text FROM foods WHERE seller_id = $1 ORDER BY created_at DESC LIMIT 2",
        [sellerId]
      );

      for (let foodIndex = 0; foodIndex < foods.rows.length; foodIndex += 1) {
        const food = foods.rows[foodIndex];
        const quantity = foodIndex % 2 === 0 ? 1 : 2;
        const unitPrice = Number(food.price);
        const total = Number((unitPrice * quantity).toFixed(2));
        const orderInsert = await pool.query<{ id: string }>(
          `INSERT INTO orders (
             buyer_id, seller_id, status, delivery_type, delivery_address_json, total_price,
             requested_at, estimated_delivery_time, payment_completed, created_at, updated_at
           )
           VALUES (
             $1, $2, 'delivered', 'delivery', $3::jsonb, $4, now() - interval '2 hour',
             now() - interval '1 hour', TRUE, now() - interval '90 minute', now()
           )
           RETURNING id`,
          [
            buyerId,
            sellerId,
            JSON.stringify({
              district: buyer.district,
              city: buyer.city,
              country: "TR",
              line: `${buyer.district} Mahallesi`,
              source: "INVESTIGATION-SEED",
            }),
            total,
          ]
        );

        const orderId = orderInsert.rows[0].id;
        await pool.query(
          `INSERT INTO order_items (order_id, food_id, quantity, unit_price, line_total)
           VALUES ($1, $2, $3, $4, $5)`,
          [orderId, food.id, quantity, unitPrice, total]
        );
        await pool.query(
          `INSERT INTO payment_attempts (
             order_id, buyer_id, provider, provider_session_id, provider_reference_id, status, callback_payload_json, signature_valid
           )
           VALUES ($1, $2, 'mockpay', $3, $4, 'succeeded', $5::jsonb, TRUE)`,
          [
            orderId,
            buyerId,
            `investigation-session-${sessionSuffix}-${sellerIndex}-${foodIndex}`,
            `investigation-ref-${sessionSuffix}-${sellerIndex}-${foodIndex}`,
            JSON.stringify({ result: "confirmed", source: "INVESTIGATION-SEED" }),
          ]
        );
        await pool.query(
          `INSERT INTO order_events (order_id, actor_user_id, event_type, from_status, to_status, payload_json)
           VALUES ($1, $2, 'status_update', 'paid', 'delivered', $3::jsonb)`,
          [orderId, sellerId, JSON.stringify({ source: "INVESTIGATION-SEED", note: "Teslimat tamamlandi" })]
        );
        createdOrders += 1;
        createdPayments += 1;
      }
    }

    await pool.query("COMMIT");
    console.log("Investigation scenario seeded successfully.", {
      sellers: sellerIds.length,
      buyers: buyerIds.length,
      orders: createdOrders,
      payments: createdPayments,
      sellerPassword: "Seller12345!",
      buyerPassword: "Buyer12345!",
    });
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}

main()
  .catch((error) => {
    console.error("Investigation scenario seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
