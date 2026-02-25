ALTER TABLE starter_agent_settings
  ADD COLUMN IF NOT EXISTS ollama_model TEXT NOT NULL DEFAULT 'llama3.1';
