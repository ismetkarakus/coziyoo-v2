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
  }

  if (input.search) {
    params.push(`%${input.search.toLowerCase()}%`);
    where.push(`(lower(u.email) LIKE $${params.length} OR lower(u.display_name) LIKE $${params.length})`);
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
  const list = await pool.query(
    `SELECT
       u.id,
       u.email,
       u.display_name,
       u.full_name,
       u.user_type,
       u.is_active,
       u.country_code,
       u.language,
       u.created_at::text,
       u.updated_at::text
     FROM users u
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
      role: row.user_type,
      status: row.is_active ? "active" : "disabled",
      countryCode: row.country_code,
      language: row.language,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
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

  const user = await pool.query(
    `SELECT
       id,
       email,
       display_name,
       full_name,
       user_type,
       is_active,
       country_code,
       language,
       created_at::text,
       updated_at::text
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
      role: row.user_type,
      status: row.is_active ? "active" : "disabled",
      countryCode: row.country_code,
      language: row.language,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
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
      `INSERT INTO users (email, password_hash, display_name, display_name_normalized, full_name, user_type, is_active, country_code, language)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, email, display_name, full_name, user_type, is_active, country_code, language, created_at::text, updated_at::text`,
      [
        input.email.toLowerCase(),
        passwordHash,
        input.displayName,
        displayNameNormalized,
        input.fullName ?? null,
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
      `SELECT id, email, display_name, full_name, user_type, is_active, country_code, language
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
         user_type = coalesce($8, user_type),
         country_code = CASE WHEN $9::boolean THEN $10 ELSE country_code END,
         language = CASE WHEN $11::boolean THEN $12 ELSE language END,
         updated_at = now()
       WHERE id = $1
       RETURNING id, email, display_name, full_name, user_type, is_active, country_code, language, created_at::text, updated_at::text`,
      [
        params.data.id,
        input.email ? input.email.toLowerCase() : null,
        passwordHash,
        input.displayName ?? null,
        displayNameNormalized,
        Object.hasOwn(input, "fullName"),
        input.fullName ?? null,
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
       RETURNING id, email, display_name, full_name, user_type, is_active, country_code, language, created_at::text, updated_at::text`,
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
       RETURNING id, email, display_name, full_name, user_type, is_active, country_code, language, created_at::text, updated_at::text`,
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
