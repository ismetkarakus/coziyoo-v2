-- Add is_active flag to starter_agent_settings so one profile can be
-- designated as the default/active profile in the admin panel.
-- Only one row may have is_active = TRUE at a time (enforced by the partial index).

ALTER TABLE starter_agent_settings
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS starter_agent_settings_one_active_idx
  ON starter_agent_settings (is_active)
  WHERE is_active = TRUE;
