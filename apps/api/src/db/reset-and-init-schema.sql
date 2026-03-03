CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
    EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
  END LOOP;
END $$;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_id TEXT UNIQUE NOT NULL DEFAULT substr(encode(gen_random_bytes(8), 'hex'), 1, 12),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT UNIQUE NOT NULL,
  display_name_normalized TEXT UNIQUE NOT NULL,
  full_name TEXT,
  phone TEXT,
  profile_image_url TEXT,
  user_type TEXT NOT NULL CHECK (user_type IN ('buyer', 'seller', 'both')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  legal_hold_state BOOLEAN NOT NULL DEFAULT FALSE,
  country_code TEXT,
  language TEXT,
  latitude NUMERIC(9,6) CHECK (latitude BETWEEN -90 AND 90),
  longitude NUMERIC(9,6) CHECK (longitude BETWEEN -180 AND 180),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_user_type ON users(user_type);
CREATE INDEX idx_users_country ON users(country_code);

CREATE TABLE admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'super_admin')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  refresh_token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  device_info TEXT,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX idx_auth_sessions_exp ON auth_sessions(expires_at);
CREATE INDEX idx_auth_sessions_active ON auth_sessions(user_id) WHERE revoked_at IS NULL;

CREATE TABLE user_login_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES auth_sessions(id) ON DELETE SET NULL,
  latitude NUMERIC(9,6) NOT NULL,
  longitude NUMERIC(9,6) NOT NULL,
  accuracy_m INTEGER,
  source TEXT NOT NULL DEFAULT 'app',
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_login_locations_user_created
  ON user_login_locations(user_id, created_at DESC);

CREATE TABLE admin_auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  refresh_token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  device_info TEXT,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX idx_admin_auth_sessions_user ON admin_auth_sessions(admin_user_id);
CREATE INDEX idx_admin_auth_sessions_exp ON admin_auth_sessions(expires_at);
CREATE INDEX idx_admin_auth_sessions_active ON admin_auth_sessions(admin_user_id) WHERE revoked_at IS NULL;

CREATE TABLE user_presence_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('app_user', 'admin_user')),
  subject_id UUID NOT NULL,
  session_id UUID,
  event_type TEXT NOT NULL CHECK (event_type IN ('login', 'refresh', 'logout')),
  ip TEXT,
  user_agent TEXT,
  happened_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_presence_subject_happened
  ON user_presence_events(subject_type, subject_id, happened_at DESC);

CREATE INDEX idx_user_presence_happened
  ON user_presence_events(happened_at DESC);

CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_tr TEXT NOT NULL,
  name_en TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE foods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_id TEXT UNIQUE NOT NULL DEFAULT substr(encode(gen_random_bytes(8), 'hex'), 1, 12),
  seller_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  category_id UUID REFERENCES categories(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  card_summary TEXT,
  description TEXT,
  recipe TEXT,
  country_code TEXT,
  price NUMERIC(12,2) NOT NULL,
  image_url TEXT,
  ingredients_json JSONB,
  allergens_json JSONB,
  preparation_time_minutes INTEGER,
  serving_size TEXT,
  delivery_fee NUMERIC(12,2) DEFAULT 0,
  max_delivery_distance_km NUMERIC(8,2),
  delivery_options_json JSONB,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  rating NUMERIC(3,2) NOT NULL DEFAULT 0,
  review_count INTEGER NOT NULL DEFAULT 0,
  favorite_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_foods_seller ON foods(seller_id);
CREATE INDEX idx_foods_category ON foods(category_id);
CREATE INDEX idx_foods_active ON foods(is_active);

CREATE TABLE favorites (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  food_id UUID NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, food_id)
);

CREATE TABLE user_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  address_line TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uniq_user_default_address ON user_addresses(user_id) WHERE is_default = TRUE;

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_id TEXT UNIQUE NOT NULL DEFAULT substr(encode(gen_random_bytes(8), 'hex'), 1, 12),
  buyer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seller_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL,
  delivery_type TEXT NOT NULL,
  delivery_address_json JSONB,
  total_price NUMERIC(12,2) NOT NULL,
  requested_at TIMESTAMPTZ,
  estimated_delivery_time TIMESTAMPTZ,
  payment_completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_buyer ON orders(buyer_id);
CREATE INDEX idx_orders_seller ON orders(seller_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created ON orders(created_at);

CREATE TABLE complaint_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_complaint_categories_is_active ON complaint_categories(is_active);

CREATE TABLE complaints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  complainant_buyer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  subject TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'in_review', 'resolved', 'closed')),
  description TEXT,
  category_id UUID REFERENCES complaint_categories(id) ON DELETE SET NULL,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  assigned_admin_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_complaints_order ON complaints(order_id);
CREATE INDEX idx_complaints_buyer ON complaints(complainant_buyer_id);
CREATE INDEX idx_complaints_status ON complaints(status);
CREATE INDEX idx_complaints_created_at ON complaints(created_at DESC);
CREATE INDEX idx_complaints_category ON complaints(category_id);
CREATE INDEX idx_complaints_priority ON complaints(priority);
CREATE INDEX idx_complaints_assigned_admin ON complaints(assigned_admin_id);

CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  lot_id UUID,
  food_id UUID NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL,
  line_total NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, lot_id)
);

CREATE TABLE order_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  payload_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  buyer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  provider_session_id TEXT UNIQUE,
  provider_reference_id TEXT UNIQUE,
  status TEXT NOT NULL,
  callback_payload_json JSONB,
  signature_valid BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE commission_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commission_rate NUMERIC(5,4) NOT NULL CHECK (commission_rate >= 0 AND commission_rate <= 1),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES admin_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_finance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  seller_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  gross_amount NUMERIC(12,2) NOT NULL,
  commission_rate_snapshot NUMERIC(5,4) NOT NULL,
  commission_amount NUMERIC(12,2) NOT NULL,
  seller_net_amount NUMERIC(12,2) NOT NULL,
  finalized_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payment_dispute_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  payment_attempt_id UUID NOT NULL REFERENCES payment_attempts(id) ON DELETE RESTRICT,
  provider_case_id TEXT UNIQUE,
  case_type TEXT NOT NULL CHECK (case_type IN ('refund', 'chargeback')),
  reason_code TEXT,
  liability_party TEXT NOT NULL CHECK (liability_party IN ('seller', 'platform', 'provider', 'shared')),
  liability_ratio_json JSONB,
  status TEXT NOT NULL CHECK (status IN ('opened', 'under_review', 'won', 'lost', 'closed')),
  evidence_bundle_json JSONB,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE finance_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  seller_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  dispute_case_id UUID REFERENCES payment_dispute_cases(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE finance_reconciliation_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('seller', 'admin')),
  actor_id UUID NOT NULL,
  report_type TEXT NOT NULL CHECK (report_type IN ('payout_summary', 'order_settlement', 'refund_chargeback', 'tax_base')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'ready', 'failed')),
  file_url TEXT,
  checksum TEXT,
  generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE compliance_documents_list (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  source_info TEXT,
  details TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_required_default BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE seller_compliance_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_list_id UUID NOT NULL REFERENCES compliance_documents_list(id) ON DELETE RESTRICT,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL CHECK (status IN ('requested', 'uploaded', 'approved', 'rejected')),
  file_url TEXT,
  uploaded_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewed_by_admin_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  rejection_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (seller_id, document_list_id)
);

CREATE TABLE seller_optional_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_list_id UUID REFERENCES compliance_documents_list(id) ON DELETE SET NULL,
  custom_title TEXT,
  custom_description TEXT,
  file_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'approved', 'rejected', 'archived')),
  reviewed_at TIMESTAMPTZ,
  reviewed_by_admin_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    document_list_id IS NOT NULL
    OR (custom_title IS NOT NULL AND length(trim(custom_title)) > 0)
  )
);

CREATE INDEX idx_compliance_documents_list_active ON compliance_documents_list(is_active);
CREATE INDEX idx_seller_compliance_documents_seller ON seller_compliance_documents(seller_id);
CREATE INDEX idx_seller_compliance_documents_status ON seller_compliance_documents(status);
CREATE INDEX idx_seller_compliance_documents_list_id ON seller_compliance_documents(document_list_id);
CREATE INDEX idx_seller_optional_uploads_seller ON seller_optional_uploads(seller_id);
CREATE INDEX idx_seller_optional_uploads_status ON seller_optional_uploads(status);
CREATE INDEX idx_seller_optional_uploads_document_list_id ON seller_optional_uploads(document_list_id);
CREATE INDEX idx_seller_optional_uploads_created_at ON seller_optional_uploads(created_at DESC);

CREATE OR REPLACE FUNCTION seed_seller_compliance_documents_on_user_upsert()
RETURNS trigger AS $$
BEGIN
  IF NEW.user_type IN ('seller', 'both') THEN
    INSERT INTO seller_compliance_documents (
      seller_id,
      document_list_id,
      is_required,
      status,
      created_at,
      updated_at
    )
    SELECT
      NEW.id,
      cdl.id,
      cdl.is_required_default,
      'requested',
      now(),
      now()
    FROM compliance_documents_list cdl
    WHERE cdl.is_active = TRUE
    ON CONFLICT (seller_id, document_list_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_seed_seller_compliance_documents_on_users
AFTER INSERT OR UPDATE OF user_type ON users
FOR EACH ROW
EXECUTE FUNCTION seed_seller_compliance_documents_on_user_upsert();

CREATE TABLE production_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  food_id UUID NOT NULL,
  lot_number TEXT NOT NULL UNIQUE,
  produced_at TIMESTAMPTZ NOT NULL,
  sale_starts_at TIMESTAMPTZ NOT NULL,
  sale_ends_at TIMESTAMPTZ NOT NULL,
  use_by TIMESTAMPTZ,
  best_before TIMESTAMPTZ,
  recipe_snapshot TEXT,
  ingredients_snapshot_json JSONB,
  allergens_snapshot_json JSONB,
  quantity_produced INTEGER NOT NULL CHECK (quantity_produced >= 0),
  quantity_available INTEGER NOT NULL CHECK (quantity_available >= 0),
  status TEXT NOT NULL CHECK (status IN ('open', 'locked', 'depleted', 'recalled', 'discarded', 'expired')),
  CONSTRAINT production_lots_sale_window_check CHECK (sale_starts_at <= sale_ends_at),
  CONSTRAINT production_lots_produced_before_sale_start_check CHECK (produced_at <= sale_starts_at),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION prevent_production_lot_mutating_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'production_lots records are immutable and cannot be deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_production_lot_delete
BEFORE DELETE ON production_lots
FOR EACH ROW
EXECUTE FUNCTION prevent_production_lot_mutating_delete();

CREATE TRIGGER trg_prevent_production_lot_truncate
BEFORE TRUNCATE ON production_lots
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_production_lot_mutating_delete();

CREATE TABLE order_item_lot_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  lot_id UUID NOT NULL REFERENCES production_lots(id) ON DELETE RESTRICT,
  quantity_allocated INTEGER NOT NULL CHECK (quantity_allocated > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE order_items
ADD CONSTRAINT order_items_lot_id_fkey
FOREIGN KEY (lot_id) REFERENCES production_lots(id) ON DELETE RESTRICT;

CREATE TABLE lot_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id UUID NOT NULL REFERENCES production_lots(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_payload_json JSONB,
  created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE allergen_disclosure_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  seller_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  buyer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  food_id UUID NOT NULL REFERENCES foods(id) ON DELETE RESTRICT,
  phase TEXT NOT NULL CHECK (phase IN ('pre_order', 'handover')),
  allergen_snapshot_json JSONB NOT NULL,
  disclosure_method TEXT NOT NULL,
  buyer_confirmation TEXT NOT NULL,
  evidence_ref TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, phase)
);

CREATE TABLE delivery_proof_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  seller_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  buyer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  proof_mode TEXT NOT NULL DEFAULT 'pin',
  pin_hash TEXT NOT NULL,
  pin_sent_at TIMESTAMPTZ,
  pin_sent_channel TEXT NOT NULL DEFAULT 'in_app',
  pin_verified_at TIMESTAMPTZ,
  verification_attempts INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('pending', 'verified', 'failed', 'expired')),
  metadata_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seller_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  order_id UUID REFERENCES orders(id) ON DELETE RESTRICT,
  last_message TEXT,
  last_message_time TIMESTAMPTZ,
  last_message_sender TEXT,
  buyer_unread_count INTEGER NOT NULL DEFAULT 0,
  seller_unread_count INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  sender_type TEXT NOT NULL,
  message TEXT,
  message_type TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'order_update')),
  order_data_json JSONB,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_chat_created ON messages(chat_id, created_at DESC);

CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  food_id UUID NOT NULL REFERENCES foods(id) ON DELETE RESTRICT,
  buyer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seller_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  images_json JSONB,
  helpful_count INTEGER NOT NULL DEFAULT 0,
  report_count INTEGER NOT NULL DEFAULT 0,
  is_verified_purchase BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (buyer_id, food_id, order_id)
);

CREATE TABLE sms_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  admin_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  message TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sms_logs_buyer_created
  ON sms_logs(buyer_id, created_at DESC);

CREATE TABLE buyer_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  admin_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_buyer_notes_buyer_created
  ON buyer_notes(buyer_id, created_at DESC);

CREATE TABLE buyer_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (buyer_id, tag)
);

CREATE INDEX idx_buyer_tags_buyer
  ON buyer_tags(buyer_id);

CREATE TABLE notification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data_json JSONB,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  object_key TEXT NOT NULL,
  public_url TEXT,
  content_type TEXT,
  size_bytes BIGINT,
  checksum TEXT,
  related_entity_type TEXT,
  related_entity_id UUID,
  status TEXT NOT NULL,
  metadata_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_admin_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  actor_email TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_json JSONB,
  after_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auth_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admin_auth_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID REFERENCES admin_users(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admin_api_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'super_admin')),
  token_hash TEXT NOT NULL,
  token_preview TEXT NOT NULL,
  claims_json JSONB,
  created_by_admin_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_api_tokens_created_by ON admin_api_tokens(created_by_admin_id, created_at DESC);
CREATE INDEX idx_admin_api_tokens_active ON admin_api_tokens(created_at DESC) WHERE revoked_at IS NULL;

CREATE TABLE abuse_risk_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('user', 'device', 'ip', 'session', 'order')),
  subject_id TEXT NOT NULL,
  flow TEXT NOT NULL,
  risk_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  decision TEXT NOT NULL CHECK (decision IN ('allow', 'challenge', 'deny', 'review')),
  reason_codes_json JSONB,
  request_fingerprint TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER,
  response_body_json JSONB,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scope, key_hash)
);

CREATE TABLE admin_table_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  table_key TEXT NOT NULL,
  visible_columns JSONB NOT NULL,
  column_order JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (admin_user_id, table_key)
);

CREATE TABLE starter_agent_settings (
  device_id TEXT PRIMARY KEY,
  agent_name TEXT NOT NULL,
  voice_language TEXT NOT NULL,
  ollama_model TEXT NOT NULL DEFAULT 'llama3.1',
  tts_engine TEXT NOT NULL DEFAULT 'f5-tts',
  tts_config_json JSONB,
  tts_servers_json JSONB,
  active_tts_server_id TEXT,
  tts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  stt_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  system_prompt TEXT,
  greeting_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  greeting_instruction TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'processed', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX idx_outbox_pending ON outbox_events(status, next_attempt_at);

CREATE TABLE outbox_dead_letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_event_id UUID REFERENCES outbox_events(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  last_error TEXT,
  failed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
