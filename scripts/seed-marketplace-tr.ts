import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "../src/db/client.js";
import { normalizeDisplayName } from "../src/utils/normalize.js";
import { hashPassword } from "../src/utils/security.js";

type SellerSeed = {
  fullName: string;
  displayName: string;
  email: string;
  district: string;
  city: string;
  profileImageUrl: string;
};

type BuyerSeed = {
  fullName: string;
  displayName: string;
  email: string;
  district: string;
  city: string;
};

type FoodTemplate = {
  categoryTr: string;
  categoryEn: string;
  name: string;
  summary: string;
  description: string;
  recipe: string;
  ingredients: string[];
  allergens: string[];
  imageUrl: string;
  prepMinutes: number;
  servingSize: string;
  basePrice: number;
};

type SeededSeller = {
  id: string;
  fullName: string;
};

type SeededBuyer = {
  id: string;
  fullName: string;
  district: string;
  city: string;
};

type SeededFood = {
  id: string;
  price: number;
  name: string;
};

type OrderStatus =
  | "pending_seller_approval"
  | "seller_approved"
  | "awaiting_payment"
  | "paid"
  | "preparing"
  | "ready"
  | "in_delivery"
  | "delivered"
  | "completed"
  | "cancelled";

const ORDER_STATUS_ROTATION: OrderStatus[] = [
  "pending_seller_approval",
  "seller_approved",
  "awaiting_payment",
  "paid",
  "preparing",
  "ready",
  "in_delivery",
  "delivered",
  "completed",
  "cancelled",
];

const SELLERS: SellerSeed[] = [
  { fullName: "Ahmet Yilmaz", displayName: "ahmetyilmaz", email: "satici.ahmet@coziyoo.local", district: "Besiktas", city: "Istanbul", profileImageUrl: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=400&q=80" },
  { fullName: "Mehmet Demir", displayName: "mehmetdemir", email: "satici.mehmet@coziyoo.local", district: "Kadikoy", city: "Istanbul", profileImageUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80" },
  { fullName: "Ali Kaya", displayName: "alikaya", email: "satici.ali@coziyoo.local", district: "Konak", city: "Izmir", profileImageUrl: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=400&q=80" },
  { fullName: "Hasan Celik", displayName: "hasancelik", email: "satici.hasan@coziyoo.local", district: "Cankaya", city: "Ankara", profileImageUrl: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=400&q=80" },
  { fullName: "Murat Aydin", displayName: "murataydin", email: "satici.murat@coziyoo.local", district: "Nilufer", city: "Bursa", profileImageUrl: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=400&q=80" },
  { fullName: "Yusuf Sahin", displayName: "yusufsahin", email: "satici.yusuf@coziyoo.local", district: "Selcuklu", city: "Konya", profileImageUrl: "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=400&q=80" },
  { fullName: "Zeynep Arslan", displayName: "zeyneparslan", email: "satici.zeynep@coziyoo.local", district: "Muratpasa", city: "Antalya", profileImageUrl: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400&q=80" },
  { fullName: "Ayse Koc", displayName: "aysekoc", email: "satici.ayse@coziyoo.local", district: "Tepebasi", city: "Eskisehir", profileImageUrl: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=400&q=80" },
  { fullName: "Elif Kurt", displayName: "elifkurt", email: "satici.elif@coziyoo.local", district: "Ortahisar", city: "Trabzon", profileImageUrl: "https://images.unsplash.com/photo-1544723795-3fb6469f5b39?auto=format&fit=crop&w=400&q=80" },
  { fullName: "Fatma Ozkan", displayName: "fatmaozkan", email: "satici.fatma@coziyoo.local", district: "Yuregir", city: "Adana", profileImageUrl: "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=400&q=80" },
];

const BUYERS: BuyerSeed[] = [
  { fullName: "Mustafa Karaca", displayName: "mustafakaraca", email: "alici.mustafa@coziyoo.local", district: "Sisli", city: "Istanbul" },
  { fullName: "Emre Yildiz", displayName: "emreyildiz", email: "alici.emre@coziyoo.local", district: "Uskudar", city: "Istanbul" },
  { fullName: "Burak Gunes", displayName: "burakgunes", email: "alici.burak@coziyoo.local", district: "Karsiyaka", city: "Izmir" },
  { fullName: "Can Aksoy", displayName: "canaksoy", email: "alici.can@coziyoo.local", district: "Yenimahalle", city: "Ankara" },
  { fullName: "Ece Turan", displayName: "eceturan", email: "alici.ece@coziyoo.local", district: "Osmangazi", city: "Bursa" },
  { fullName: "Deniz Sari", displayName: "denizsari", email: "alici.deniz@coziyoo.local", district: "Meram", city: "Konya" },
  { fullName: "Cagla Ozturk", displayName: "caglaozturk", email: "alici.cagla@coziyoo.local", district: "Kepez", city: "Antalya" },
  { fullName: "Selin Erdem", displayName: "selinerdem", email: "alici.selin@coziyoo.local", district: "Odunpazari", city: "Eskisehir" },
  { fullName: "Hakan Ince", displayName: "hakanince", email: "alici.hakan@coziyoo.local", district: "Akcaabat", city: "Trabzon" },
  { fullName: "Merve Ucar", displayName: "merveucar", email: "alici.merve@coziyoo.local", district: "Seyhan", city: "Adana" },
];

const FOOD_TEMPLATES: FoodTemplate[] = [
  {
    categoryTr: "Corba",
    categoryEn: "Soup",
    name: "Mercimek Corbasi",
    summary: "Klasik lokanta usulu mercimek corbasi",
    description: "TR-MARKET-SEED: Taze kirmizi mercimek ile hazirlanir.",
    recipe: "Mercimek, sogan ve havuc blend edilip tereyagli sosla servis edilir.",
    ingredients: ["kirmizi mercimek", "sogan", "havuc", "tereyagi", "tuz"],
    allergens: ["sut"],
    imageUrl: "https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=80",
    prepMinutes: 20,
    servingSize: "350 ml",
    basePrice: 89,
  },
  {
    categoryTr: "Kebap",
    categoryEn: "Kebab",
    name: "Adana Kebap",
    summary: "Acili adana kebap ve lavas",
    description: "TR-MARKET-SEED: Usta usulu adana kebap.",
    recipe: "Kuzu kiyma baharatla yogrulup sise cekilerek komur atesinde pisirilir.",
    ingredients: ["kuzu kiyma", "pul biber", "isot", "lavas", "sumakli sogan"],
    allergens: ["gluten"],
    imageUrl: "https://images.unsplash.com/photo-1529692236671-f1f6cf9683ba?auto=format&fit=crop&w=900&q=80",
    prepMinutes: 30,
    servingSize: "1 porsiyon",
    basePrice: 249,
  },
  {
    categoryTr: "Ana Yemek",
    categoryEn: "Main Dish",
    name: "Etli Kuru Fasulye",
    summary: "Kemik suyu ile pisirilmis etli kuru fasulye",
    description: "TR-MARKET-SEED: Ev usulu etli kuru fasulye.",
    recipe: "Bir gece bekletilen fasulye dana kusbasi ile uzun sure pisirilir.",
    ingredients: ["kuru fasulye", "dana eti", "sogan", "domates salcasi"],
    allergens: [],
    imageUrl: "https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=900&q=80",
    prepMinutes: 35,
    servingSize: "1 porsiyon",
    basePrice: 179,
  },
  {
    categoryTr: "Tatli",
    categoryEn: "Dessert",
    name: "Fistikli Baklava",
    summary: "Antep fistikli, serbetli baklava",
    description: "TR-MARKET-SEED: Ince yufka ve antep fistigi ile.",
    recipe: "Yufkalar tereyagi ile katlanir, fistikla firinlanip serbetlenir.",
    ingredients: ["baklava yufkasi", "antep fistigi", "tereyagi", "serbet"],
    allergens: ["gluten", "sut", "kabuklu yemis"],
    imageUrl: "https://images.unsplash.com/photo-1626803775151-61d756612f97?auto=format&fit=crop&w=900&q=80",
    prepMinutes: 22,
    servingSize: "4 dilim",
    basePrice: 159,
  },
  {
    categoryTr: "Pide",
    categoryEn: "Pide",
    name: "Kasarli Sucuklu Pide",
    summary: "Odun firininda kasarli sucuklu pide",
    description: "TR-MARKET-SEED: Taze hamurla odun firininda pisirilir.",
    recipe: "Hamur acilir, kasar peyniri ve sucuk eklenip yuksek isida pisirilir.",
    ingredients: ["un", "kasar peyniri", "sucuk", "maya"],
    allergens: ["gluten", "sut"],
    imageUrl: "https://images.unsplash.com/photo-1590947132387-155cc02f3212?auto=format&fit=crop&w=900&q=80",
    prepMinutes: 25,
    servingSize: "1 adet",
    basePrice: 199,
  },
  {
    categoryTr: "Ana Yemek",
    categoryEn: "Main Dish",
    name: "Tavuklu Pilav",
    summary: "Nohutlu tavuklu pilav",
    description: "TR-MARKET-SEED: Sokak lezzeti tavuklu pilav.",
    recipe: "Haslanmis tavuk didiklenir, tereyagli pilav ve nohut ile servis edilir.",
    ingredients: ["pirinc", "tavuk", "tereyagi", "nohut"],
    allergens: ["sut"],
    imageUrl: "https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=900&q=80",
    prepMinutes: 16,
    servingSize: "1 porsiyon",
    basePrice: 109,
  },
  {
    categoryTr: "Tatli",
    categoryEn: "Dessert",
    name: "Firinda Sutlac",
    summary: "Tarcinli firin sutlac",
    description: "TR-MARKET-SEED: Geleneksel firinlanmis sutlac.",
    recipe: "Sutlac karisimi toprak kapta firinlanir ve ustu kizartilir.",
    ingredients: ["sut", "pirinc", "toz seker", "nisasta"],
    allergens: ["sut"],
    imageUrl: "https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=900&q=80",
    prepMinutes: 18,
    servingSize: "1 kase",
    basePrice: 84,
  },
  {
    categoryTr: "Deniz Urunu",
    categoryEn: "Seafood",
    name: "Levrek Izgara",
    summary: "Limonlu levrek izgara",
    description: "TR-MARKET-SEED: Roka salatasi ile servis edilir.",
    recipe: "Levrek fileto zeytinyagi ve limonla marine edilip izgara edilir.",
    ingredients: ["levrek fileto", "zeytinyagi", "limon", "roka"],
    allergens: ["balik"],
    imageUrl: "https://images.unsplash.com/photo-1612874742237-6526221588e3?auto=format&fit=crop&w=900&q=80",
    prepMinutes: 28,
    servingSize: "1 porsiyon",
    basePrice: 299,
  },
  {
    categoryTr: "Meze",
    categoryEn: "Appetizer",
    name: "Zeytinyagli Yaprak Sarma",
    summary: "Limonlu soguk yaprak sarma",
    description: "TR-MARKET-SEED: Ege usulu zeytinyagli yaprak sarma.",
    recipe: "Pirincli harc yapraklara sarilir, kisik ateste pisirilir ve soguk servis edilir.",
    ingredients: ["asma yapragi", "pirinc", "sogan", "zeytinyagi", "limon"],
    allergens: [],
    imageUrl: "https://images.unsplash.com/photo-1611584186769-0a53b5f7f350?auto=format&fit=crop&w=900&q=80",
    prepMinutes: 24,
    servingSize: "10 adet",
    basePrice: 119,
  },
  {
    categoryTr: "Ana Yemek",
    categoryEn: "Main Dish",
    name: "Imam Bayildi",
    summary: "Zeytinyagli patlican yemegi",
    description: "TR-MARKET-SEED: Hafif ve geleneksel bir ana yemek.",
    recipe: "Patlican icine sogan-domatesli harc doldurularak zeytinyagi ile pisirilir.",
    ingredients: ["patlican", "sogan", "domates", "zeytinyagi", "sarimsak"],
    allergens: [],
    imageUrl: "https://images.unsplash.com/photo-1604908554265-0f44af0f4f8b?auto=format&fit=crop&w=900&q=80",
    prepMinutes: 26,
    servingSize: "1 porsiyon",
    basePrice: 129,
  },
];

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildOrderCode(dateIso: string, index: number): string {
  return `OR_${dateIso}_${String(index).padStart(3, "0")}`;
}

function paymentCompletedForStatus(status: OrderStatus): boolean {
  return ["paid", "preparing", "ready", "in_delivery", "delivered", "completed"].includes(status);
}

function estimateDeliveryType(orderIndex: number): "pickup" | "delivery" {
  return orderIndex % 3 === 0 ? "pickup" : "delivery";
}

function pickDistinctFoodIndexes(seed: number, maxCount: number, total: number): number[] {
  const target = Math.max(1, Math.min(maxCount, total));
  const picked = new Set<number>();
  let cursor = seed;
  while (picked.size < target) {
    picked.add(cursor % total);
    cursor += 3;
  }
  return Array.from(picked.values());
}

async function exportSchemaColumns() {
  const result = await pool.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: string;
    ordinal_position: number;
  }>(
    `SELECT table_name, column_name, data_type, is_nullable, ordinal_position
     FROM information_schema.columns
     WHERE table_schema = 'public'
     ORDER BY table_name ASC, ordinal_position ASC`
  );

  const grouped: Record<
    string,
    Array<{
      columnName: string;
      dataType: string;
      nullable: boolean;
      ordinalPosition: number;
    }>
  > = {};

  for (const row of result.rows) {
    if (!grouped[row.table_name]) grouped[row.table_name] = [];
    grouped[row.table_name].push({
      columnName: row.column_name,
      dataType: row.data_type,
      nullable: row.is_nullable === "YES",
      ordinalPosition: row.ordinal_position,
    });
  }

  const outputPath = path.resolve(process.cwd(), "docs/seed-schema-columns.json");
  await writeFile(
    outputPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        tableCount: Object.keys(grouped).length,
        tables: grouped,
      },
      null,
      2
    )
  );
  return outputPath;
}

async function ensureCategory(categoryTr: string, categoryEn: string, sortOrder: number): Promise<string> {
  const existing = await pool.query<{ id: string }>(
    "SELECT id FROM categories WHERE lower(name_tr) = lower($1) LIMIT 1",
    [categoryTr]
  );
  if ((existing.rowCount ?? 0) > 0) return existing.rows[0].id;

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO categories (name_tr, name_en, sort_order, is_active)
     VALUES ($1, $2, $3, TRUE)
     RETURNING id`,
    [categoryTr, categoryEn, sortOrder]
  );
  return inserted.rows[0].id;
}

async function createSellers(passwordHash: string): Promise<SeededSeller[]> {
  const sellers: SeededSeller[] = [];
  for (const seller of SELLERS) {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO users (
        email, password_hash, display_name, display_name_normalized, full_name,
        profile_image_url, user_type, is_active, country_code, language
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'seller', TRUE, 'TR', 'tr')
      RETURNING id`,
      [
        seller.email,
        passwordHash,
        seller.displayName,
        normalizeDisplayName(seller.displayName),
        seller.fullName,
        seller.profileImageUrl,
      ]
    );

    const sellerId = result.rows[0].id;
    await pool.query(
      `INSERT INTO seller_compliance_profiles (seller_id, country_code, status, approved_at, updated_at)
       VALUES ($1, 'TR', 'approved', now(), now())`,
      [sellerId]
    );

    sellers.push({ id: sellerId, fullName: seller.fullName });
  }
  return sellers;
}

async function createBuyers(passwordHash: string): Promise<SeededBuyer[]> {
  const buyers: SeededBuyer[] = [];
  for (const buyer of BUYERS) {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO users (
        email, password_hash, display_name, display_name_normalized, full_name,
        user_type, is_active, country_code, language
      )
      VALUES ($1, $2, $3, $4, $5, 'buyer', TRUE, 'TR', 'tr')
      RETURNING id`,
      [buyer.email, passwordHash, buyer.displayName, normalizeDisplayName(buyer.displayName), buyer.fullName]
    );

    const buyerId = result.rows[0].id;
    await pool.query(
      `INSERT INTO user_addresses (user_id, title, address_line, is_default)
       VALUES ($1, 'Ev', $2, TRUE)`,
      [buyerId, `${buyer.district}, ${buyer.city}, TR`]
    );

    buyers.push({
      id: buyerId,
      fullName: buyer.fullName,
      district: buyer.district,
      city: buyer.city,
    });
  }
  return buyers;
}

async function createFoodsBySeller(sellers: SeededSeller[]): Promise<Map<string, SeededFood[]>> {
  const map = new Map<string, SeededFood[]>();
  const categoryCache = new Map<string, string>();

  for (let sellerIndex = 0; sellerIndex < sellers.length; sellerIndex += 1) {
    const seller = sellers[sellerIndex];
    const sellerFoods: SeededFood[] = [];

    for (let foodIndex = 0; foodIndex < FOOD_TEMPLATES.length; foodIndex += 1) {
      const template = FOOD_TEMPLATES[foodIndex];
      const categoryKey = `${template.categoryTr}|${template.categoryEn}`;
      let categoryId = categoryCache.get(categoryKey);
      if (!categoryId) {
        categoryId = await ensureCategory(template.categoryTr, template.categoryEn, foodIndex + 1);
        categoryCache.set(categoryKey, categoryId);
      }

      const price = Number((template.basePrice + sellerIndex * 3 + foodIndex).toFixed(2));
      const stock = 40 + ((sellerIndex + 1) * (foodIndex + 2)) % 35;
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO foods (
          seller_id, category_id, name, card_summary, description, recipe, country_code,
          price, image_url, ingredients_json, allergens_json, preparation_time_minutes,
          serving_size, delivery_fee, max_delivery_distance_km, delivery_options_json,
          current_stock, daily_stock, is_available, is_active, rating, review_count, favorite_count
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, 'TR',
          $7, $8, $9::jsonb, $10::jsonb, $11, $12, 20.00, 8.00, $13::jsonb,
          $14, $15, TRUE, TRUE, 4.5, 0, 0
        )
        RETURNING id`,
        [
          seller.id,
          categoryId,
          template.name,
          template.summary,
          `${template.description} ${seller.fullName} mutfaginda hazirlanir.`,
          template.recipe,
          price,
          template.imageUrl,
          JSON.stringify(template.ingredients),
          JSON.stringify(template.allergens),
          template.prepMinutes,
          template.servingSize,
          JSON.stringify(["pickup", "delivery"]),
          stock,
          stock,
        ]
      );

      sellerFoods.push({ id: inserted.rows[0].id, price, name: template.name });
    }

    map.set(seller.id, sellerFoods);
  }

  return map;
}

async function createOrders(
  sellers: SeededSeller[],
  buyers: SeededBuyer[],
  foodsBySeller: Map<string, SeededFood[]>
): Promise<{ orderCount: number; orderItemCount: number }> {
  const dateIso = todayIsoDate();
  let globalOrderCounter = 0;
  let orderItemCount = 0;

  for (let sellerIndex = 0; sellerIndex < sellers.length; sellerIndex += 1) {
    const seller = sellers[sellerIndex];
    const foods = foodsBySeller.get(seller.id) ?? [];
    if (foods.length < 5) throw new Error(`Seller ${seller.id} must have at least 5 foods`);

    for (let orderIndex = 0; orderIndex < 10; orderIndex += 1) {
      globalOrderCounter += 1;
      const buyer = buyers[(sellerIndex + orderIndex) % buyers.length];
      const status = ORDER_STATUS_ROTATION[orderIndex % ORDER_STATUS_ROTATION.length];
      const itemCount = (orderIndex % 5) + 1;
      const pickedIndexes = pickDistinctFoodIndexes(orderIndex + sellerIndex, itemCount, foods.length);

      const items = pickedIndexes.map((foodIdx, idx) => {
        const food = foods[foodIdx];
        const quantity = ((orderIndex + idx) % 3) + 1;
        const lineTotal = Number((food.price * quantity).toFixed(2));
        return { food, quantity, lineTotal };
      });

      const totalPrice = Number(items.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2));
      const orderCode = buildOrderCode(dateIso, globalOrderCounter);
      const requestedAt = new Date(Date.now() - (globalOrderCounter * 35 + sellerIndex * 17) * 60_000);
      const estimatedDeliveryTime = new Date(requestedAt.getTime() + 55 * 60_000);

      const orderInserted = await pool.query<{ id: string }>(
        `INSERT INTO orders (
          order_code, buyer_id, seller_id, status, delivery_type, delivery_address_json,
          total_price, requested_at, estimated_delivery_time, payment_completed, created_at, updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $11
        )
        RETURNING id`,
        [
          orderCode,
          buyer.id,
          seller.id,
          status,
          estimateDeliveryType(orderIndex),
          JSON.stringify({ city: buyer.city, district: buyer.district, line: `${buyer.district} Mah.` }),
          totalPrice,
          requestedAt.toISOString(),
          estimatedDeliveryTime.toISOString(),
          paymentCompletedForStatus(status),
          requestedAt.toISOString(),
        ]
      );

      const orderId = orderInserted.rows[0].id;
      for (const item of items) {
        await pool.query(
          `INSERT INTO order_items (order_id, food_id, quantity, unit_price, line_total)
           VALUES ($1, $2, $3, $4, $5)`,
          [orderId, item.food.id, item.quantity, item.food.price, item.lineTotal]
        );
        orderItemCount += 1;
      }

      await pool.query(
        `INSERT INTO order_events (order_id, actor_user_id, event_type, from_status, to_status, payload_json, created_at)
         VALUES ($1, $2, 'order_created', NULL, 'pending_seller_approval', $3::jsonb, $4)`,
        [
          orderId,
          buyer.id,
          JSON.stringify({ orderCode, itemCount: items.length }),
          requestedAt.toISOString(),
        ]
      );

      if (status !== "pending_seller_approval") {
        await pool.query(
          `INSERT INTO order_events (order_id, actor_user_id, event_type, from_status, to_status, payload_json, created_at)
           VALUES ($1, $2, 'seed_status_set', 'pending_seller_approval', $3, $4::jsonb, $5)`,
          [
            orderId,
            seller.id,
            status,
            JSON.stringify({ reason: "TR-MARKET-SEED status assignment" }),
            new Date(requestedAt.getTime() + 5 * 60_000).toISOString(),
          ]
        );
      }
    }
  }

  return { orderCount: globalOrderCounter, orderItemCount };
}

async function main() {
  const sellerPassword = process.env.SEED_TR_SELLER_PASSWORD ?? "Seller12345!";
  const buyerPassword = process.env.SEED_TR_BUYER_PASSWORD ?? "Buyer12345!";
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@coziyoo.com";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "12345";

  const sellerPasswordHash = await hashPassword(sellerPassword);
  const buyerPasswordHash = await hashPassword(buyerPassword);
  const adminPasswordHash = await hashPassword(adminPassword);

  await pool.query("BEGIN");
  try {
    await pool.query(
      `INSERT INTO admin_users (email, password_hash, role, is_active)
       VALUES ($1, $2, 'super_admin', TRUE)`,
      [adminEmail.toLowerCase(), adminPasswordHash]
    );

    const sellers = await createSellers(sellerPasswordHash);
    const buyers = await createBuyers(buyerPasswordHash);
    const foodsBySeller = await createFoodsBySeller(sellers);
    const orderStats = await createOrders(sellers, buyers, foodsBySeller);
    const columnsPath = await exportSchemaColumns();

    await pool.query("COMMIT");

    const foodCount = Array.from(foodsBySeller.values()).reduce((sum, rows) => sum + rows.length, 0);
    console.log("TR marketplace seed completed.");
    console.log(`Sellers: ${sellers.length}`);
    console.log(`Buyers: ${buyers.length}`);
    console.log(`Foods: ${foodCount}`);
    console.log(`Orders: ${orderStats.orderCount}`);
    console.log(`OrderItems: ${orderStats.orderItemCount}`);
    console.log(`Order code format: OR_${todayIsoDate()}_###`);
    console.log(`Column list exported: ${columnsPath}`);
    console.log(`Admin login: ${adminEmail} / ${adminPassword}`);
    console.log(`Seller password: ${sellerPassword}`);
    console.log(`Buyer password: ${buyerPassword}`);
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}

main()
  .catch((error) => {
    console.error("TR marketplace seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
