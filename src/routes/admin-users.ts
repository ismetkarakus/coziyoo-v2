import { Router, type Response } from "express";
import { z } from "zod";
import { pool } from "../db/client.js";
import { requireSuperAdmin } from "../middleware/admin-rbac.js";
import { requireAuth } from "../middleware/auth.js";
import { writeAdminAudit } from "../services/admin-audit.js";
import { normalizeDisplayName } from "../utils/normalize.js";
import { hashPassword } from "../utils/security.js";

const AppUserListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.enum(["createdAt", "updatedAt", "email", "displayName", "userType", "status"]).default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  status: z.enum(["active", "disabled"]).optional(),
  userType: z.enum(["buyer", "seller", "both"]).optional(),
  audience: z.enum(["buyer", "seller"]).optional(),
  search: z.string().min(1).max(120).optional(),
});

const AdminUserListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.enum(["createdAt", "updatedAt", "email", "role", "status"]).default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  status: z.enum(["active", "disabled"]).optional(),
  role: z.enum(["admin", "super_admin"]).optional(),
  search: z.string().min(1).max(120).optional(),
});

const CreateAppUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  displayName: z.string().min(3).max(40),
  fullName: z.string().min(1).max(120).optional(),
  profileImageUrl: z.string().url().max(2048).optional(),
  userType: z.enum(["buyer", "seller", "both"]),
  countryCode: z.string().min(2).max(3).optional(),
  language: z.string().min(2).max(10).optional(),
  isActive: z.boolean().optional(),
});

const UpdateAppUserSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(8).max(128).optional(),
  displayName: z.string().min(3).max(40).optional(),
  fullName: z.string().min(1).max(120).nullable().optional(),
  profileImageUrl: z.string().url().max(2048).nullable().optional(),
  userType: z.enum(["buyer", "seller", "both"]).optional(),
  countryCode: z.string().min(2).max(3).nullable().optional(),
  language: z.string().min(2).max(10).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: "At least one field required" });

const UpdateAppUserStatusSchema = z.object({
  status: z.enum(["active", "disabled"]),
});

const UpdateAppUserRoleSchema = z.object({
  role: z.enum(["buyer", "seller", "both"]),
});

const CreateAdminUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  role: z.enum(["admin", "super_admin"]),
  isActive: z.boolean().optional(),
});

const UpdateAdminUserSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(8).max(128).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: "At least one field required" });

const UpdateAdminUserStatusSchema = z.object({
  status: z.enum(["active", "disabled"]),
});

const UpdateAdminUserRoleSchema = z.object({
  role: z.enum(["admin", "super_admin"]),
});

const UuidParamSchema = z.object({
  id: z.string().uuid(),
});

const BuyerListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(10),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});
const SellerFoodsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});
const InvestigationSearchQuerySchema = z.object({
  q: z.string().min(2).max(120),
  limit: z.coerce.number().int().positive().max(100).default(40),
});

const appSortFieldMap: Record<AppUserListQuery["sortBy"], string> = {
  createdAt: "u.created_at",
  updatedAt: "u.updated_at",
  email: "u.email",
  displayName: "u.display_name",
  userType: "u.user_type",
  status: "u.is_active",
};

const adminSortFieldMap: Record<AdminUserListQuery["sortBy"], string> = {
  createdAt: "a.created_at",
  updatedAt: "a.updated_at",
  email: "a.email",
  role: "a.role",
  status: "a.is_active",
};

type AppUserListQuery = z.infer<typeof AppUserListQuerySchema>;
type AdminUserListQuery = z.infer<typeof AdminUserListQuerySchema>;

export const adminUserManagementRouter = Router();

async function ensureBuyerUser(userId: string) {
  const user = await pool.query<{ id: string; user_type: "buyer" | "seller" | "both" }>(
    "SELECT id, user_type FROM users WHERE id = $1",
    [userId]
  );
  if ((user.rowCount ?? 0) === 0) {
    return { ok: false as const, status: 404, code: "USER_NOT_FOUND", message: "User not found" };
  }
  const row = user.rows[0];
  if (row.user_type !== "buyer" && row.user_type !== "both") {
    return { ok: false as const, status: 409, code: "USER_NOT_BUYER", message: "User is not a buyer account" };
  }
  return { ok: true as const, user: row };
}

async function ensureSellerUser(userId: string) {
  const user = await pool.query<{ id: string; user_type: "buyer" | "seller" | "both" }>(
    "SELECT id, user_type FROM users WHERE id = $1",
    [userId]
  );
  if ((user.rowCount ?? 0) === 0) {
    return { ok: false as const, status: 404, code: "USER_NOT_FOUND", message: "User not found" };
  }
  const row = user.rows[0];
  if (row.user_type !== "seller" && row.user_type !== "both") {
    return { ok: false as const, status: 409, code: "USER_NOT_SELLER", message: "User is not a seller account" };
  }
  return { ok: true as const, user: row };
}

adminUserManagementRouter.get("/investigations/search", requireAuth("admin"), async (req, res) => {
  const parsed = InvestigationSearchQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const needle = `%${input.q.toLowerCase()}%`;
  const rows = await pool.query<{
    food_id: string;
    food_name: string;
    card_summary: string | null;
    description: string | null;
    recipe: string | null;
    food_price: string;
    food_status: boolean;
    food_created_at: string;
    food_updated_at: string;
    seller_id: string;
    seller_name: string;
    seller_email: string;
    order_id: string | null;
    order_status: string | null;
    order_total_price: string | null;
    order_created_at: string | null;
    order_updated_at: string | null;
    order_requested_at: string | null;
    delivery_address_json: unknown;
    buyer_id: string | null;
    buyer_name: string | null;
    buyer_email: string | null;
    quantity: number | null;
    unit_price: string | null;
    line_total: string | null;
    payment_status: string | null;
    payment_provider: string | null;
    payment_updated_at: string | null;
  }>(
    `SELECT
       f.id::text AS food_id,
       f.name AS food_name,
       f.card_summary,
       f.description,
       f.recipe,
       f.price::text AS food_price,
       f.is_active AS food_status,
       f.created_at::text AS food_created_at,
       f.updated_at::text AS food_updated_at,
       s.id::text AS seller_id,
       s.display_name AS seller_name,
       s.email AS seller_email,
       o.id::text AS order_id,
       o.status AS order_status,
       o.total_price::text AS order_total_price,
       o.created_at::text AS order_created_at,
       o.updated_at::text AS order_updated_at,
       o.requested_at::text AS order_requested_at,
       o.delivery_address_json,
       b.id::text AS buyer_id,
       b.display_name AS buyer_name,
       b.email AS buyer_email,
       oi.quantity,
       oi.unit_price::text AS unit_price,
       oi.line_total::text AS line_total,
       pa.status AS payment_status,
       pa.provider AS payment_provider,
       pa.updated_at::text AS payment_updated_at
     FROM foods f
     JOIN users s ON s.id = f.seller_id
     LEFT JOIN order_items oi ON oi.food_id = f.id
     LEFT JOIN orders o ON o.id = oi.order_id
     LEFT JOIN users b ON b.id = o.buyer_id
     LEFT JOIN LATERAL (
       SELECT status, provider, updated_at
       FROM payment_attempts
       WHERE order_id = o.id
       ORDER BY updated_at DESC NULLS LAST, created_at DESC
       LIMIT 1
     ) pa ON TRUE
     WHERE
       lower(f.name) LIKE $1
       OR lower('FD-' || substring(f.id::text, 1, 8)) LIKE $1
       OR lower('FD-' || f.id::text) LIKE $1
     ORDER BY o.created_at DESC NULLS LAST, f.updated_at DESC
     LIMIT $2`,
    [needle, input.limit]
  );

  const grouped = new Map<
    string,
    {
      food: {
        id: string;
        code: string;
        name: string;
        cardSummary: string | null;
        description: string | null;
        recipe: string | null;
        price: number;
        status: "active" | "disabled";
        createdAt: string;
        updatedAt: string;
      };
      seller: {
        id: string;
        name: string;
        email: string;
      };
      incidents: Array<{
        orderId: string;
        orderNo: string;
        orderStatus: string;
        orderTotal: number;
        orderCreatedAt: string;
        orderUpdatedAt: string;
        orderRequestedAt: string | null;
        region: string | null;
        buyer: { id: string; name: string | null; email: string | null };
        item: { quantity: number; unitPrice: number; lineTotal: number };
        payment: { status: string | null; provider: string | null; updatedAt: string | null };
      }>;
    }
  >();

  for (const row of rows.rows) {
    const foodId = row.food_id;
    let entry = grouped.get(foodId);
    if (!entry) {
      entry = {
        food: {
          id: foodId,
          code: `FD-${foodId.slice(0, 8).toUpperCase()}`,
          name: row.food_name,
          cardSummary: row.card_summary,
          description: row.description,
          recipe: row.recipe,
          price: Number(row.food_price),
          status: row.food_status ? "active" : "disabled",
          createdAt: row.food_created_at,
          updatedAt: row.food_updated_at,
        },
        seller: {
          id: row.seller_id,
          name: row.seller_name,
          email: row.seller_email,
        },
        incidents: [],
      };
      grouped.set(foodId, entry);
    }

    if (!row.order_id) continue;
    const address = row.delivery_address_json && typeof row.delivery_address_json === "object"
      ? (row.delivery_address_json as Record<string, unknown>)
      : null;
    const regionParts = [address?.district, address?.city, address?.country]
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean);
    entry.incidents.push({
      orderId: row.order_id,
      orderNo: `#${row.order_id.slice(0, 8).toUpperCase()}`,
      orderStatus: row.order_status ?? "-",
      orderTotal: Number(row.order_total_price ?? 0),
      orderCreatedAt: row.order_created_at ?? row.order_updated_at ?? "",
      orderUpdatedAt: row.order_updated_at ?? row.order_created_at ?? "",
      orderRequestedAt: row.order_requested_at,
      region: regionParts.length > 0 ? regionParts.join(" / ") : null,
      buyer: {
        id: row.buyer_id ?? "",
        name: row.buyer_name,
        email: row.buyer_email,
      },
      item: {
        quantity: Number(row.quantity ?? 0),
        unitPrice: Number(row.unit_price ?? 0),
        lineTotal: Number(row.line_total ?? 0),
      },
      payment: {
        status: row.payment_status,
        provider: row.payment_provider,
        updatedAt: row.payment_updated_at,
      },
    });
  }

  return res.json({
    data: Array.from(grouped.values()),
  });
});

adminUserManagementRouter.get("/users", requireAuth("admin"), async (req, res) => {
  const parsed = AppUserListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "PAGINATION_INVALID", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const where: string[] = [];
  const params: unknown[] = [];

  if (input.status) {
    params.push(input.status === "active");
    where.push(`u.is_active = $${params.length}`);
  }

  if (input.userType) {
    params.push(input.userType);
    where.push(`u.user_type = $${params.length}`);
  } else if (input.audience === "buyer") {
    params.push("buyer");
    params.push("both");
    where.push(`u.user_type IN ($${params.length - 1}, $${params.length})`);
  } else if (input.audience === "seller") {
    params.push("seller");
    params.push("both");
    where.push(`u.user_type IN ($${params.length - 1}, $${params.length})`);
  }

  if (input.search) {
    params.push(`%${input.search.toLowerCase()}%`);
    where.push(
      `(lower(u.email) LIKE $${params.length}
        OR lower(u.display_name) LIKE $${params.length}
        OR EXISTS (
          SELECT 1
          FROM foods f_search
          WHERE f_search.seller_id = u.id
            AND (
              lower(f_search.name) LIKE $${params.length}
              OR lower('FD-' || f_search.id::text) LIKE $${params.length}
              OR lower('FD-' || substring(f_search.id::text, 1, 8)) LIKE $${params.length}
            )
        ))`
    );
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const offset = (input.page - 1) * input.pageSize;
  const sortField = appSortFieldMap[input.sortBy];
  const sortDir = input.sortDir === "asc" ? "ASC" : "DESC";

  const total = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM users u ${whereSql}`,
    params
  );

  const listParams = [...params, input.pageSize, offset];
  const list = await pool.query<{
    id: string;
    email: string;
    display_name: string;
    full_name: string | null;
    profile_image_url: string | null;
    user_type: "buyer" | "seller" | "both";
    is_active: boolean;
    country_code: string | null;
    language: string | null;
    created_at: string;
    updated_at: string;
    total_foods: number;
  }>(
    `SELECT
       u.id,
       u.email,
       u.display_name,
       u.full_name,
       u.profile_image_url,
       u.user_type,
       u.is_active,
       u.country_code,
       u.language,
       u.created_at::text,
       u.updated_at::text,
       COALESCE(food_stats.total_foods, 0)::int AS total_foods
     FROM users u
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS total_foods
       FROM foods f
       WHERE f.seller_id = u.id
     ) food_stats ON TRUE
     ${whereSql}
     ORDER BY ${sortField} ${sortDir}, u.id ${sortDir}
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  const totalCount = Number(total.rows[0].count);
  return res.json({
    data: list.rows.map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      fullName: row.full_name,
      profileImageUrl: row.profile_image_url,
      role: row.user_type,
      status: row.is_active ? "active" : "disabled",
      countryCode: row.country_code,
      language: row.language,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      totalFoods: Number(row.total_foods ?? 0),
    })),
    pagination: {
      mode: "offset",
      page: input.page,
      pageSize: input.pageSize,
      total: totalCount,
      totalPages: Math.ceil(totalCount / input.pageSize),
    },
  });
});

adminUserManagementRouter.get("/users/:id", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const user = await pool.query<{
    id: string;
    email: string;
    display_name: string;
    full_name: string | null;
    profile_image_url: string | null;
    user_type: "buyer" | "seller" | "both";
    is_active: boolean;
    country_code: string | null;
    language: string | null;
    created_at: string;
    updated_at: string;
    total_foods: number;
  }>(
    `SELECT
       id,
       email,
       display_name,
       full_name,
       profile_image_url,
       user_type,
       is_active,
       country_code,
       language,
       created_at::text,
       updated_at::text,
       (
         SELECT count(*)::int
         FROM foods f
         WHERE f.seller_id = users.id
       ) AS total_foods
     FROM users
     WHERE id = $1`,
    [params.data.id]
  );

  if ((user.rowCount ?? 0) === 0) {
    return res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "User not found" } });
  }

  const row = user.rows[0];
  return res.json({
    data: {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      fullName: row.full_name,
      profileImageUrl: row.profile_image_url,
      role: row.user_type,
      status: row.is_active ? "active" : "disabled",
      countryCode: row.country_code,
      language: row.language,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      totalFoods: Number(row.total_foods ?? 0),
    },
  });
});

adminUserManagementRouter.get("/users/:id/seller-foods", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const query = SellerFoodsQuerySchema.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: { code: "PAGINATION_INVALID", details: query.error.flatten() } });
  }

  const seller = await ensureSellerUser(params.data.id);
  if (!seller.ok) {
    return res.status(seller.status).json({ error: { code: seller.code, message: seller.message } });
  }

  const offset = (query.data.page - 1) * query.data.pageSize;
  const sortDir = query.data.sortDir === "asc" ? "ASC" : "DESC";

  const total = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM foods WHERE seller_id = $1",
    [params.data.id]
  );

  const rows = await pool.query<{
    id: string;
    name: string;
    card_summary: string | null;
    description: string | null;
    recipe: string | null;
    price: string;
    image_url: string | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT
       id,
       name,
       card_summary,
       description,
       recipe,
       price::text,
       image_url,
       is_active,
       created_at::text,
       updated_at::text
     FROM foods
     WHERE seller_id = $1
     ORDER BY updated_at ${sortDir}, id ${sortDir}
     LIMIT $2 OFFSET $3`,
    [params.data.id, query.data.pageSize, offset]
  );

  const totalCount = Number(total.rows[0]?.count ?? 0);
  return res.json({
    data: rows.rows.map((row) => ({
      id: row.id,
      name: row.name,
      code: `FD-${row.id.slice(0, 8).toUpperCase()}`,
      cardSummary: row.card_summary,
      description: row.description,
      recipe: row.recipe,
      price: Number(row.price),
      imageUrl: row.image_url,
      status: row.is_active ? "active" : "disabled",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    pagination: {
      mode: "offset",
      page: query.data.page,
      pageSize: query.data.pageSize,
      total: totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / query.data.pageSize)),
    },
  });
});

adminUserManagementRouter.get("/users/:id/buyer-orders", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const query = BuyerListQuerySchema.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: { code: "PAGINATION_INVALID", details: query.error.flatten() } });
  }

  const buyer = await ensureBuyerUser(params.data.id);
  if (!buyer.ok) {
    return res.status(buyer.status).json({ error: { code: buyer.code, message: buyer.message } });
  }

  const offset = (query.data.page - 1) * query.data.pageSize;
  const sortDir = query.data.sortDir === "asc" ? "ASC" : "DESC";

  const total = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM orders WHERE buyer_id = $1",
    [params.data.id]
  );

  const rows = await pool.query<{
    id: string;
    status: string;
    total_price: string;
    payment_completed: boolean;
    created_at: string;
    updated_at: string;
    payment_status: string | null;
    payment_provider: string | null;
    payment_updated_at: string | null;
    items_json: unknown;
  }>(
    `SELECT
       o.id,
       o.status,
       o.total_price::text,
       o.payment_completed,
       o.created_at::text,
       o.updated_at::text,
       pa.status AS payment_status,
       pa.provider AS payment_provider,
       pa.updated_at::text AS payment_updated_at,
       COALESCE(items.items_json, '[]'::jsonb) AS items_json
     FROM orders o
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(
         jsonb_build_object(
           'orderItemId', oi.id,
           'foodId', f.id,
           'name', f.name,
           'imageUrl', f.image_url,
           'quantity', oi.quantity,
           'unitPrice', oi.unit_price,
           'lineTotal', oi.line_total
         )
         ORDER BY oi.created_at ASC
       ) AS items_json
       FROM order_items oi
       JOIN foods f ON f.id = oi.food_id
       WHERE oi.order_id = o.id
     ) items ON TRUE
     LEFT JOIN LATERAL (
       SELECT status, provider, updated_at
       FROM payment_attempts
       WHERE order_id = o.id
       ORDER BY updated_at DESC NULLS LAST, created_at DESC
       LIMIT 1
     ) pa ON TRUE
     WHERE o.buyer_id = $1
     ORDER BY o.created_at ${sortDir}, o.id ${sortDir}
     LIMIT $2 OFFSET $3`,
    [params.data.id, query.data.pageSize, offset]
  );

  const totalCount = Number(total.rows[0]?.count ?? 0);
  return res.json({
    data: rows.rows.map((row) => ({
      orderId: row.id,
      orderNo: `#${row.id.slice(0, 8).toUpperCase()}`,
      status: row.status,
      totalAmount: Number(row.total_price),
      paymentCompleted: row.payment_completed,
      paymentStatus: row.payment_status ?? (row.payment_completed ? "succeeded" : "pending"),
      paymentProvider: row.payment_provider,
      paymentUpdatedAt: row.payment_updated_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      items: Array.isArray(row.items_json) ? row.items_json : [],
    })),
    pagination: {
      mode: "offset",
      page: query.data.page,
      pageSize: query.data.pageSize,
      total: totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / query.data.pageSize)),
    },
  });
});

adminUserManagementRouter.get("/users/:id/buyer-reviews", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const query = BuyerListQuerySchema.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: { code: "PAGINATION_INVALID", details: query.error.flatten() } });
  }

  const buyer = await ensureBuyerUser(params.data.id);
  if (!buyer.ok) {
    return res.status(buyer.status).json({ error: { code: buyer.code, message: buyer.message } });
  }

  const offset = (query.data.page - 1) * query.data.pageSize;
  const sortDir = query.data.sortDir === "asc" ? "ASC" : "DESC";

  const total = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM reviews WHERE buyer_id = $1",
    [params.data.id]
  );

  const rows = await pool.query<{
    id: string;
    order_id: string;
    food_id: string;
    food_name: string;
    food_image_url: string | null;
    rating: number;
    comment: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT
       r.id,
       r.order_id,
       r.food_id,
       f.name AS food_name,
       f.image_url AS food_image_url,
       r.rating,
       r.comment,
       r.created_at::text,
       r.updated_at::text
     FROM reviews r
     JOIN foods f ON f.id = r.food_id
     WHERE r.buyer_id = $1
     ORDER BY r.created_at ${sortDir}, r.id ${sortDir}
     LIMIT $2 OFFSET $3`,
    [params.data.id, query.data.pageSize, offset]
  );

  const totalCount = Number(total.rows[0]?.count ?? 0);
  return res.json({
    data: rows.rows.map((row) => ({
      id: row.id,
      orderId: row.order_id,
      foodId: row.food_id,
      foodName: row.food_name,
      foodImageUrl: row.food_image_url,
      rating: row.rating,
      comment: row.comment,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    pagination: {
      mode: "offset",
      page: query.data.page,
      pageSize: query.data.pageSize,
      total: totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / query.data.pageSize)),
    },
  });
});

adminUserManagementRouter.get("/users/:id/buyer-cancellations", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const query = BuyerListQuerySchema.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: { code: "PAGINATION_INVALID", details: query.error.flatten() } });
  }

  const buyer = await ensureBuyerUser(params.data.id);
  if (!buyer.ok) {
    return res.status(buyer.status).json({ error: { code: buyer.code, message: buyer.message } });
  }

  const offset = (query.data.page - 1) * query.data.pageSize;
  const sortDir = query.data.sortDir === "asc" ? "ASC" : "DESC";

  const total = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM orders WHERE buyer_id = $1 AND status = 'cancelled'",
    [params.data.id]
  );

  const rows = await pool.query<{
    id: string;
    total_price: string;
    created_at: string;
    cancelled_at: string;
    cancel_reason: string | null;
    items_json: unknown;
  }>(
    `SELECT
       o.id,
       o.total_price::text,
       o.created_at::text,
       COALESCE(ce.created_at::text, o.updated_at::text) AS cancelled_at,
       COALESCE(ce.payload_json ->> 'reason', ce.payload_json ->> 'message') AS cancel_reason,
       COALESCE(items.items_json, '[]'::jsonb) AS items_json
     FROM orders o
     LEFT JOIN LATERAL (
       SELECT payload_json, created_at
       FROM order_events
       WHERE order_id = o.id
         AND (to_status = 'cancelled' OR event_type ILIKE '%cancel%')
       ORDER BY created_at DESC
       LIMIT 1
     ) ce ON TRUE
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(
         jsonb_build_object(
           'orderItemId', oi.id,
           'foodId', f.id,
           'name', f.name,
           'imageUrl', f.image_url,
           'quantity', oi.quantity,
           'lineTotal', oi.line_total
         )
         ORDER BY oi.created_at ASC
       ) AS items_json
       FROM order_items oi
       JOIN foods f ON f.id = oi.food_id
       WHERE oi.order_id = o.id
     ) items ON TRUE
     WHERE o.buyer_id = $1
       AND o.status = 'cancelled'
     ORDER BY o.updated_at ${sortDir}, o.id ${sortDir}
     LIMIT $2 OFFSET $3`,
    [params.data.id, query.data.pageSize, offset]
  );

  const totalCount = Number(total.rows[0]?.count ?? 0);
  return res.json({
    data: rows.rows.map((row) => ({
      orderId: row.id,
      orderNo: `#${row.id.slice(0, 8).toUpperCase()}`,
      totalAmount: Number(row.total_price),
      cancelledAt: row.cancelled_at,
      reason: row.cancel_reason,
      items: Array.isArray(row.items_json) ? row.items_json : [],
    })),
    pagination: {
      mode: "offset",
      page: query.data.page,
      pageSize: query.data.pageSize,
      total: totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / query.data.pageSize)),
    },
  });
});

adminUserManagementRouter.get("/users/:id/buyer-contact", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const buyer = await ensureBuyerUser(params.data.id);
  if (!buyer.ok) {
    return res.status(buyer.status).json({ error: { code: buyer.code, message: buyer.message } });
  }

  const user = await pool.query<{
    id: string;
    email: string;
    display_name: string;
    full_name: string | null;
    profile_image_url: string | null;
    is_active: boolean;
    country_code: string | null;
    language: string | null;
    created_at: string;
    updated_at: string;
    last_login_at: string | null;
  }>(
    `SELECT
       u.id,
       u.email,
       u.display_name,
       u.full_name,
       u.profile_image_url,
       u.is_active,
       u.country_code,
       u.language,
       u.created_at::text,
       u.updated_at::text,
       (
         SELECT max(s.last_used_at)::text
         FROM auth_sessions s
         WHERE s.user_id = u.id
       ) AS last_login_at
     FROM users u
     WHERE u.id = $1`,
    [params.data.id]
  );

  const addresses = await pool.query<{
    id: string;
    title: string;
    address_line: string;
    is_default: boolean;
    created_at: string;
  }>(
    `SELECT id, title, address_line, is_default, created_at::text
     FROM user_addresses
     WHERE user_id = $1
     ORDER BY is_default DESC, created_at ASC`,
    [params.data.id]
  );

  const grouped = { home: null as null | { id: string; title: string; addressLine: string }, office: null as null | { id: string; title: string; addressLine: string }, other: [] as Array<{ id: string; title: string; addressLine: string }> };
  for (const item of addresses.rows) {
    const normalized = item.title.toLowerCase().trim();
    const mapped =
      normalized.includes("ev") || normalized.includes("home")
        ? "home"
        : normalized.includes("ofis") || normalized.includes("office") || normalized.includes("iş")
          ? "office"
          : "other";
    const payload = { id: item.id, title: item.title, addressLine: item.address_line };
    if (mapped === "home" && !grouped.home) grouped.home = payload;
    else if (mapped === "office" && !grouped.office) grouped.office = payload;
    else grouped.other.push(payload);
  }

  const base = user.rows[0];
  return res.json({
    data: {
      identity: {
        id: base.id,
        email: base.email,
        displayName: base.display_name,
        fullName: base.full_name,
        profileImageUrl: base.profile_image_url,
        status: base.is_active ? "active" : "disabled",
        createdAt: base.created_at,
        updatedAt: base.updated_at,
        lastLoginAt: base.last_login_at,
      },
      contact: {
        phone: null,
        countryCode: base.country_code,
        language: base.language,
      },
      addresses: grouped,
    },
  });
});

adminUserManagementRouter.get("/users/:id/login-locations", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const query = BuyerListQuerySchema.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: { code: "PAGINATION_INVALID", details: query.error.flatten() } });
  }

  const buyer = await ensureBuyerUser(params.data.id);
  if (!buyer.ok) {
    return res.status(buyer.status).json({ error: { code: buyer.code, message: buyer.message } });
  }

  const offset = (query.data.page - 1) * query.data.pageSize;
  const sortDir = query.data.sortDir === "asc" ? "ASC" : "DESC";

  const total = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM user_login_locations WHERE user_id = $1",
    [params.data.id]
  );

  const rows = await pool.query<{
    id: string;
    session_id: string | null;
    latitude: string;
    longitude: string;
    accuracy_m: number | null;
    source: string;
    ip: string | null;
    user_agent: string | null;
    created_at: string;
  }>(
    `SELECT
       id,
       session_id,
       latitude::text,
       longitude::text,
       accuracy_m,
       source,
       ip,
       user_agent,
       created_at::text
     FROM user_login_locations
     WHERE user_id = $1
     ORDER BY created_at ${sortDir}, id ${sortDir}
     LIMIT $2 OFFSET $3`,
    [params.data.id, query.data.pageSize, offset]
  );

  const totalCount = Number(total.rows[0]?.count ?? 0);
  return res.json({
    data: rows.rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      accuracyM: row.accuracy_m,
      source: row.source,
      ip: row.ip,
      userAgent: row.user_agent,
      createdAt: row.created_at,
    })),
    pagination: {
      mode: "offset",
      page: query.data.page,
      pageSize: query.data.pageSize,
      total: totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / query.data.pageSize)),
    },
  });
});

adminUserManagementRouter.post("/users", requireAuth("admin"), requireSuperAdmin, async (req, res) => {
  const parsed = CreateAppUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const passwordHash = await hashPassword(input.password);
  const displayNameNormalized = normalizeDisplayName(input.displayName);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const created = await client.query(
      `INSERT INTO users (email, password_hash, display_name, display_name_normalized, full_name, profile_image_url, user_type, is_active, country_code, language)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, email, display_name, full_name, profile_image_url, user_type, is_active, country_code, language, created_at::text, updated_at::text`,
      [
        input.email.toLowerCase(),
        passwordHash,
        input.displayName,
        displayNameNormalized,
        input.fullName ?? null,
        input.profileImageUrl ?? null,
        input.userType,
        input.isActive ?? true,
        input.countryCode ?? null,
        input.language ?? null,
      ]
    );

    const row = created.rows[0];
    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "admin_user_created",
      entityType: "users",
      entityId: row.id,
      after: {
        email: row.email,
        displayName: row.display_name,
        userType: row.user_type,
        isActive: row.is_active,
      },
    });

    await client.query("COMMIT");
    return res.status(201).json({
      data: {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        fullName: row.full_name,
        profileImageUrl: row.profile_image_url,
        role: row.user_type,
        status: row.is_active ? "active" : "disabled",
        countryCode: row.country_code,
        language: row.language,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return handleMutationError(res, error);
  } finally {
    client.release();
  }
});

adminUserManagementRouter.put("/users/:id", requireAuth("admin"), requireSuperAdmin, async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const parsed = UpdateAppUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT id, email, display_name, full_name, profile_image_url, user_type, is_active, country_code, language
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [params.data.id]
    );

    if ((existing.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "User not found" } });
    }

    const before = existing.rows[0];
    const passwordHash = input.password ? await hashPassword(input.password) : null;
    const displayNameNormalized = input.displayName ? normalizeDisplayName(input.displayName) : null;

    const updated = await client.query(
      `UPDATE users
       SET
         email = coalesce($2, email),
         password_hash = coalesce($3, password_hash),
         display_name = coalesce($4, display_name),
         display_name_normalized = coalesce($5, display_name_normalized),
         full_name = CASE WHEN $6::boolean THEN $7 ELSE full_name END,
         profile_image_url = CASE WHEN $8::boolean THEN $9 ELSE profile_image_url END,
         user_type = coalesce($10, user_type),
         country_code = CASE WHEN $11::boolean THEN $12 ELSE country_code END,
         language = CASE WHEN $13::boolean THEN $14 ELSE language END,
         updated_at = now()
       WHERE id = $1
       RETURNING id, email, display_name, full_name, profile_image_url, user_type, is_active, country_code, language, created_at::text, updated_at::text`,
      [
        params.data.id,
        input.email ? input.email.toLowerCase() : null,
        passwordHash,
        input.displayName ?? null,
        displayNameNormalized,
        Object.hasOwn(input, "fullName"),
        input.fullName ?? null,
        Object.hasOwn(input, "profileImageUrl"),
        input.profileImageUrl ?? null,
        input.userType ?? null,
        Object.hasOwn(input, "countryCode"),
        input.countryCode ?? null,
        Object.hasOwn(input, "language"),
        input.language ?? null,
      ]
    );

    const row = updated.rows[0];
    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "admin_user_updated",
      entityType: "users",
      entityId: row.id,
      before,
      after: {
        email: row.email,
        displayName: row.display_name,
        fullName: row.full_name,
        profileImageUrl: row.profile_image_url,
        userType: row.user_type,
        isActive: row.is_active,
        countryCode: row.country_code,
        language: row.language,
      },
    });

    await client.query("COMMIT");
    return res.json({
      data: {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        fullName: row.full_name,
        profileImageUrl: row.profile_image_url,
        role: row.user_type,
        status: row.is_active ? "active" : "disabled",
        countryCode: row.country_code,
        language: row.language,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return handleMutationError(res, error);
  } finally {
    client.release();
  }
});

adminUserManagementRouter.patch("/users/:id/status", requireAuth("admin"), requireSuperAdmin, async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const parsed = UpdateAppUserStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const nextActive = parsed.data.status === "active";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await client.query(
      "SELECT id, is_active FROM users WHERE id = $1 FOR UPDATE",
      [params.data.id]
    );
    if ((before.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "User not found" } });
    }

    const updated = await client.query(
      `UPDATE users
       SET is_active = $2, updated_at = now()
       WHERE id = $1
       RETURNING id, email, display_name, full_name, profile_image_url, user_type, is_active, country_code, language, created_at::text, updated_at::text`,
      [params.data.id, nextActive]
    );

    const row = updated.rows[0];
    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "admin_user_status_updated",
      entityType: "users",
      entityId: row.id,
      before: { isActive: before.rows[0].is_active },
      after: { isActive: row.is_active },
    });

    await client.query("COMMIT");
    return res.json({
      data: {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        fullName: row.full_name,
        profileImageUrl: row.profile_image_url,
        role: row.user_type,
        status: row.is_active ? "active" : "disabled",
        countryCode: row.country_code,
        language: row.language,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return handleMutationError(res, error);
  } finally {
    client.release();
  }
});

adminUserManagementRouter.patch("/users/:id/role", requireAuth("admin"), requireSuperAdmin, async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const parsed = UpdateAppUserRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await client.query(
      "SELECT id, user_type FROM users WHERE id = $1 FOR UPDATE",
      [params.data.id]
    );

    if ((before.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "User not found" } });
    }

    const updated = await client.query(
      `UPDATE users
       SET user_type = $2, updated_at = now()
       WHERE id = $1
       RETURNING id, email, display_name, full_name, profile_image_url, user_type, is_active, country_code, language, created_at::text, updated_at::text`,
      [params.data.id, parsed.data.role]
    );

    const row = updated.rows[0];
    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "admin_user_role_updated",
      entityType: "users",
      entityId: row.id,
      before: { role: before.rows[0].user_type },
      after: { role: row.user_type },
    });

    await client.query("COMMIT");
    return res.json({
      data: {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        fullName: row.full_name,
        profileImageUrl: row.profile_image_url,
        role: row.user_type,
        status: row.is_active ? "active" : "disabled",
        countryCode: row.country_code,
        language: row.language,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return handleMutationError(res, error);
  } finally {
    client.release();
  }
});

adminUserManagementRouter.get("/admin-users", requireAuth("admin"), async (req, res) => {
  const parsed = AdminUserListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "PAGINATION_INVALID", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const where: string[] = [];
  const params: unknown[] = [];

  if (input.status) {
    params.push(input.status === "active");
    where.push(`a.is_active = $${params.length}`);
  }

  if (input.role) {
    params.push(input.role);
    where.push(`a.role = $${params.length}`);
  }

  if (input.search) {
    params.push(`%${input.search.toLowerCase()}%`);
    where.push(`lower(a.email) LIKE $${params.length}`);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const offset = (input.page - 1) * input.pageSize;
  const sortField = adminSortFieldMap[input.sortBy];
  const sortDir = input.sortDir === "asc" ? "ASC" : "DESC";

  const total = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM admin_users a ${whereSql}`,
    params
  );

  const listParams = [...params, input.pageSize, offset];
  const list = await pool.query(
    `SELECT
       a.id,
       a.email,
       a.role,
       a.is_active,
       a.last_login_at::text,
       a.created_at::text,
       a.updated_at::text
     FROM admin_users a
     ${whereSql}
     ORDER BY ${sortField} ${sortDir}, a.id ${sortDir}
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  const totalCount = Number(total.rows[0].count);
  return res.json({
    data: list.rows,
    pagination: {
      mode: "offset",
      page: input.page,
      pageSize: input.pageSize,
      total: totalCount,
      totalPages: Math.ceil(totalCount / input.pageSize),
    },
  });
});

adminUserManagementRouter.get("/admin-users/:id", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const adminUser = await pool.query(
    `SELECT
       id,
       email,
       role,
       is_active,
       last_login_at::text,
       created_at::text,
       updated_at::text
     FROM admin_users
     WHERE id = $1`,
    [params.data.id]
  );

  if ((adminUser.rowCount ?? 0) === 0) {
    return res.status(404).json({ error: { code: "ADMIN_USER_NOT_FOUND", message: "Admin user not found" } });
  }

  return res.json({ data: adminUser.rows[0] });
});

adminUserManagementRouter.post("/admin-users", requireAuth("admin"), requireSuperAdmin, async (req, res) => {
  const parsed = CreateAdminUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const passwordHash = await hashPassword(input.password);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const created = await client.query(
      `INSERT INTO admin_users (email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, role, is_active, last_login_at::text, created_at::text, updated_at::text`,
      [input.email.toLowerCase(), passwordHash, input.role, input.isActive ?? true]
    );

    const row = created.rows[0];
    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "admin_account_created",
      entityType: "admin_users",
      entityId: row.id,
      after: {
        email: row.email,
        role: row.role,
        isActive: row.is_active,
      },
    });

    await client.query("COMMIT");
    return res.status(201).json({ data: row });
  } catch (error) {
    await client.query("ROLLBACK");
    return handleMutationError(res, error);
  } finally {
    client.release();
  }
});

adminUserManagementRouter.put("/admin-users/:id", requireAuth("admin"), requireSuperAdmin, async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const parsed = UpdateAdminUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      "SELECT id, email, role, is_active FROM admin_users WHERE id = $1 FOR UPDATE",
      [params.data.id]
    );

    if ((existing.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "ADMIN_USER_NOT_FOUND", message: "Admin user not found" } });
    }

    const passwordHash = input.password ? await hashPassword(input.password) : null;
    const updated = await client.query(
      `UPDATE admin_users
       SET
         email = coalesce($2, email),
         password_hash = coalesce($3, password_hash),
         updated_at = now()
       WHERE id = $1
       RETURNING id, email, role, is_active, last_login_at::text, created_at::text, updated_at::text`,
      [params.data.id, input.email ? input.email.toLowerCase() : null, passwordHash]
    );

    const row = updated.rows[0];
    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "admin_account_updated",
      entityType: "admin_users",
      entityId: row.id,
      before: existing.rows[0],
      after: {
        email: row.email,
        role: row.role,
        isActive: row.is_active,
      },
    });

    await client.query("COMMIT");
    return res.json({ data: row });
  } catch (error) {
    await client.query("ROLLBACK");
    return handleMutationError(res, error);
  } finally {
    client.release();
  }
});

adminUserManagementRouter.patch("/admin-users/:id/status", requireAuth("admin"), requireSuperAdmin, async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const parsed = UpdateAdminUserStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  if (params.data.id === req.auth!.userId && parsed.data.status === "disabled") {
    return res.status(409).json({ error: { code: "SELF_MUTATION_BLOCKED", message: "Cannot disable current session user" } });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await client.query(
      "SELECT id, is_active FROM admin_users WHERE id = $1 FOR UPDATE",
      [params.data.id]
    );

    if ((before.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "ADMIN_USER_NOT_FOUND", message: "Admin user not found" } });
    }

    const updated = await client.query(
      `UPDATE admin_users
       SET is_active = $2, updated_at = now()
       WHERE id = $1
       RETURNING id, email, role, is_active, last_login_at::text, created_at::text, updated_at::text`,
      [params.data.id, parsed.data.status === "active"]
    );

    const row = updated.rows[0];
    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "admin_account_status_updated",
      entityType: "admin_users",
      entityId: row.id,
      before: { isActive: before.rows[0].is_active },
      after: { isActive: row.is_active },
    });

    await client.query("COMMIT");
    return res.json({ data: row });
  } catch (error) {
    await client.query("ROLLBACK");
    return handleMutationError(res, error);
  } finally {
    client.release();
  }
});

adminUserManagementRouter.patch("/admin-users/:id/role", requireAuth("admin"), requireSuperAdmin, async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const parsed = UpdateAdminUserRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  if (params.data.id === req.auth!.userId && parsed.data.role !== "super_admin") {
    return res.status(409).json({ error: { code: "SELF_MUTATION_BLOCKED", message: "Cannot demote current session user" } });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await client.query(
      "SELECT id, role FROM admin_users WHERE id = $1 FOR UPDATE",
      [params.data.id]
    );

    if ((before.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "ADMIN_USER_NOT_FOUND", message: "Admin user not found" } });
    }

    const updated = await client.query(
      `UPDATE admin_users
       SET role = $2, updated_at = now()
       WHERE id = $1
       RETURNING id, email, role, is_active, last_login_at::text, created_at::text, updated_at::text`,
      [params.data.id, parsed.data.role]
    );

    const row = updated.rows[0];
    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "admin_account_role_updated",
      entityType: "admin_users",
      entityId: row.id,
      before: { role: before.rows[0].role },
      after: { role: row.role },
    });

    await client.query("COMMIT");
    return res.json({ data: row });
  } catch (error) {
    await client.query("ROLLBACK");
    return handleMutationError(res, error);
  } finally {
    client.release();
  }
});

function handleMutationError(res: Response, error: unknown) {
  const err = error as { code?: string; constraint?: string };
  if (err.code === "23505" && err.constraint?.includes("users_email")) {
    return res.status(409).json({ error: { code: "EMAIL_TAKEN", message: "Email already used" } });
  }
  if (err.code === "23505" && err.constraint?.includes("users_display_name")) {
    return res.status(409).json({ error: { code: "DISPLAY_NAME_TAKEN", message: "Display name already used" } });
  }
  if (err.code === "23505" && err.constraint?.includes("admin_users_email")) {
    return res.status(409).json({ error: { code: "EMAIL_TAKEN", message: "Email already used" } });
  }
  return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Mutation failed" } });
}
