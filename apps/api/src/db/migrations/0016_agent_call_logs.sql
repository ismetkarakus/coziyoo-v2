BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.agent_call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_name TEXT NOT NULL,
  profile_id UUID NULL REFERENCES public.agent_profiles(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  outcome TEXT NOT NULL DEFAULT 'completed',
  summary TEXT NULL,
  device_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_call_logs_started_at_idx
  ON public.agent_call_logs (started_at DESC);

CREATE INDEX IF NOT EXISTS agent_call_logs_profile_started_idx
  ON public.agent_call_logs (profile_id, started_at DESC);

COMMIT;
