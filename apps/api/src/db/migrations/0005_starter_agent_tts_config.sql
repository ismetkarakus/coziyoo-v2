ALTER TABLE starter_agent_settings
  ADD COLUMN IF NOT EXISTS tts_config_json JSONB;
