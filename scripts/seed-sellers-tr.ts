import { pool } from "../src/db/client.js";
import { hashPassword } from "../src/utils/security.js";
import { normalizeDisplayName } from "../src/utils/normalize.js";

type SellerSeed = {
  email: string;
  displayName: string;
  fullName: string;
  profileImageUrl: string;
  foods: Array<{
    categoryTr: string;
    categoryEn: string;
    name: string;
    summary: string;
    description: string;
    recipe: string;
    price: number;
    imageUrl: string;
    stock: number;
    prepMinutes: number;
    servingSize: string;
    ingredients: string[];
    allergens: string[];
  }>;
};

const sellers: SellerSeed[] = [
  {
    email: "satici.lezzetduragi1@coziyoo.local",
    displayName: "lezzetduragi_tr_1",
    fullName: "Ahmet Yilmaz",
    profileImageUrl: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=400&q=80",
    foods: [
      {
        categoryTr: "Izgara",
        categoryEn: "Grill",
        name: "Izgara Tavuk",
        summary: "Kozlenmis biber ve pilav ile izgara tavuk",
        description: "TR-SEED: Gunluk marine edilmis tavuk gogsu, komur izgara teknigiyle pisirilir.",
        recipe: "Yogurt, zeytinyagi ve baharatla marine edilip izgara edilir.",
        price: 219.9,
        imageUrl: "https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?auto=format&fit=crop&w=900&q=80",
        stock: 45,
        prepMinutes: 25,
        servingSize: "1 porsiyon",
        ingredients: ["tavuk", "yogurt", "zeytinyagi", "baharat"],
        allergens: ["sut"],
      },
      {
        categoryTr: "Ana Yemek",
        categoryEn: "Main Dish",
        name: "Etli Kuru Fasulye",
        summary: "Tereyagli pirinc pilavi ile servis",
        description: "TR-SEED: Kemik suyuyla pisirilmis etli kuru fasulye.",
        recipe: "Fasulye bir gece bekletilir, dana kusbasi ile uzun sure pisirilir.",
        price: 189.5,
        imageUrl: "https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=900&q=80",
        stock: 38,
        prepMinutes: 35,
        servingSize: "1 porsiyon",
        ingredients: ["kuru fasulye", "dana eti", "sogan", "domates"],
        allergens: [],
      },
    ],
  },
  {
    email: "satici.anadolumutfagi2@coziyoo.local",
    displayName: "anadolumutfagi_tr_2",
    fullName: "Zeynep Demir",
    profileImageUrl: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400&q=80",
    foods: [
      {
        categoryTr: "Kebap",
        categoryEn: "Kebab",
        name: "Adana Kebap",
        summary: "Lavas, sumakli sogan ve kozlenmis domates ile",
        description: "TR-SEED: El cekimi kuzu etinden hazirlanan acili adana kebap.",
        recipe: "Kuzu eti baharatla yogrulur, sise gecirilip komur atesinde pisirilir.",
        price: 279.0,
        imageUrl: "https://images.unsplash.com/photo-1529692236671-f1f6cf9683ba?auto=format&fit=crop&w=900&q=80",
        stock: 32,
        prepMinutes: 30,
        servingSize: "1 porsiyon",
        ingredients: ["kuzu eti", "pul biber", "lavas", "sogan"],
        allergens: ["gluten"],
      },
      {
        categoryTr: "Corba",
        categoryEn: "Soup",
        name: "Mercimek Corbasi",
        summary: "Limon ve kirlangic yag ile servis",
        description: "TR-SEED: Kirmizi mercimekten geleneksel usulde hazirlanan corba.",
        recipe: "Mercimek ve sebzeler pisirilip blend edilir, tereyagli sos eklenir.",
        price: 99.9,
        imageUrl: "https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=80",
        stock: 55,
        prepMinutes: 20,
        servingSize: "350 ml",
        ingredients: ["mercimek", "havuç", "sogan", "tereyagi"],
        allergens: ["sut"],
      },
    ],
  },
  {
    email: "satici.eylultatlisi3@coziyoo.local",
    displayName: "eylultatlisi_tr_3",
    fullName: "Mehmet Kaya",
    profileImageUrl: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=400&q=80",
    foods: [
      {
        categoryTr: "Tatli",
        categoryEn: "Dessert",
        name: "Firinda Sutlac",
        summary: "Tarçin serpilmis geleneksel sutlac",
        description: "TR-SEED: Pirinc ve sut ile dusuk ateste kivam alana kadar pisirilir.",
        recipe: "Sutlac karisimi toprak kasede firinlanir ve ustu kizartilir.",
        price: 94.5,
        imageUrl: "https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=900&q=80",
        stock: 48,
        prepMinutes: 18,
        servingSize: "1 kase",
        ingredients: ["sut", "pirinc", "seker", "nisaasta"],
        allergens: ["sut"],
      },
      {
        categoryTr: "Tatli",
        categoryEn: "Dessert",
        name: "Fistikli Baklava",
        summary: "Ince yufka ve antep fistigi ile",
        description: "TR-SEED: Kat kat acilmis yufka ile usta isi baklava.",
        recipe: "Yufkalar tereyagi ile katlanir, fistikla firinda kizartilip serbetlenir.",
        price: 169.0,
        imageUrl: "https://images.unsplash.com/photo-1626803775151-61d756612f97?auto=format&fit=crop&w=900&q=80",
        stock: 26,
        prepMinutes: 22,
        servingSize: "4 dilim",
        ingredients: ["baklava yufkasi", "antep fistigi", "tereyagi", "serbet"],
        allergens: ["gluten", "sut", "kabuklu yemis"],
      },
    ],
  },
  {
    email: "satici.izmirsofrasi4@coziyoo.local",
    displayName: "izmirsofrasi_tr_4",
    fullName: "Elif Aydin",
    profileImageUrl: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=400&q=80",
    foods: [
      {
        categoryTr: "Deniz Urunu",
        categoryEn: "Seafood",
        name: "Levrek Izgara",
        summary: "Roka salatasi ve limon sos ile",
        description: "TR-SEED: Gunluk levrek fileto, izgara ve zeytinyagli garnitur ile servis edilir.",
        recipe: "Levrek zeytinyagi ile marine edilip izgara edilir.",
        price: 312.0,
        imageUrl: "https://images.unsplash.com/photo-1612874742237-6526221588e3?auto=format&fit=crop&w=900&q=80",
        stock: 20,
        prepMinutes: 28,
        servingSize: "1 porsiyon",
        ingredients: ["levrek", "zeytinyagi", "roka", "limon"],
        allergens: ["balik"],
      },
      {
        categoryTr: "Meze",
        categoryEn: "Appetizer",
        name: "Zeytinyagli Yaprak Sarma",
        summary: "Limonlu ve soguk servis",
        description: "TR-SEED: Ince yapraklara sarilmis pirinclı zeytinyagli sarma.",
        recipe: "Ic harci hazirlanir, yapraklara sarilir ve kisik ateste pisirilir.",
        price: 129.5,
        imageUrl: "https://images.unsplash.com/photo-1611584186769-0a53b5f7f350?auto=format&fit=crop&w=900&q=80",
        stock: 40,
        prepMinutes: 24,
        servingSize: "10 adet",
        ingredients: ["asma yapragi", "pirinc", "sogan", "zeytinyagi"],
        allergens: [],
      },
    ],
  },
  {
    email: "satici.karakoymutfagi5@coziyoo.local",
    displayName: "karakoymutfagi_tr_5",
    fullName: "Can Arslan",
    profileImageUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80",
    foods: [
      {
        categoryTr: "Pide",
        categoryEn: "Pide",
        name: "Kasarli Sucuklu Pide",
        summary: "Odun firininda pisirilmis kapali pide",
        description: "TR-SEED: Kasar peyniri ve sucukla odun firininda hazirlanir.",
        recipe: "Hamur acilir, ic malzeme eklenir ve yuksek isi firinda pisirilir.",
        price: 214.0,
        imageUrl: "https://images.unsplash.com/photo-1590947132387-155cc02f3212?auto=format&fit=crop&w=900&q=80",
        stock: 34,
        prepMinutes: 26,
        servingSize: "1 adet",
        ingredients: ["un", "kasar peyniri", "sucuk", "maya"],
        allergens: ["gluten", "sut"],
      },
      {
        categoryTr: "Ana Yemek",
        categoryEn: "Main Dish",
        name: "Tavuklu Pilav",
        summary: "Nohut ve tursu ile sokak lezzeti",
        description: "TR-SEED: Tereyagli pirinc pilavi uzerinde didiklenmis tavuk ile servis edilir.",
        recipe: "Tavuk haslanir, pilav tereyagi ile demlenir ve birlikte servis edilir.",
        price: 119.0,
        imageUrl: "https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=900&q=80",
        stock: 60,
        prepMinutes: 16,
        servingSize: "1 porsiyon",
        ingredients: ["pirinc", "tavuk", "tereyagi", "nohut"],
        allergens: ["sut"],
      },
    ],
  },
];

async function ensureCategory(nameTr: string, nameEn: string, sortOrder: number): Promise<string> {
  const existing = await pool.query<{ id: string }>("SELECT id FROM categories WHERE lower(name_tr) = lower($1) LIMIT 1", [nameTr]);
  if ((existing.rowCount ?? 0) > 0) return existing.rows[0].id;

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO categories (name_tr, name_en, sort_order, is_active)
     VALUES ($1, $2, $3, TRUE)
     RETURNING id`,
    [nameTr, nameEn, sortOrder]
  );
  return inserted.rows[0].id;
}

async function main() {
  const password = process.env.SEED_SELLER_PASSWORD ?? "Seller12345!";
  const passwordHash = await hashPassword(password);

  await pool.query("BEGIN");
  try {
    const categoryCache = new Map<string, string>();
    let createdUsers = 0;
    let createdFoods = 0;

    for (let sellerIndex = 0; sellerIndex < sellers.length; sellerIndex += 1) {
      const seller = sellers[sellerIndex];
      const displayNameNormalized = normalizeDisplayName(seller.displayName);

      const userResult = await pool.query<{ id: string }>(
        `INSERT INTO users (
          email, password_hash, display_name, display_name_normalized, full_name,
          profile_image_url, user_type, is_active, country_code, language
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'seller', TRUE, 'TR', 'tr')
        ON CONFLICT (email)
        DO UPDATE SET
          password_hash = EXCLUDED.password_hash,
          display_name = EXCLUDED.display_name,
          display_name_normalized = EXCLUDED.display_name_normalized,
          full_name = EXCLUDED.full_name,
          profile_image_url = EXCLUDED.profile_image_url,
          user_type = 'seller',
          is_active = TRUE,
          country_code = 'TR',
          language = 'tr',
          updated_at = now()
        RETURNING id`,
        [seller.email.toLowerCase(), passwordHash, seller.displayName, displayNameNormalized, seller.fullName, seller.profileImageUrl]
      );
      const sellerId = userResult.rows[0].id;
      createdUsers += 1;

      await pool.query(
        `INSERT INTO seller_compliance_profiles (seller_id, country_code, status, approved_at, updated_at)
         VALUES ($1, 'TR', 'approved', now(), now())
         ON CONFLICT (seller_id)
         DO UPDATE SET
           country_code = EXCLUDED.country_code,
           status = EXCLUDED.status,
           approved_at = EXCLUDED.approved_at,
           updated_at = EXCLUDED.updated_at`,
        [sellerId]
      );

      await pool.query("DELETE FROM foods WHERE seller_id = $1 AND description LIKE 'TR-SEED:%'", [sellerId]);

      for (const food of seller.foods) {
        const categoryKey = `${food.categoryTr}|${food.categoryEn}`;
        let categoryId = categoryCache.get(categoryKey);
        if (!categoryId) {
          categoryId = await ensureCategory(food.categoryTr, food.categoryEn, sellerIndex + 1);
          categoryCache.set(categoryKey, categoryId);
        }

        await pool.query(
          `INSERT INTO foods (
            seller_id, category_id, name, card_summary, description, recipe, country_code,
            price, image_url, ingredients_json, allergens_json, preparation_time_minutes,
            serving_size, delivery_fee, max_delivery_distance_km, delivery_options_json,
            current_stock, daily_stock, is_available, is_active, rating, review_count, favorite_count
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, 'TR', $7, $8, $9::jsonb, $10::jsonb, $11, $12,
            25.00, 8.00, $13::jsonb, $14, $15, TRUE, TRUE, 4.5, 0, 0
          )`,
          [
            sellerId,
            categoryId,
            food.name,
            food.summary,
            food.description,
            food.recipe,
            food.price,
            food.imageUrl,
            JSON.stringify(food.ingredients),
            JSON.stringify(food.allergens),
            food.prepMinutes,
            food.servingSize,
            JSON.stringify(["pickup", "delivery"]),
            food.stock,
            food.stock,
          ]
        );
        createdFoods += 1;
      }
    }

    await pool.query("COMMIT");
    console.log(`TR seller seed tamamlandi. Satici: ${createdUsers}, Yemek: ${createdFoods}`);
    console.log(`Varsayilan satici sifresi: ${password}`);
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}

main()
  .catch((error) => {
    console.error("TR seller seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
