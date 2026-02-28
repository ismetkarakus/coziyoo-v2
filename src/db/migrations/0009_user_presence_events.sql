CREATE TABLE IF NOT EXISTS user_presence_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('app_user', 'admin_user')),
  subject_id UUID NOT NULL,
  session_id UUID,
  event_type TEXT NOT NULL CHECK (event_type IN ('login', 'refresh', 'logout')),
  ip TEXT,
  user_agent TEXT,
  happened_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_presence_subject_happened
  ON user_presence_events(subject_type, subject_id, happened_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_presence_happened
  ON user_presence_events(happened_at DESC);
