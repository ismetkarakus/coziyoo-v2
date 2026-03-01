ALTER TABLE starter_agent_settings
  ADD COLUMN IF NOT EXISTS tts_servers_json JSONB,
  ADD COLUMN IF NOT EXISTS active_tts_server_id TEXT;
