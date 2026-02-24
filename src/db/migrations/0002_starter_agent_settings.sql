CREATE TABLE IF NOT EXISTS starter_agent_settings (
  device_id TEXT PRIMARY KEY,
  agent_name TEXT NOT NULL,
  voice_language TEXT NOT NULL,
  tts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  stt_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  system_prompt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
