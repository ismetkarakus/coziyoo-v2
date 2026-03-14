-- security_login_state: one row per (realm, identifier), tracks rate-limiting state
CREATE TABLE security_login_state (
  realm TEXT NOT NULL,
  identifier TEXT NOT NULL,
  consecutive_failed_count INTEGER NOT NULL DEFAULT 0,
  last_failed_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_device_id TEXT,
  last_device_name TEXT,
  last_ip TEXT,
  soft_locked BOOLEAN NOT NULL DEFAULT FALSE,
  soft_locked_at TIMESTAMPTZ,
  unlock_token TEXT,
  unlock_token_expires_at TIMESTAMPTZ,
  PRIMARY KEY (realm, identifier)
);

-- security_login_events: append-only event log
CREATE TABLE security_login_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  realm TEXT NOT NULL,
  actor_user_id UUID,
  identifier TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  failure_reason TEXT,
  device_id TEXT,
  device_name TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_security_login_events_created_at ON security_login_events (created_at DESC);
CREATE INDEX idx_security_login_events_realm_identifier ON security_login_events (realm, identifier, created_at DESC);
CREATE INDEX idx_security_login_events_realm_device_id ON security_login_events (realm, device_id, created_at DESC);
CREATE INDEX idx_security_login_events_realm_ip ON security_login_events (realm, ip, created_at DESC);
