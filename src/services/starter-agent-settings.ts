import { pool } from "../db/client.js";
import { DEFAULT_TTS_ENGINE, normalizeTtsEngine, type TtsEngine } from "./tts-engines.js";

export type StarterAgentSettings = {
  deviceId: string;
  agentName: string;
  voiceLanguage: string;
  ttsEngine: TtsEngine;
  ttsConfig: Record<string, unknown> | null;
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
  ttsEngine: TtsEngine;
  ttsConfig?: Record<string, unknown>;
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
    tts_engine: string;
    tts_config_json: Record<string, unknown> | null;
    tts_enabled: boolean;
    stt_enabled: boolean;
    system_prompt: string | null;
    greeting_enabled: boolean;
    greeting_instruction: string | null;
    updated_at: string;
  }>(
    `SELECT device_id, agent_name, voice_language, tts_engine, tts_config_json, tts_enabled, stt_enabled, system_prompt, greeting_enabled, greeting_instruction, updated_at::text
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
    ttsEngine: normalizeTtsEngine(row.tts_engine),
    ttsConfig: row.tts_config_json ?? null,
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
    tts_engine: string;
    tts_config_json: Record<string, unknown> | null;
    tts_enabled: boolean;
    stt_enabled: boolean;
    system_prompt: string | null;
    greeting_enabled: boolean;
    greeting_instruction: string | null;
    updated_at: string;
  }>(
    `INSERT INTO starter_agent_settings (device_id, agent_name, voice_language, tts_engine, tts_config_json, tts_enabled, stt_enabled, system_prompt, greeting_enabled, greeting_instruction, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
     ON CONFLICT (device_id)
     DO UPDATE SET
       agent_name = EXCLUDED.agent_name,
       voice_language = EXCLUDED.voice_language,
       tts_engine = EXCLUDED.tts_engine,
       tts_config_json = EXCLUDED.tts_config_json,
       tts_enabled = EXCLUDED.tts_enabled,
       stt_enabled = EXCLUDED.stt_enabled,
       system_prompt = EXCLUDED.system_prompt,
       greeting_enabled = EXCLUDED.greeting_enabled,
       greeting_instruction = EXCLUDED.greeting_instruction,
       updated_at = now()
     RETURNING device_id, agent_name, voice_language, tts_engine, tts_config_json, tts_enabled, stt_enabled, system_prompt, greeting_enabled, greeting_instruction, updated_at::text`,
    [
      input.deviceId,
      input.agentName,
      input.voiceLanguage,
      input.ttsEngine ?? DEFAULT_TTS_ENGINE,
      input.ttsConfig ?? null,
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
    ttsEngine: normalizeTtsEngine(row.tts_engine),
    ttsConfig: row.tts_config_json ?? null,
    ttsEnabled: row.tts_enabled,
    sttEnabled: row.stt_enabled,
    systemPrompt: row.system_prompt,
    greetingEnabled: row.greeting_enabled,
    greetingInstruction: row.greeting_instruction,
    updatedAt: row.updated_at,
  };
}
