ALTER TABLE starter_agent_settings
  ADD COLUMN IF NOT EXISTS tts_engine TEXT NOT NULL DEFAULT 'f5-tts';

UPDATE starter_agent_settings
SET tts_engine = 'f5-tts'
WHERE tts_engine IS NULL OR tts_engine = '';
