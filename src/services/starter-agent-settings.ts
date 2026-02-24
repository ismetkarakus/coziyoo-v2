import { pool } from "../db/client.js";

export type StarterAgentSettings = {
  deviceId: string;
  agentName: string;
  voiceLanguage: string;
  ttsEnabled: boolean;
  sttEnabled: boolean;
  systemPrompt: string | null;
  updatedAt: string;
};

type UpsertStarterAgentSettingsInput = {
  deviceId: string;
  agentName: string;
  voiceLanguage: string;
  ttsEnabled: boolean;
  sttEnabled: boolean;
  systemPrompt?: string;
};

export async function getStarterAgentSettings(deviceId: string): Promise<StarterAgentSettings | null> {
  const result = await pool.query<{
    device_id: string;
    agent_name: string;
    voice_language: string;
    tts_enabled: boolean;
    stt_enabled: boolean;
    system_prompt: string | null;
    updated_at: string;
  }>(
    `SELECT device_id, agent_name, voice_language, tts_enabled, stt_enabled, system_prompt, updated_at::text
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
    ttsEnabled: row.tts_enabled,
    sttEnabled: row.stt_enabled,
    systemPrompt: row.system_prompt,
    updatedAt: row.updated_at,
  };
}

export async function upsertStarterAgentSettings(input: UpsertStarterAgentSettingsInput): Promise<StarterAgentSettings> {
  const result = await pool.query<{
    device_id: string;
    agent_name: string;
    voice_language: string;
    tts_enabled: boolean;
    stt_enabled: boolean;
    system_prompt: string | null;
    updated_at: string;
  }>(
    `INSERT INTO starter_agent_settings (device_id, agent_name, voice_language, tts_enabled, stt_enabled, system_prompt, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (device_id)
     DO UPDATE SET
       agent_name = EXCLUDED.agent_name,
       voice_language = EXCLUDED.voice_language,
       tts_enabled = EXCLUDED.tts_enabled,
       stt_enabled = EXCLUDED.stt_enabled,
       system_prompt = EXCLUDED.system_prompt,
       updated_at = now()
     RETURNING device_id, agent_name, voice_language, tts_enabled, stt_enabled, system_prompt, updated_at::text`,
    [
      input.deviceId,
      input.agentName,
      input.voiceLanguage,
      input.ttsEnabled,
      input.sttEnabled,
      input.systemPrompt ?? null,
    ]
  );

  const row = result.rows[0];
  return {
    deviceId: row.device_id,
    agentName: row.agent_name,
    voiceLanguage: row.voice_language,
    ttsEnabled: row.tts_enabled,
    sttEnabled: row.stt_enabled,
    systemPrompt: row.system_prompt,
    updatedAt: row.updated_at,
  };
}
