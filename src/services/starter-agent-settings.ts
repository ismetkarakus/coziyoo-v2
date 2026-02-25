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

export async function getStarterAgentSettings(deviceId: string): Promise<StarterAgentSettings | null> {
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

export async function upsertStarterAgentSettings(input: UpsertStarterAgentSettingsInput): Promise<StarterAgentSettings> {
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
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
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
      input.ttsConfig ?? null,
      input.ttsServers ?? null,
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
