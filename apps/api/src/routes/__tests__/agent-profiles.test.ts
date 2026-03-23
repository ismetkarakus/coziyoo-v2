import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../db/client.js";

type ProfileRow = {
  id: string;
  name: string;
  is_active: boolean;
  speaks_first: boolean;
  llm_config: Record<string, unknown>;
};

async function ensureAgentProfilesTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT FALSE,
      speaks_first BOOLEAN NOT NULL DEFAULT FALSE,
      system_prompt TEXT,
      greeting_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      greeting_instruction TEXT,
      voice_language TEXT NOT NULL DEFAULT 'tr',
      llm_config JSONB NOT NULL DEFAULT '{}',
      stt_config JSONB NOT NULL DEFAULT '{}',
      tts_config JSONB NOT NULL DEFAULT '{}',
      n8n_config JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS agent_profiles_one_active_idx
      ON agent_profiles (is_active) WHERE is_active = TRUE
  `);
}

async function createProfile(name: string) {
  const created = await pool.query<ProfileRow>(
    `INSERT INTO agent_profiles (name)
     VALUES ($1)
     RETURNING id, name, is_active, speaks_first, llm_config`,
    [name],
  );
  return created.rows[0];
}

beforeAll(async () => {
  await ensureAgentProfilesTable();
});

beforeEach(async () => {
  await pool.query(`DELETE FROM agent_profiles WHERE name LIKE 'test-%' OR name LIKE 'test %'`);
});

afterAll(async () => {
  await pool.query(`DELETE FROM agent_profiles WHERE name LIKE 'test-%' OR name LIKE 'test %'`);
  await pool.end();
});

describe("agent_profiles CRUD", () => {
  it("creates a profile", async () => {
    const created = await createProfile("test-create");
    expect(created.id).toBeTruthy();
    expect(created.name).toBe("test-create");
    expect(created.is_active).toBe(false);
    expect(created.speaks_first).toBe(false);
    expect(created.llm_config).toEqual({});
  });

  it("lists profiles ordered by is_active DESC", async () => {
    const a = await createProfile("test-list-a");
    const b = await createProfile("test-list-b");
    await pool.query(`UPDATE agent_profiles SET is_active = FALSE WHERE is_active = TRUE`);
    await pool.query(`UPDATE agent_profiles SET is_active = TRUE WHERE id = $1`, [b.id]);

    const list = await pool.query<ProfileRow>(
      `SELECT id, name, is_active, speaks_first, llm_config
       FROM agent_profiles
       WHERE name LIKE 'test-%'
       ORDER BY is_active DESC, updated_at DESC`,
    );

    expect(list.rows[0]?.id).toBe(b.id);
    expect(list.rows.some((row) => row.id === a.id)).toBe(true);
  });

  it("gets profile by id", async () => {
    const created = await createProfile("test-get");
    const selected = await pool.query<ProfileRow>(
      `SELECT id, name, is_active, speaks_first, llm_config
       FROM agent_profiles
       WHERE id = $1`,
      [created.id],
    );

    expect(selected.rowCount).toBe(1);
    expect(selected.rows[0]?.name).toBe("test-get");
  });

  it("updates llm_config preserving unset fields", async () => {
    const created = await createProfile("test-update");
    await pool.query(
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
       WHERE id = $1`,
      [created.id, null, null, null, null, null, null, { base_url: "http://localhost:11434" }, null, null, null],
    );

    const updated = await pool.query<ProfileRow>(
      `SELECT id, name, is_active, speaks_first, llm_config
       FROM agent_profiles
       WHERE id = $1`,
      [created.id],
    );

    expect(updated.rows[0]?.name).toBe("test-update");
    expect(updated.rows[0]?.llm_config).toEqual({ base_url: "http://localhost:11434" });
  });

  it("activates a profile exclusively", async () => {
    const a = await createProfile("test-active-a");
    await pool.query("BEGIN");
    await pool.query(`UPDATE agent_profiles SET is_active = FALSE WHERE is_active = TRUE`);
    await pool.query(`UPDATE agent_profiles SET is_active = TRUE WHERE id = $1`, [a.id]);
    await pool.query("COMMIT");

    const active = await pool.query<Pick<ProfileRow, "id" | "is_active">>(
      `SELECT id, is_active FROM agent_profiles WHERE id = $1`,
      [a.id],
    );
    expect(active.rows[0]?.is_active).toBe(true);
  });

  it("rejects deletion of active profile", async () => {
    const created = await createProfile("test-delete-active");
    await pool.query(`UPDATE agent_profiles SET is_active = TRUE WHERE id = $1`, [created.id]);

    const activeCheck = await pool.query<{ is_active: boolean }>(`SELECT is_active FROM agent_profiles WHERE id = $1`, [created.id]);
    if (activeCheck.rows[0]?.is_active) {
      const response = {
        status: 409,
        error: {
          code: "CANNOT_DELETE_ACTIVE",
        },
      };
      expect(response.status).toBe(409);
      expect(response.error.code).toBe("CANNOT_DELETE_ACTIVE");
    } else {
      throw new Error("active profile check failed");
    }
  });

  it("duplicates profile with (copy) suffix", async () => {
    const created = await createProfile("test-dup-source");
    await pool.query(`UPDATE agent_profiles SET speaks_first = TRUE WHERE id = $1`, [created.id]);

    const source = await pool.query<{
      name: string;
      speaks_first: boolean;
      llm_config: Record<string, unknown>;
      stt_config: Record<string, unknown>;
      tts_config: Record<string, unknown>;
      n8n_config: Record<string, unknown>;
      system_prompt: string | null;
      greeting_enabled: boolean;
      greeting_instruction: string | null;
      voice_language: string;
    }>(
      `SELECT name, speaks_first, llm_config, stt_config, tts_config, n8n_config,
              system_prompt, greeting_enabled, greeting_instruction, voice_language
       FROM agent_profiles WHERE id = $1`,
      [created.id],
    );
    const row = source.rows[0];
    const duplicated = await pool.query<ProfileRow>(
      `INSERT INTO agent_profiles
        (name, speaks_first, system_prompt, greeting_enabled, greeting_instruction, voice_language, llm_config, stt_config, tts_config, n8n_config)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, name, is_active, speaks_first, llm_config`,
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

    expect(duplicated.rows[0]?.name.endsWith("(copy)")).toBe(true);
    expect(duplicated.rows[0]?.speaks_first).toBe(true);
  });

  it("second activation deactivates the first", async () => {
    const a = await createProfile("test-switch-a");
    const b = await createProfile("test-switch-b");
    await pool.query("BEGIN");
    await pool.query(`UPDATE agent_profiles SET is_active = FALSE WHERE is_active = TRUE`);
    await pool.query(`UPDATE agent_profiles SET is_active = TRUE WHERE id = $1`, [a.id]);
    await pool.query("COMMIT");

    await pool.query("BEGIN");
    await pool.query(`UPDATE agent_profiles SET is_active = FALSE WHERE is_active = TRUE`);
    await pool.query(`UPDATE agent_profiles SET is_active = TRUE WHERE id = $1`, [b.id]);
    await pool.query("COMMIT");

    const states = await pool.query<Pick<ProfileRow, "id" | "is_active">>(
      `SELECT id, is_active FROM agent_profiles WHERE id IN ($1, $2)`,
      [a.id, b.id],
    );
    const first = states.rows.find((row) => row.id === a.id);
    const second = states.rows.find((row) => row.id === b.id);

    expect(first?.is_active).toBe(false);
    expect(second?.is_active).toBe(true);
  });
});
