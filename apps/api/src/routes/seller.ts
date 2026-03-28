import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { pool } from "../db/client.js";
import { resolveActorRole } from "../middleware/app-role.js";
import { requireAuth } from "../middleware/auth.js";
import { getSellerOperateGate } from "../services/seller-operability.js";
const WorkingHourSchema = z.object({
  day: z.string().min(2).max(20),
  open: z.string().min(4).max(10),
  close: z.string().min(4).max(10),
  enabled: z.boolean().optional(),
});

const SellerProfileUpdateSchema = z.object({
  kitchenTitle: z.string().min(3).max(120).optional(),
  kitchenDescription: z.string().min(10).max(1000).optional(),
  kitchenSpecialties: z.array(z.string().min(1).max(80)).max(20).optional(),
  deliveryRadiusKm: z.number().min(0.5).max(50).optional(),
  workingHours: z.array(WorkingHourSchema).max(14).optional(),
  submitForReview: z.boolean().optional(),
});

const SellerFoodCreateSchema = z.object({
  name: z.string().min(2).max(120),
  cardSummary: z.string().max(240).optional(),
  description: z.string().max(3000).optional(),
  recipe: z.string().max(5000).optional(),
  ingredients: z.array(z.string().min(1).max(200)).max(60).optional(),
  allergens: z.array(z.string().min(1).max(120)).max(40).optional(),
  cuisine: z.string().min(1).max(120).optional(),
  price: z.number().min(1).max(100000),
  deliveryFee: z.number().min(0).max(100000).optional(),
  deliveryOptions: z.object({
    pickup: z.boolean(),
    delivery: z.boolean(),
  }).optional(),
  preparationTimeMinutes: z.number().int().min(1).max(1440).optional(),
  imageUrl: z.string().url().optional(),
  imageUrls: z.array(z.string().url()).max(5).optional(),
  isActive: z.boolean().optional(),
  categoryId: z.string().uuid().optional(),
});

const SellerFoodUpdateSchema = SellerFoodCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "At least one field required" },
);

const SellerFoodStatusSchema = z.object({
  isActive: z.boolean(),
});

const SellerFoodImageSchema = z.object({
  imageUrl: z.string().url().optional(),
  dataBase64: z.string().min(16).optional(),
  contentType: z.string().min(3).max(80).optional(),
}).refine(
  (value) => Boolean(value.imageUrl || value.dataBase64),
  { message: "imageUrl or dataBase64 is required" },
);

export const sellerRouter = Router();
sellerRouter.use(requireAuth("app"));

function ensureSellerRole(req: Request, res: Response): boolean {
  const actorRole = resolveActorRole(req);
  if (actorRole !== "seller") {
    res.status(403).json({
      error: {
        code: "ROLE_NOT_ALLOWED",
        message: "Seller role required. For both-role users, set x-actor-role: seller.",
      },
    });
    return false;
  }
  return true;
}

function normalizeImageUrls(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const values = input
    .map((item) => String(item ?? "").trim())
    .filter((item) => /^https?:\/\//i.test(item) || /^data:/i.test(item));
  return values.slice(0, 5);
}

function normalizeDeliveryOptions(input: unknown): { pickup: boolean; delivery: boolean } | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const pickup = Boolean(raw.pickup);
  const delivery = Boolean(raw.delivery);
  return { pickup, delivery };
}

function computeSellerProfileStatus(input: {
  profileStatus: "incomplete" | "pending_review" | "active";
  kitchenTitle: string | null;
  kitchenDescription: string | null;
  deliveryRadiusKm: number | null;
  workingHours: unknown;
  phone: string | null;
  hasDefaultAddress: boolean;
  submitForReview: boolean;
}): "incomplete" | "pending_review" | "active" {
  const hasWorkingHours = Array.isArray(input.workingHours) && input.workingHours.length > 0;
  const isComplete = Boolean(
    input.kitchenTitle?.trim() &&
      input.kitchenDescription?.trim() &&
      input.deliveryRadiusKm &&
      hasWorkingHours &&
      input.phone?.trim() &&
      input.hasDefaultAddress,
  );
  if (!isComplete) return "incomplete";
  if (input.profileStatus === "active") return "active";
  if (input.submitForReview) return "pending_review";
  return input.profileStatus === "pending_review" ? "pending_review" : "incomplete";
}

sellerRouter.get("/profile", async (req, res) => {
  if (!ensureSellerRole(req, res)) return;
  const userId = req.auth!.userId;
  try {
    const [userResult, addressResult] = await Promise.all([
      pool.query<{
        id: string;
        display_name: string | null;
        username: string | null;
        email: string;
        profile_image_url: string | null;
        phone: string | null;
        kitchen_title: string | null;
        kitchen_description: string | null;
        kitchen_specialties: unknown;
        delivery_radius_km: string | null;
        working_hours_json: unknown;
        seller_profile_status: "incomplete" | "pending_review" | "active";
      }>(
        `SELECT id, display_name, username, email, profile_image_url, phone, kitchen_title, kitchen_description, kitchen_specialties, delivery_radius_km::text, working_hours_json, seller_profile_status
         FROM users
         WHERE id = $1 AND is_active = TRUE`,
        [userId],
      ),
      pool.query<{ id: string; title: string; address_line: string; is_default: boolean }>(
        `SELECT id::text, title, address_line, is_default
         FROM user_addresses
         WHERE user_id = $1
         ORDER BY is_default DESC, updated_at DESC`,
        [userId],
      ),
    ]);

    if ((userResult.rowCount ?? 0) === 0) {
      return res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "User not found" } });
    }

    const row = userResult.rows[0];
    const defaultAddress = addressResult.rows.find((addr) => addr.is_default) ?? null;
    const hasDefaultAddress = Boolean(defaultAddress);
    const profileStatus = computeSellerProfileStatus({
      profileStatus: row.seller_profile_status ?? "incomplete",
      kitchenTitle: row.kitchen_title,
      kitchenDescription: row.kitchen_description,
      deliveryRadiusKm: row.delivery_radius_km ? Number(row.delivery_radius_km) : null,
      workingHours: row.working_hours_json,
      phone: row.phone,
      hasDefaultAddress,
      submitForReview: false,
    });
    const operateGate = await getSellerOperateGate(pool, userId);

    return res.json({
      data: {
        sellerId: row.id,
        displayName: row.display_name,
        username: row.username,
        email: row.email,
        profileImageUrl: row.profile_image_url,
        phone: row.phone,
        kitchenTitle: row.kitchen_title,
        kitchenDescription: row.kitchen_description,
        kitchenSpecialties: Array.isArray(row.kitchen_specialties) ? row.kitchen_specialties : [],
        deliveryRadiusKm: row.delivery_radius_km ? Number(row.delivery_radius_km) : null,
        workingHours: Array.isArray(row.working_hours_json) ? row.working_hours_json : [],
        status: profileStatus,
        defaultAddress: defaultAddress
          ? { id: defaultAddress.id, title: defaultAddress.title, addressLine: defaultAddress.address_line }
          : null,
        requirements: {
          hasPhone: Boolean(row.phone?.trim()),
          hasDefaultAddress,
          hasKitchenTitle: Boolean(row.kitchen_title?.trim()),
          hasKitchenDescription: Boolean(row.kitchen_description?.trim()),
          hasDeliveryRadius: Boolean(row.delivery_radius_km),
          hasWorkingHours: Array.isArray(row.working_hours_json) && row.working_hours_json.length > 0,
          complianceRequiredCount: operateGate?.complianceRequiredCount ?? 0,
          complianceUploadedRequiredCount: operateGate?.complianceUploadedRequiredCount ?? 0,
          complianceMissingRequiredCount: operateGate?.complianceMissingRequiredCount ?? 0,
          canOperate: operateGate?.canOperate ?? false,
        },
      },
    });
  } catch (error) {
    console.error("[seller] profile get error:", error);
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to load seller profile" } });
  }
});

sellerRouter.put("/profile", async (req, res) => {
    if (!ensureSellerRole(req, res)) return;
    const parsed = SellerProfileUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
    }
    const input = parsed.data;
    const userId = req.auth!.userId;

    try {
      const addressResult = await pool.query<{ has_default: boolean }>(
        `SELECT EXISTS (
          SELECT 1 FROM user_addresses WHERE user_id = $1 AND is_default = TRUE
        ) AS has_default`,
        [userId],
      );
      const hasDefaultAddress = Boolean(addressResult.rows[0]?.has_default);

      const currentResult = await pool.query<{
        kitchen_title: string | null;
        kitchen_description: string | null;
        delivery_radius_km: string | null;
        working_hours_json: unknown;
        phone: string | null;
        seller_profile_status: "incomplete" | "pending_review" | "active";
      }>(
        `SELECT kitchen_title, kitchen_description, delivery_radius_km::text, working_hours_json, phone, seller_profile_status
         FROM users
         WHERE id = $1 FOR UPDATE`,
        [userId],
      );
      if ((currentResult.rowCount ?? 0) === 0) {
        return res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "User not found" } });
      }
      const current = currentResult.rows[0];

      const kitchenTitle = input.kitchenTitle ?? current.kitchen_title;
      const kitchenDescription = input.kitchenDescription ?? current.kitchen_description;
      const deliveryRadiusKm = input.deliveryRadiusKm ?? (current.delivery_radius_km ? Number(current.delivery_radius_km) : null);
      const workingHours = input.workingHours ?? (Array.isArray(current.working_hours_json) ? current.working_hours_json : []);
      const nextStatus = computeSellerProfileStatus({
        profileStatus: current.seller_profile_status ?? "incomplete",
        kitchenTitle,
        kitchenDescription,
        deliveryRadiusKm,
        workingHours,
        phone: current.phone,
        hasDefaultAddress,
        submitForReview: Boolean(input.submitForReview),
      });

      const updated = await pool.query<{
        kitchen_title: string | null;
        kitchen_description: string | null;
        kitchen_specialties: unknown;
        delivery_radius_km: string | null;
        working_hours_json: unknown;
        seller_profile_status: "incomplete" | "pending_review" | "active";
      }>(
        `UPDATE users
         SET kitchen_title = COALESCE($2, kitchen_title),
             kitchen_description = COALESCE($3, kitchen_description),
             delivery_radius_km = COALESCE($4::numeric, delivery_radius_km),
             working_hours_json = COALESCE($5::jsonb, working_hours_json),
             kitchen_specialties = COALESCE($7::jsonb, kitchen_specialties),
             seller_profile_status = $6,
             updated_at = now()
         WHERE id = $1
         RETURNING kitchen_title, kitchen_description, kitchen_specialties, delivery_radius_km::text, working_hours_json, seller_profile_status`,
        [
          userId,
          input.kitchenTitle ?? null,
          input.kitchenDescription ?? null,
          input.deliveryRadiusKm ?? null,
          input.workingHours ? JSON.stringify(input.workingHours) : null,
          nextStatus,
          input.kitchenSpecialties ? JSON.stringify(input.kitchenSpecialties) : null,
        ],
      );

      return res.json({
        data: {
          kitchenTitle: updated.rows[0].kitchen_title,
          kitchenDescription: updated.rows[0].kitchen_description,
          kitchenSpecialties: Array.isArray(updated.rows[0].kitchen_specialties) ? updated.rows[0].kitchen_specialties : [],
          deliveryRadiusKm: updated.rows[0].delivery_radius_km ? Number(updated.rows[0].delivery_radius_km) : null,
          workingHours: Array.isArray(updated.rows[0].working_hours_json) ? updated.rows[0].working_hours_json : [],
          status: updated.rows[0].seller_profile_status,
        },
      });
    } catch (error) {
      console.error("[seller] profile update error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to update seller profile" } });
    }
});

sellerRouter.get("/foods", async (req, res) => {
  if (!ensureSellerRole(req, res)) return;
  const userId = req.auth!.userId;
  try {
    const result = await pool.query(
      `SELECT
         f.id::text,
         f.category_id::text AS category_id,
         c.name_tr AS category_name,
         f.name,
         f.card_summary,
         f.description,
         f.recipe,
         f.cuisine,
         f.price::text,
         f.delivery_fee::text AS delivery_fee,
         f.delivery_options_json,
         f.image_url,
         f.image_urls_json,
         f.ingredients_json,
         f.allergens_json,
         f.preparation_time_minutes,
         f.is_active,
         f.created_at::text,
         f.updated_at::text,
         COALESCE((
           SELECT SUM(pl.quantity_available)::int
           FROM production_lots pl
           WHERE pl.food_id = f.id
             AND pl.status IN ('open', 'active')
             AND pl.quantity_available > 0
             AND (pl.sale_starts_at IS NULL OR pl.sale_starts_at <= now())
             AND (pl.sale_ends_at IS NULL OR pl.sale_ends_at > now())
         ), 0)::int AS stock
       FROM foods f
       LEFT JOIN categories c ON c.id = f.category_id
       WHERE f.seller_id = $1
       ORDER BY f.updated_at DESC`,
      [userId],
    );
    return res.json({
      data: result.rows.map((row) => ({
        id: row.id,
        categoryId: row.category_id ?? null,
        categoryName: row.category_name ?? null,
        name: row.name,
        cardSummary: row.card_summary,
        description: row.description,
        recipe: row.recipe,
        cuisine: row.cuisine ?? null,
        price: Number(row.price),
        deliveryFee: row.delivery_fee != null ? Number(row.delivery_fee) : 0,
        deliveryOptions: normalizeDeliveryOptions(row.delivery_options_json),
        imageUrl: row.image_url,
        imageUrls: normalizeImageUrls(row.image_urls_json),
        ingredients: Array.isArray(row.ingredients_json) ? row.ingredients_json : [],
        allergens: Array.isArray(row.allergens_json) ? row.allergens_json : [],
        preparationTimeMinutes: row.preparation_time_minutes,
        isActive: Boolean(row.is_active),
        stock: Number(row.stock ?? 0),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error) {
    console.error("[seller] foods list error:", error);
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to list foods" } });
  }
});

sellerRouter.get("/categories", async (req, res) => {
  if (!ensureSellerRole(req, res)) return;
  try {
    const result = await pool.query<{
      id: string;
      name_tr: string | null;
      name_en: string | null;
      slug: string | null;
      sort_order: number | null;
    }>(
      `SELECT
         id::text,
         name_tr,
         name_en,
         slug,
         sort_order
       FROM categories
       ORDER BY sort_order ASC NULLS LAST, name_tr ASC, name_en ASC`,
    );

    return res.json({
      data: result.rows.map((row) => ({
        id: row.id,
        nameTr: row.name_tr,
        nameEn: row.name_en,
        slug: row.slug,
      })),
    });
  } catch (error) {
    console.error("[seller] categories list error:", error);
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to list categories" } });
  }
});

sellerRouter.post("/foods", async (req, res) => {
    if (!ensureSellerRole(req, res)) return;
    const parsed = SellerFoodCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
    }
    const input = parsed.data;
    try {
      const created = await pool.query<{ id: string }>(
        `INSERT INTO foods
           (seller_id, category_id, name, card_summary, description, recipe, cuisine, price, delivery_fee, delivery_options_json, image_url, image_urls_json, ingredients_json, allergens_json, preparation_time_minutes, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::jsonb, $13::jsonb, $14::jsonb, $15, $16, now(), now())
         RETURNING id::text`,
        [
          req.auth!.userId,
          input.categoryId ?? null,
          input.name.trim(),
          input.cardSummary?.trim() ?? null,
          input.description?.trim() ?? null,
          input.recipe?.trim() ?? null,
          input.cuisine?.trim() ?? null,
          input.price,
          input.deliveryFee ?? 0,
          JSON.stringify(input.deliveryOptions ?? { pickup: true, delivery: true }),
          input.imageUrls?.[0] ?? input.imageUrl ?? null,
          JSON.stringify((input.imageUrls ?? (input.imageUrl ? [input.imageUrl] : [])).slice(0, 5)),
          JSON.stringify(input.ingredients ?? []),
          JSON.stringify(input.allergens ?? []),
          input.preparationTimeMinutes ?? null,
          input.isActive ?? true,
        ],
      );
      return res.status(201).json({ data: { foodId: created.rows[0].id } });
    } catch (error) {
      console.error("[seller] food create error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to create food" } });
    }
});

sellerRouter.patch("/foods/:foodId", async (req, res) => {
    if (!ensureSellerRole(req, res)) return;
    const foodId = String(req.params.foodId ?? "");
    if (!z.string().uuid().safeParse(foodId).success) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid food id" } });
    }
    const parsed = SellerFoodUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
    }
    const input = parsed.data;

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (input.categoryId !== undefined) {
      setClauses.push(`category_id = $${idx++}`);
      values.push(input.categoryId ?? null);
    }
    if (input.name !== undefined) {
      setClauses.push(`name = $${idx++}`);
      values.push(input.name.trim());
    }
    if (input.cardSummary !== undefined) {
      setClauses.push(`card_summary = $${idx++}`);
      values.push(input.cardSummary?.trim() ?? null);
    }
    if (input.description !== undefined) {
      setClauses.push(`description = $${idx++}`);
      values.push(input.description?.trim() ?? null);
    }
    if (input.recipe !== undefined) {
      setClauses.push(`recipe = $${idx++}`);
      values.push(input.recipe?.trim() ?? null);
    }
    if (input.cuisine !== undefined) {
      setClauses.push(`cuisine = $${idx++}`);
      values.push(input.cuisine?.trim() ?? null);
    }
    if (input.price !== undefined) {
      setClauses.push(`price = $${idx++}`);
      values.push(input.price);
    }
    if (input.deliveryFee !== undefined) {
      setClauses.push(`delivery_fee = $${idx++}`);
      values.push(input.deliveryFee ?? 0);
    }
    if (input.deliveryOptions !== undefined) {
      setClauses.push(`delivery_options_json = $${idx++}::jsonb`);
      values.push(JSON.stringify(input.deliveryOptions ?? { pickup: true, delivery: true }));
    }
    if (input.imageUrl !== undefined) {
      setClauses.push(`image_url = $${idx++}`);
      values.push(input.imageUrl ?? null);
      if (input.imageUrls === undefined) {
        setClauses.push(`image_urls_json = CASE
          WHEN $${idx}::text IS NULL OR btrim($${idx}::text) = '' THEN '[]'::jsonb
          WHEN jsonb_typeof(image_urls_json) = 'array' THEN jsonb_set(image_urls_json, '{0}', to_jsonb($${idx}::text), true)
          ELSE jsonb_build_array($${idx}::text)
        END`);
        values.push(input.imageUrl ?? null);
        idx += 1;
      }
    }
    if (input.imageUrls !== undefined) {
      const normalizedImageUrls = (input.imageUrls ?? []).slice(0, 5);
      setClauses.push(`image_urls_json = $${idx++}::jsonb`);
      values.push(JSON.stringify(normalizedImageUrls));
      if (input.imageUrl === undefined) {
        setClauses.push(`image_url = $${idx++}`);
        values.push(normalizedImageUrls[0] ?? null);
      }
    }
    if (input.ingredients !== undefined) {
      setClauses.push(`ingredients_json = $${idx++}::jsonb`);
      values.push(JSON.stringify(input.ingredients ?? []));
    }
    if (input.allergens !== undefined) {
      setClauses.push(`allergens_json = $${idx++}::jsonb`);
      values.push(JSON.stringify(input.allergens ?? []));
    }
    if (input.preparationTimeMinutes !== undefined) {
      setClauses.push(`preparation_time_minutes = $${idx++}`);
      values.push(input.preparationTimeMinutes ?? null);
    }
    if (input.isActive !== undefined) {
      setClauses.push(`is_active = $${idx++}`);
      values.push(input.isActive);
    }
    setClauses.push(`updated_at = now()`);

    values.push(foodId, req.auth!.userId);
    try {
      const updated = await pool.query<{ id: string }>(
        `UPDATE foods
         SET ${setClauses.join(", ")}
         WHERE id = $${idx++} AND seller_id = $${idx}
         RETURNING id::text`,
        values,
      );
      if ((updated.rowCount ?? 0) === 0) {
        return res.status(404).json({ error: { code: "FOOD_NOT_FOUND", message: "Food not found in seller scope" } });
      }
      return res.json({ data: { foodId: updated.rows[0].id } });
    } catch (error) {
      console.error("[seller] food update error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to update food" } });
    }
});

sellerRouter.patch("/foods/:foodId/status", async (req, res) => {
  if (!ensureSellerRole(req, res)) return;
  const foodId = String(req.params.foodId ?? "");
  if (!z.string().uuid().safeParse(foodId).success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid food id" } });
  }
  const parsed = SellerFoodStatusSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  try {
    const updated = await pool.query<{ id: string; is_active: boolean }>(
      `UPDATE foods
       SET is_active = $3, updated_at = now()
       WHERE id = $1 AND seller_id = $2
       RETURNING id::text, is_active`,
      [foodId, req.auth!.userId, parsed.data.isActive],
    );
    if ((updated.rowCount ?? 0) === 0) {
      return res.status(404).json({ error: { code: "FOOD_NOT_FOUND", message: "Food not found in seller scope" } });
    }
    return res.json({ data: { foodId: updated.rows[0].id, isActive: updated.rows[0].is_active } });
  } catch (error) {
    console.error("[seller] food status error:", error);
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to update food status" } });
  }
});

sellerRouter.post("/foods/:foodId/image", async (req, res) => {
  if (!ensureSellerRole(req, res)) return;
  const foodId = String(req.params.foodId ?? "");
  if (!z.string().uuid().safeParse(foodId).success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid food id" } });
  }
  const parsed = SellerFoodImageSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;
  const imageUrl = input.imageUrl
    ? input.imageUrl
    : `data:${input.contentType ?? "image/jpeg"};base64,${input.dataBase64 ?? ""}`;

  try {
    const updated = await pool.query<{ id: string; image_url: string | null }>(
      `UPDATE foods
       SET image_url = $3,
           image_urls_json = CASE
             WHEN jsonb_typeof(image_urls_json) = 'array' THEN jsonb_set(
               image_urls_json,
               '{0}',
               to_jsonb($3::text),
               true
             )
             ELSE jsonb_build_array($3::text)
           END,
           updated_at = now()
       WHERE id = $1 AND seller_id = $2
       RETURNING id::text, image_url`,
      [foodId, req.auth!.userId, imageUrl],
    );
    if ((updated.rowCount ?? 0) === 0) {
      return res.status(404).json({ error: { code: "FOOD_NOT_FOUND", message: "Food not found in seller scope" } });
    }
    return res.json({ data: { foodId: updated.rows[0].id, imageUrl: updated.rows[0].image_url } });
  } catch (error) {
    console.error("[seller] food image error:", error);
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to update food image" } });
  }
});

sellerRouter.post("/foods/:foodId/image/presign", async (_req, res) =>
  res.status(501).json({
    error: { code: "NOT_IMPLEMENTED", message: "Presign upload is not enabled yet for seller foods" },
  }));

sellerRouter.get("/directory", async (_req, res) => {
  try {
    const result = await pool.query<{
      id: string;
      display_name: string | null;
      kitchen_title: string | null;
      kitchen_description: string | null;
      delivery_radius_km: string | null;
      seller_profile_status: "incomplete" | "pending_review" | "active";
      created_at: string;
    }>(
      `SELECT id::text, display_name, kitchen_title, kitchen_description,
              delivery_radius_km::text, seller_profile_status, created_at::text
       FROM users
       WHERE user_type IN ('seller', 'both')
         AND is_active = TRUE
       ORDER BY display_name ASC`,
    );
    return res.json({
      data: result.rows.map((row) => ({
        id: row.id,
        displayName: row.display_name,
        kitchenTitle: row.kitchen_title,
        kitchenDescription: row.kitchen_description,
        deliveryRadiusKm: row.delivery_radius_km ? Number(row.delivery_radius_km) : null,
        status: row.seller_profile_status ?? "incomplete",
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    console.error("[seller] directory error:", error);
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to load seller directory" } });
  }
});
