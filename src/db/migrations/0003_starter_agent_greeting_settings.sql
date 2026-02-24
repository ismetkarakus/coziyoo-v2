ALTER TABLE starter_agent_settings
  ADD COLUMN IF NOT EXISTS greeting_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS greeting_instruction TEXT;
