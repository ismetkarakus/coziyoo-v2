import { env } from "../config/env.js";
import { pool } from "../db/client.js";
import { DEFAULT_TTS_ENGINE, normalizeTtsEngine, type TtsEngine } from "./tts-engines.js";

export type TtsServerEntry = {
  id: string;
  name: string;
  engine: TtsEngine;
  config?: Record<string, unknown>;
};

export type StarterAgentSettings = {
  deviceId: string;
  agentName: string;
  voiceLanguage: string;
  ollamaModel: string;
  ttsEngine: TtsEngine;
  ttsConfig: Record<string, unknown> | null;
  ttsServers: TtsServerEntry[] | null;
  activeTtsServerId: string | null;
  ttsEnabled: boolean;
  sttEnabled: boolean;
  systemPrompt: string | null;
  greetingEnabled: boolean;
  greetingInstruction: string | null;
  updatedAt: string;
};

type UpsertStarterAgentSettingsInput = {
  deviceId: string;
  agentName: string;
  voiceLanguage: string;
  ollamaModel: string;
  ttsEngine: TtsEngine;
  ttsConfig?: Record<string, unknown>;
  ttsServers?: TtsServerEntry[];
  activeTtsServerId?: string;
  ttsEnabled: boolean;
  sttEnabled: boolean;
  systemPrompt?: string;
  greetingEnabled: boolean;
  greetingInstruction?: string;
};

type StarterSettingsSchemaCapabilities = {
  hasTtsServersJson: boolean;
  hasActiveTtsServerId: boolean;
  hasIsActive: boolean;
};

let schemaCapabilitiesPromise: Promise<StarterSettingsSchemaCapabilities> | null = null;
let ensureIsActivePromise: Promise<void> | null = null;

const DEFAULT_STARTER_STT_SERVER_ID = "default-stt";
const DEFAULT_STARTER_TTS_SERVER_ID = "default-tts";
const DEFAULT_STARTER_N8N_SERVER_ID = "default-n8n";
const DEFAULT_STARTER_VOICE_LANGUAGE = "tr";
const DEFAULT_STARTER_OLLAMA_MODEL = env.OLLAMA_CHAT_MODEL || "llama3.1:8b";
const DEFAULT_STARTER_SYSTEM_PROMPT = [
  "You are Coziyoo's voice ordering assistant for homemade food sellers.",
  "Your job is to help users discover suitable meals, compare options clearly, and guide them to place an order.",
  "When search results are available, summarize the best matches first and explain relevant differences such as dish type, ingredients, portion, spice level, seller, price, and delivery timing when known.",
  "Ask short follow-up questions when the request is ambiguous, such as cuisine preference, dietary restrictions, portion size, budget, or delivery area.",
  "Recommend only items that exist in the provided search results or tool outputs. Never invent foods, prices, availability, sellers, discounts, or delivery promises.",
  "If an item is unavailable or the user changes preferences, offer the closest valid alternatives.",
  "When the user is ready to order, confirm the selected item, quantity, important preferences, delivery or pickup choice, and any note for the seller before proceeding.",
  "Keep responses concise, friendly, and action-oriented. Prefer simple spoken language suitable for a voice conversation.",
  "If required information is missing, say what is missing and ask for it directly.",
].join(" ");

function toOptionalBearerHeader(apiKey: string | undefined): string | null {
  if (typeof apiKey !== "string") return null;
  const trimmed = apiKey.trim();
  if (!trimmed || /^change_me/i.test(trimmed)) return null;
  return `Bearer ${trimmed}`;
}

export function createDefaultStarterTtsConfig() {
  const sttAuthHeader = toOptionalBearerHeader(env.SPEECH_TO_TEXT_API_KEY) ?? "Bearer your-strong-secret";

  return {
    baseUrl: "https://chatter.drascom.uk",
    path: "/tts",
    textFieldName: "text",
    bodyParams: {
      voice_mode: "predefined",
      predefined_voice_id: "ayhan.mp3",
      output_format: "wav",
      split_text: "true",
      chunk_size: "220",
      temperature: "0.1",
      exaggeration: "0",
      cfg_weight: "0",
      seed: "0",
      speed_factor: "0",
      language: DEFAULT_STARTER_VOICE_LANGUAGE,
    },
    queryParams: {},
    authHeader: null,
    stt: {
      provider: "remote-speech-server",
      baseUrl: "https://stt-speach.drascom.uk",
      transcribePath: "/v1/audio/transcriptions",
      model: "Systran/faster-whisper-medium",
      queryParams: {},
      authHeader: sttAuthHeader,
    },
    n8n: {
      baseUrl: env.N8N_HOST || "https://coziyoo.drascom.uk",
      workflowId: env.N8N_LLM_WORKFLOW_ID,
      mcpWorkflowId: env.N8N_MCP_WORKFLOW_ID,
      webhookPath: env.N8N_LLM_WEBHOOK_PATH || null,
      mcpWebhookPath: env.N8N_MCP_WEBHOOK_PATH || null,
    },
    sttServers: [
      {
        id: DEFAULT_STARTER_STT_SERVER_ID,
        name: "Default STT",
        enabled: true,
        provider: "remote-speech-server",
        baseUrl: "https://stt-speach.drascom.uk",
        transcribePath: "/v1/audio/transcriptions",
        model: "Systran/faster-whisper-medium",
        queryParams: {},
        authHeader: sttAuthHeader ?? "",
      },
    ],
    defaultSttServerId: DEFAULT_STARTER_STT_SERVER_ID,
    ttsServers: [
      {
        id: DEFAULT_STARTER_TTS_SERVER_ID,
        name: "Default TTS",
        enabled: true,
        baseUrl: "https://chatter.drascom.uk",
        synthPath: "/tts",
        textFieldName: "text",
        bodyParams: {
          voice_mode: "predefined",
          predefined_voice_id: "ayhan.mp3",
          output_format: "wav",
          split_text: "true",
          chunk_size: "220",
          temperature: "0.1",
          exaggeration: "0",
          cfg_weight: "0",
          seed: "0",
          speed_factor: "0",
          language: DEFAULT_STARTER_VOICE_LANGUAGE,
        },
        queryParams: {},
        authHeader: "",
      },
    ],
    defaultTtsServerId: DEFAULT_STARTER_TTS_SERVER_ID,
    n8nServers: [
      {
        id: DEFAULT_STARTER_N8N_SERVER_ID,
        name: "Default N8N",
        enabled: true,
        baseUrl: env.N8N_HOST || "https://coziyoo.drascom.uk",
        workflowId: env.N8N_LLM_WORKFLOW_ID,
        mcpWorkflowId: env.N8N_MCP_WORKFLOW_ID,
        webhookPath: env.N8N_LLM_WEBHOOK_PATH || "",
        mcpWebhookPath: env.N8N_MCP_WEBHOOK_PATH || "",
      },
    ],
    defaultN8nServerId: DEFAULT_STARTER_N8N_SERVER_ID,
  };
}

export function createDefaultStarterAgentSettings(deviceId = "default"): StarterAgentSettings {
  return {
    deviceId,
    agentName: "coziyoo-agent",
    voiceLanguage: DEFAULT_STARTER_VOICE_LANGUAGE,
    ollamaModel: DEFAULT_STARTER_OLLAMA_MODEL,
    ttsEngine: "chatterbox",
    ttsConfig: createDefaultStarterTtsConfig(),
    ttsServers: null,
    activeTtsServerId: null,
    ttsEnabled: true,
    sttEnabled: true,
    systemPrompt: DEFAULT_STARTER_SYSTEM_PROMPT,
    greetingEnabled: true,
    greetingInstruction: null,
    updatedAt: new Date(0).toISOString(),
  };
}

export async function getStarterAgentSettings(deviceId: string): Promise<StarterAgentSettings | null> {
  const capabilities = await getSchemaCapabilities();
  if (capabilities.hasTtsServersJson && capabilities.hasActiveTtsServerId) {
    const result = await pool.query<{
      device_id: string;
      agent_name: string;
      voice_language: string;
      ollama_model: string;
      tts_engine: string;
      tts_config_json: Record<string, unknown> | null;
      tts_servers_json: unknown[] | null;
      active_tts_server_id: string | null;
      tts_enabled: boolean;
      stt_enabled: boolean;
      system_prompt: string | null;
      greeting_enabled: boolean;
      greeting_instruction: string | null;
      updated_at: string;
    }>(
      `SELECT device_id, agent_name, voice_language, ollama_model, tts_engine, tts_config_json, tts_servers_json, active_tts_server_id, tts_enabled, stt_enabled, system_prompt, greeting_enabled, greeting_instruction, updated_at::text
       FROM starter_agent_settings
       WHERE device_id = $1`,
      [deviceId]
    );

    if ((result.rowCount ?? 0) === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      deviceId: row.device_id,
      agentName: row.agent_name,
      voiceLanguage: row.voice_language,
      ollamaModel: row.ollama_model,
      ttsEngine: normalizeTtsEngine(row.tts_engine),
      ttsConfig: row.tts_config_json ?? null,
      ttsServers: normalizeTtsServers(row.tts_servers_json),
      activeTtsServerId: row.active_tts_server_id ?? null,
      ttsEnabled: row.tts_enabled,
      sttEnabled: row.stt_enabled,
      systemPrompt: row.system_prompt,
      greetingEnabled: row.greeting_enabled,
      greetingInstruction: row.greeting_instruction,
      updatedAt: row.updated_at,
    };
  }

  const legacyResult = await pool.query<{
    device_id: string;
    agent_name: string;
    voice_language: string;
    ollama_model: string;
    tts_engine: string;
    tts_config_json: Record<string, unknown> | null;
    tts_enabled: boolean;
    stt_enabled: boolean;
    system_prompt: string | null;
    greeting_enabled: boolean;
    greeting_instruction: string | null;
    updated_at: string;
  }>(
    `SELECT device_id, agent_name, voice_language, ollama_model, tts_engine, tts_config_json, tts_enabled, stt_enabled, system_prompt, greeting_enabled, greeting_instruction, updated_at::text
     FROM starter_agent_settings
     WHERE device_id = $1`,
    [deviceId]
  );

  if ((legacyResult.rowCount ?? 0) === 0) {
    return null;
  }

  const row = legacyResult.rows[0];
  return {
    deviceId: row.device_id,
    agentName: row.agent_name,
    voiceLanguage: row.voice_language,
    ollamaModel: row.ollama_model,
    ttsEngine: normalizeTtsEngine(row.tts_engine),
    ttsConfig: row.tts_config_json ?? null,
    ttsServers: null,
    activeTtsServerId: null,
    ttsEnabled: row.tts_enabled,
    sttEnabled: row.stt_enabled,
    systemPrompt: row.system_prompt,
    greetingEnabled: row.greeting_enabled,
    greetingInstruction: row.greeting_instruction,
    updatedAt: row.updated_at,
  };
}

export async function upsertStarterAgentSettings(input: UpsertStarterAgentSettingsInput): Promise<StarterAgentSettings> {
  const ttsConfigJson = toJsonbParam(input.ttsConfig ?? null);
  const ttsServersJson = toJsonbParam(input.ttsServers ?? null);
  const capabilities = await getSchemaCapabilities();
  if (capabilities.hasTtsServersJson && capabilities.hasActiveTtsServerId) {
    const result = await pool.query<{
      device_id: string;
      agent_name: string;
      voice_language: string;
      ollama_model: string;
      tts_engine: string;
      tts_config_json: Record<string, unknown> | null;
      tts_servers_json: unknown[] | null;
      active_tts_server_id: string | null;
      tts_enabled: boolean;
      stt_enabled: boolean;
      system_prompt: string | null;
      greeting_enabled: boolean;
      greeting_instruction: string | null;
      updated_at: string;
    }>(
      `INSERT INTO starter_agent_settings (device_id, agent_name, voice_language, ollama_model, tts_engine, tts_config_json, tts_servers_json, active_tts_server_id, tts_enabled, stt_enabled, system_prompt, greeting_enabled, greeting_instruction, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12, $13, now())
       ON CONFLICT (device_id)
       DO UPDATE SET
         agent_name = EXCLUDED.agent_name,
         voice_language = EXCLUDED.voice_language,
         ollama_model = EXCLUDED.ollama_model,
         tts_engine = EXCLUDED.tts_engine,
         tts_config_json = EXCLUDED.tts_config_json,
         tts_servers_json = EXCLUDED.tts_servers_json,
         active_tts_server_id = EXCLUDED.active_tts_server_id,
         tts_enabled = EXCLUDED.tts_enabled,
         stt_enabled = EXCLUDED.stt_enabled,
         system_prompt = EXCLUDED.system_prompt,
         greeting_enabled = EXCLUDED.greeting_enabled,
         greeting_instruction = EXCLUDED.greeting_instruction,
         updated_at = now()
       RETURNING device_id, agent_name, voice_language, ollama_model, tts_engine, tts_config_json, tts_servers_json, active_tts_server_id, tts_enabled, stt_enabled, system_prompt, greeting_enabled, greeting_instruction, updated_at::text`,
      [
        input.deviceId,
        input.agentName,
        input.voiceLanguage,
        input.ollamaModel,
        input.ttsEngine ?? DEFAULT_TTS_ENGINE,
        ttsConfigJson,
        ttsServersJson,
        input.activeTtsServerId ?? null,
        input.ttsEnabled,
        input.sttEnabled,
        input.systemPrompt ?? null,
        input.greetingEnabled,
        input.greetingInstruction ?? null,
      ]
    );

    const row = result.rows[0];
    return {
      deviceId: row.device_id,
      agentName: row.agent_name,
      voiceLanguage: row.voice_language,
      ollamaModel: row.ollama_model,
      ttsEngine: normalizeTtsEngine(row.tts_engine),
      ttsConfig: row.tts_config_json ?? null,
      ttsServers: normalizeTtsServers(row.tts_servers_json),
      activeTtsServerId: row.active_tts_server_id ?? null,
      ttsEnabled: row.tts_enabled,
      sttEnabled: row.stt_enabled,
      systemPrompt: row.system_prompt,
      greetingEnabled: row.greeting_enabled,
      greetingInstruction: row.greeting_instruction,
      updatedAt: row.updated_at,
    };
  }

  const legacyResult = await pool.query<{
    device_id: string;
    agent_name: string;
    voice_language: string;
    ollama_model: string;
    tts_engine: string;
    tts_config_json: Record<string, unknown> | null;
    tts_enabled: boolean;
    stt_enabled: boolean;
    system_prompt: string | null;
    greeting_enabled: boolean;
    greeting_instruction: string | null;
    updated_at: string;
  }>(
    `INSERT INTO starter_agent_settings (device_id, agent_name, voice_language, ollama_model, tts_engine, tts_config_json, tts_enabled, stt_enabled, system_prompt, greeting_enabled, greeting_instruction, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, now())
     ON CONFLICT (device_id)
     DO UPDATE SET
       agent_name = EXCLUDED.agent_name,
       voice_language = EXCLUDED.voice_language,
       ollama_model = EXCLUDED.ollama_model,
       tts_engine = EXCLUDED.tts_engine,
       tts_config_json = EXCLUDED.tts_config_json,
       tts_enabled = EXCLUDED.tts_enabled,
       stt_enabled = EXCLUDED.stt_enabled,
       system_prompt = EXCLUDED.system_prompt,
       greeting_enabled = EXCLUDED.greeting_enabled,
       greeting_instruction = EXCLUDED.greeting_instruction,
       updated_at = now()
     RETURNING device_id, agent_name, voice_language, ollama_model, tts_engine, tts_config_json, tts_enabled, stt_enabled, system_prompt, greeting_enabled, greeting_instruction, updated_at::text`,
    [
      input.deviceId,
      input.agentName,
      input.voiceLanguage,
      input.ollamaModel,
      input.ttsEngine ?? DEFAULT_TTS_ENGINE,
      ttsConfigJson,
      input.ttsEnabled,
      input.sttEnabled,
      input.systemPrompt ?? null,
      input.greetingEnabled,
      input.greetingInstruction ?? null,
    ]
  );

  const row = legacyResult.rows[0];
  return {
    deviceId: row.device_id,
    agentName: row.agent_name,
    voiceLanguage: row.voice_language,
    ollamaModel: row.ollama_model,
    ttsEngine: normalizeTtsEngine(row.tts_engine),
    ttsConfig: row.tts_config_json ?? null,
    ttsServers: null,
    activeTtsServerId: null,
    ttsEnabled: row.tts_enabled,
    sttEnabled: row.stt_enabled,
    systemPrompt: row.system_prompt,
    greetingEnabled: row.greeting_enabled,
    greetingInstruction: row.greeting_instruction,
    updatedAt: row.updated_at,
  };
}

async function getSchemaCapabilities(): Promise<StarterSettingsSchemaCapabilities> {
  if (!schemaCapabilitiesPromise) {
    schemaCapabilitiesPromise = pool
      .query<{ column_name: string }>(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'starter_agent_settings'
           AND column_name IN ('tts_servers_json', 'active_tts_server_id', 'is_active')`
      )
      .then((result) => {
        const names = new Set(result.rows.map((row) => row.column_name));
        return {
          hasTtsServersJson: names.has("tts_servers_json"),
          hasActiveTtsServerId: names.has("active_tts_server_id"),
          hasIsActive: names.has("is_active"),
        };
      })
      .catch((error) => {
        schemaCapabilitiesPromise = null;
        throw error;
      });
  }
  return schemaCapabilitiesPromise;
}

export async function hasStarterAgentIsActiveColumn(): Promise<boolean> {
  const capabilities = await getSchemaCapabilities();
  return capabilities.hasIsActive;
}

export async function ensureStarterAgentIsActiveColumn(): Promise<void> {
  const hasIsActive = await hasStarterAgentIsActiveColumn();
  if (hasIsActive) return;

  if (!ensureIsActivePromise) {
    ensureIsActivePromise = (async () => {
      await pool.query(`
        ALTER TABLE starter_agent_settings
        ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT FALSE
      `);
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS starter_agent_settings_one_active_idx
        ON starter_agent_settings (is_active)
        WHERE is_active = TRUE
      `);
      // Reset cached capabilities so subsequent reads reflect the new column.
      schemaCapabilitiesPromise = null;
    })()
      .catch((error) => {
        ensureIsActivePromise = null;
        throw error;
      })
      .finally(() => {
        ensureIsActivePromise = null;
      });
  }

  await ensureIsActivePromise;
}

function toJsonbParam(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return JSON.stringify(value);
}

function normalizeTtsServers(input: unknown[] | null): TtsServerEntry[] | null {
  if (!Array.isArray(input)) return null;
  const result = input
    .filter((item) => typeof item === "object" && item !== null)
    .map((item) => {
      const value = item as Record<string, unknown>;
      const id = typeof value.id === "string" ? value.id.trim() : "";
      const name = typeof value.name === "string" ? value.name.trim() : "";
      const engine = normalizeTtsEngine(value.engine);
      const config = typeof value.config === "object" && value.config !== null ? (value.config as Record<string, unknown>) : undefined;
      return {
        id,
        name: name || "TTS Server",
        engine,
        ...(config ? { config } : {}),
      };
    })
    .filter((item) => item.id.length > 0);
  return result;
}
