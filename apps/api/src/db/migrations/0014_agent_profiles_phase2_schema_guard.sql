BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.agent_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  speaks_first BOOLEAN NOT NULL DEFAULT FALSE,
  system_prompt TEXT,
  greeting_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  greeting_instruction TEXT,
  voice_language TEXT NOT NULL DEFAULT 'tr',
  llm_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  stt_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  tts_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  n8n_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.agent_profiles
  ADD COLUMN IF NOT EXISTS speaks_first BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS system_prompt TEXT,
  ADD COLUMN IF NOT EXISTS greeting_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS greeting_instruction TEXT,
  ADD COLUMN IF NOT EXISTS voice_language TEXT NOT NULL DEFAULT 'tr',
  ADD COLUMN IF NOT EXISTS llm_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS stt_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS tts_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS n8n_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS agent_profiles_one_active_idx
  ON public.agent_profiles (is_active)
  WHERE is_active = TRUE;

COMMIT;
