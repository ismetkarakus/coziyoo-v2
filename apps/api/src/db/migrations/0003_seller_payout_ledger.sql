CREATE TABLE IF NOT EXISTS seller_bank_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id uuid NOT NULL,
    iban text NOT NULL,
    account_holder_name text NOT NULL,
    bank_code text,
    verification_status text NOT NULL DEFAULT 'pending',
    is_active boolean NOT NULL DEFAULT TRUE,
    payout_hold boolean NOT NULL DEFAULT FALSE,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT seller_bank_accounts_pkey PRIMARY KEY (id),
    CONSTRAINT seller_bank_accounts_seller_id_key UNIQUE (seller_id),
    CONSTRAINT seller_bank_accounts_verification_status_check CHECK (verification_status = ANY (ARRAY['pending'::text, 'verified'::text, 'rejected'::text]))
);

CREATE TABLE IF NOT EXISTS seller_ledger_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id uuid NOT NULL,
    order_id uuid,
    source_type text NOT NULL,
    source_id text NOT NULL,
    amount numeric(12,2) NOT NULL,
    currency text NOT NULL DEFAULT 'TRY',
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT seller_ledger_entries_pkey PRIMARY KEY (id),
    CONSTRAINT seller_ledger_entries_source_unique UNIQUE (source_type, source_id),
    CONSTRAINT seller_ledger_entries_source_type_check CHECK (source_type = ANY (ARRAY['order_finance'::text, 'finance_adjustment'::text, 'payout_debit'::text, 'payout_reversal'::text]))
);

CREATE TABLE IF NOT EXISTS seller_payout_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id uuid NOT NULL,
    payout_date date NOT NULL,
    batch_key text NOT NULL,
    currency text NOT NULL DEFAULT 'TRY',
    total_amount numeric(12,2) NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    transfer_reference text,
    provider_response_json jsonb,
    failure_reason text,
    paid_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT seller_payout_batches_pkey PRIMARY KEY (id),
    CONSTRAINT seller_payout_batches_batch_key_key UNIQUE (batch_key),
    CONSTRAINT seller_payout_batches_status_check CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'paid'::text, 'failed'::text])),
    CONSTRAINT seller_payout_batches_total_amount_check CHECK (total_amount > (0)::numeric)
);

CREATE TABLE IF NOT EXISTS seller_payout_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_id uuid NOT NULL,
    ledger_entry_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT seller_payout_items_pkey PRIMARY KEY (id),
    CONSTRAINT seller_payout_items_batch_ledger_unique UNIQUE (batch_id, ledger_entry_id)
);

ALTER TABLE ONLY seller_bank_accounts
  ADD CONSTRAINT seller_bank_accounts_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY seller_ledger_entries
  ADD CONSTRAINT seller_ledger_entries_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY seller_ledger_entries
  ADD CONSTRAINT seller_ledger_entries_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;

ALTER TABLE ONLY seller_payout_batches
  ADD CONSTRAINT seller_payout_batches_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY seller_payout_items
  ADD CONSTRAINT seller_payout_items_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES seller_payout_batches(id) ON DELETE CASCADE;

ALTER TABLE ONLY seller_payout_items
  ADD CONSTRAINT seller_payout_items_ledger_entry_id_fkey FOREIGN KEY (ledger_entry_id) REFERENCES seller_ledger_entries(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_seller_ledger_entries_seller_occurred ON seller_ledger_entries (seller_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_seller_payout_batches_seller_status ON seller_payout_batches (seller_id, status, payout_date DESC);
CREATE INDEX IF NOT EXISTS idx_seller_payout_items_ledger ON seller_payout_items (ledger_entry_id);
