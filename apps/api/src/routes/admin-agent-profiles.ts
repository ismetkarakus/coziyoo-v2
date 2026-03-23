import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/client.js";

const JsonObjectSchema = z.record(z.string(), z.unknown());

const CreateProfileSchema = z.object({
  name: z.string().min(1).max(128),
  speaks_first: z.boolean().optional(),
  system_prompt: z.string().optional(),
  greeting_enabled: z.boolean().optional(),
  greeting_instruction: z.string().optional(),
  voice_language: z.string().min(1).max(16).optional(),
  llm_config: JsonObjectSchema.optional(),
  stt_config: JsonObjectSchema.optional(),
  tts_config: JsonObjectSchema.optional(),
  n8n_config: JsonObjectSchema.optional(),
});

const UpdateProfileSchema = CreateProfileSchema.partial();

const IdParamSchema = z.object({
  id: z.string().uuid(),
});

export const agentProfilesRouter = Router();

agentProfilesRouter.get("/", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, is_active, speaks_first, system_prompt, greeting_enabled, greeting_instruction,
              voice_language, llm_config, stt_config, tts_config, n8n_config, created_at, updated_at
       FROM agent_profiles
       ORDER BY is_active DESC, updated_at DESC`,
    );
    return res.json({ data: result.rows });
  } catch (err) {
    return res.status(500).json({ error: { code: "DB_ERROR", message: err instanceof Error ? err.message : "Query failed" } });
  }
});

agentProfilesRouter.post("/", async (req, res) => {
  const parsed = CreateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const name = parsed.data.name.trim();
  if (!name) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "name is required" } });
  }

  try {
    const result = await pool.query(
      `INSERT INTO agent_profiles
        (name, speaks_first, system_prompt, greeting_enabled, greeting_instruction, voice_language, llm_config, stt_config, tts_config, n8n_config)
       VALUES ($1, COALESCE($2, FALSE), $3, COALESCE($4, TRUE), $5, COALESCE($6, 'tr'), COALESCE($7, '{}'::jsonb), COALESCE($8, '{}'::jsonb), COALESCE($9, '{}'::jsonb), COALESCE($10, '{}'::jsonb))
       RETURNING id, name, is_active, speaks_first, system_prompt, greeting_enabled, greeting_instruction,
                 voice_language, llm_config, stt_config, tts_config, n8n_config, created_at, updated_at`,
      [
        name,
        parsed.data.speaks_first ?? null,
        parsed.data.system_prompt ?? null,
        parsed.data.greeting_enabled ?? null,
        parsed.data.greeting_instruction ?? null,
        parsed.data.voice_language ?? null,
        parsed.data.llm_config ?? null,
        parsed.data.stt_config ?? null,
        parsed.data.tts_config ?? null,
        parsed.data.n8n_config ?? null,
      ],
    );
    return res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: { code: "DB_ERROR", message: err instanceof Error ? err.message : "Query failed" } });
  }
});

agentProfilesRouter.get("/:id", async (req, res) => {
  const idParsed = IdParamSchema.safeParse(req.params);
  if (!idParsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: idParsed.error.flatten() } });
  }

  try {
    const result = await pool.query(
      `SELECT id, name, is_active, speaks_first, system_prompt, greeting_enabled, greeting_instruction,
              voice_language, llm_config, stt_config, tts_config, n8n_config, created_at, updated_at
       FROM agent_profiles
       WHERE id = $1`,
      [idParsed.data.id],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Profile not found" } });
    }

    return res.json({ data: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: { code: "DB_ERROR", message: err instanceof Error ? err.message : "Query failed" } });
  }
});

agentProfilesRouter.put("/:id", async (req, res) => {
  const idParsed = IdParamSchema.safeParse(req.params);
  if (!idParsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: idParsed.error.flatten() } });
  }

  const parsed = UpdateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const updateName = typeof parsed.data.name === "string" ? parsed.data.name.trim() : undefined;
  if (parsed.data.name !== undefined && !updateName) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "name cannot be empty" } });
  }

  try {
    const result = await pool.query(
      `UPDATE agent_profiles SET
         name = COALESCE($2, name),
         speaks_first = COALESCE($3, speaks_first),
         system_prompt = COALESCE($4, system_prompt),
         greeting_enabled = COALESCE($5, greeting_enabled),
         greeting_instruction = COALESCE($6, greeting_instruction),
         voice_language = COALESCE($7, voice_language),
         llm_config = COALESCE($8, llm_config),
         stt_config = COALESCE($9, stt_config),
         tts_config = COALESCE($10, tts_config),
         n8n_config = COALESCE($11, n8n_config)
       WHERE id = $1
       RETURNING id, name, is_active, speaks_first, system_prompt, greeting_enabled, greeting_instruction,
                 voice_language, llm_config, stt_config, tts_config, n8n_config, created_at, updated_at`,
      [
        idParsed.data.id,
        updateName ?? null,
        parsed.data.speaks_first ?? null,
        parsed.data.system_prompt ?? null,
        parsed.data.greeting_enabled ?? null,
        parsed.data.greeting_instruction ?? null,
        parsed.data.voice_language ?? null,
        parsed.data.llm_config ?? null,
        parsed.data.stt_config ?? null,
        parsed.data.tts_config ?? null,
        parsed.data.n8n_config ?? null,
      ],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Profile not found" } });
    }

    return res.json({ data: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: { code: "DB_ERROR", message: err instanceof Error ? err.message : "Query failed" } });
  }
});

agentProfilesRouter.delete("/:id", async (req, res) => {
  const idParsed = IdParamSchema.safeParse(req.params);
  if (!idParsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: idParsed.error.flatten() } });
  }

  try {
    const activeCheck = await pool.query(
      `SELECT is_active FROM agent_profiles WHERE id = $1`,
      [idParsed.data.id],
    );
    if (activeCheck.rowCount === 0) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Profile not found" } });
    }
    if (activeCheck.rows[0]?.is_active === true) {
      return res.status(409).json({
        error: {
          code: "CANNOT_DELETE_ACTIVE",
          message: "Cannot delete the active profile. Activate a different profile first.",
        },
      });
    }

    await pool.query(`DELETE FROM agent_profiles WHERE id = $1`, [idParsed.data.id]);
    return res.json({ data: { deleted: idParsed.data.id } });
  } catch (err) {
    return res.status(500).json({ error: { code: "DB_ERROR", message: err instanceof Error ? err.message : "Query failed" } });
  }
});

agentProfilesRouter.post("/:id/activate", async (req, res) => {
  const idParsed = IdParamSchema.safeParse(req.params);
  if (!idParsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: idParsed.error.flatten() } });
  }

  try {
    await pool.query("BEGIN");
    await pool.query(`UPDATE agent_profiles SET is_active = FALSE WHERE is_active = TRUE`);
    const result = await pool.query(
      `UPDATE agent_profiles SET is_active = TRUE WHERE id = $1 RETURNING id`,
      [idParsed.data.id],
    );
    if (result.rowCount === 0) {
      await pool.query("ROLLBACK");
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Profile not found" } });
    }
    await pool.query("COMMIT");
    return res.json({ data: { active: idParsed.data.id } });
  } catch (err) {
    await pool.query("ROLLBACK").catch(() => undefined);
    return res.status(500).json({ error: { code: "DB_ERROR", message: err instanceof Error ? err.message : "Query failed" } });
  }
});

agentProfilesRouter.post("/:id/duplicate", async (req, res) => {
  const idParsed = IdParamSchema.safeParse(req.params);
  if (!idParsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: idParsed.error.flatten() } });
  }

  try {
    const source = await pool.query(
      `SELECT name, speaks_first, system_prompt, greeting_enabled, greeting_instruction, voice_language,
              llm_config, stt_config, tts_config, n8n_config
       FROM agent_profiles
       WHERE id = $1`,
      [idParsed.data.id],
    );
    if (source.rowCount === 0) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Profile not found" } });
    }

    const row = source.rows[0];
    const duplicate = await pool.query(
      `INSERT INTO agent_profiles
         (name, speaks_first, system_prompt, greeting_enabled, greeting_instruction, voice_language, llm_config, stt_config, tts_config, n8n_config)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, name, is_active, speaks_first, system_prompt, greeting_enabled, greeting_instruction,
                 voice_language, llm_config, stt_config, tts_config, n8n_config, created_at, updated_at`,
      [
        `${row.name} (copy)`,
        row.speaks_first,
        row.system_prompt,
        row.greeting_enabled,
        row.greeting_instruction,
        row.voice_language,
        row.llm_config,
        row.stt_config,
        row.tts_config,
        row.n8n_config,
      ],
    );

    return res.status(201).json({ data: duplicate.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: { code: "DB_ERROR", message: err instanceof Error ? err.message : "Query failed" } });
  }
});
