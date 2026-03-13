# Phase 1: Supabase DB Cutover - Research

**Researched:** 2026-03-12
**Domain:** PostgreSQL database migration, Supabase connection strings, memory table schema design
**Confidence:** HIGH

## Summary

Phase 1 is a database cutover from a local PostgreSQL instance to Supabase. The codebase already supports this: `apps/api/src/db/client.ts` uses the `pg` driver with a `DATABASE_URL` connection string, and `apps/api/src/config/env.ts` accepts `DATABASE_URL` as the first-priority database configuration. The Supabase credentials are already present in `.env.local` (`SUPABASE_DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`). This means the cutover itself is an env var swap — no code changes required for DB-01.

The two additional tasks are: (1) run a smoke test verifying all existing API endpoint groups (auth, orders, payments, finance) return correct data against Supabase; and (2) create two new memory tables (`session_memory`, `long_term_memory`) in the Supabase schema via a new numbered migration file (0006). The `db-migrate.sh` script already handles idempotent migration tracking via a `schema_migrations` table, and it has a legacy bootstrap path that handles the case where the target DB already has the core schema without migration history.

**Primary recommendation:** Set `DATABASE_URL=<SUPABASE_DATABASE_URL>` and `DATABASE_SSL_MODE=no-verify` (Supabase uses TLS with a self-signed pooler cert), restart the API, confirm `pingDatabase()` succeeds, then run the existing smoke tests plus a new migration for memory tables.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DB-01 | API environment updated to point to Supabase PostgreSQL (connection string swap via env vars — no code changes) | `DATABASE_URL` is already the first-priority config; `SUPABASE_DATABASE_URL` is already in `.env.local`. Pure env var swap. |
| DB-02 | All existing API functionality verified working against Supabase (orders, auth, payments, finance) | Existing Vitest unit tests cover auth/security; a smoke test script hitting the live API covers the rest. The `db-migrate.sh` bootstrap handles the pre-seeded Supabase DB. |
| DB-03 | User memory tables (session memory + long-term memory) created in Supabase schema | New migration file `0006_user_memory_tables.sql` using `CREATE TABLE IF NOT EXISTS`. Schema design documented in this research. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `pg` (node-postgres) | already in use | PostgreSQL client used by the API | Already wired; no change needed |
| Supabase PostgreSQL | managed | Target database host | Project decision — twin copy already exists |
| `DATABASE_SSL_MODE` env var | custom | Controls TLS behavior for pg pool | Already implemented in `db/client.ts` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `psql` CLI | system | Run `db-migrate.sh` against Supabase | During plan 01-03 to apply the new migration |
| Supabase dashboard / SQL editor | web | Verify schema after migration | Manual verification step |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Direct `SUPABASE_DATABASE_URL` (transaction pooler, port 6543) | Session pooler (port 5432) or direct connection (port 5432) | Transaction pooler is default for serverless; session pooler needed if using prepared statements; direct connection bypasses PgBouncer entirely |

**Installation:** No new packages required.

## Architecture Patterns

### DB Connection Configuration
The API resolves its database URL in this priority order:
1. `DATABASE_URL` env var (if set, used directly)
2. Constructed from `PGHOST` + `PGPORT` + `PGUSER` + `PGPASSWORD` + `PGDATABASE`

For Supabase, use `DATABASE_URL` directly — this is the cleanest path.

### SSL Mode for Supabase
Supabase's connection pooler (`.pooler.supabase.com`) uses TLS but the cert may not pass standard CA verification. The existing `resolveSslOption()` in `db/client.ts` handles this:

```typescript
// Source: apps/api/src/db/client.ts
// When DATABASE_SSL_MODE=no-verify:
if (env.DATABASE_SSL_MODE === "no-verify") return { rejectUnauthorized: false };
```

Set `DATABASE_SSL_MODE=no-verify` alongside the Supabase `DATABASE_URL`.

### Migration Bootstrap for Pre-Seeded Supabase
The Supabase DB is a twin copy — the core schema already exists. The `db-migrate.sh` script has a bootstrap path for exactly this case:

```bash
# From installation/scripts/db-migrate.sh
# If schema_migrations is empty AND users table exists:
# → seeds schema_migrations with all existing migration filenames
# → exits without replaying migrations
# New migrations (e.g., 0006) are applied on next run.
```

This means running `db-migrate.sh` against Supabase is safe: it detects the pre-existing schema, bootstraps tracking, and only applies truly new migrations.

### Recommended Project Structure for New Migration
```
apps/api/src/db/migrations/
├── 0001_initial_schema.sql          # existing
├── 0002_user_dob_and_default_address_rules.sql  # existing
├── 0003_seller_payout_ledger.sql    # existing
├── 0004_admin_sales_commission_settings.sql     # existing
├── 0005_complaint_admin_notes.sql   # existing
└── 0006_user_memory_tables.sql      # NEW — phase 1, plan 01-03
```

### Pattern 1: Memory Table Schema (DB-03)
**What:** Two tables for the n8n per-turn memory system. `session_memory` stores transient per-conversation state keyed by room/session ID. `long_term_memory` stores durable per-user preferences and history.

**When to use:** Phase 7 will add pgvector; Phase 1 needs only the base structured tables.

**Example:**
```sql
-- Source: Derived from REQUIREMENTS.md MEM-01/MEM-04 and project decisions
-- File: apps/api/src/db/migrations/0006_user_memory_tables.sql

CREATE TABLE IF NOT EXISTS public.session_memory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id text NOT NULL,
    user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
    data jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT session_memory_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_memory_room_id
    ON public.session_memory (room_id);

CREATE TABLE IF NOT EXISTS public.long_term_memory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    dietary_preferences jsonb NOT NULL DEFAULT '{}',
    personal_details jsonb NOT NULL DEFAULT '{}',
    order_history_summary jsonb NOT NULL DEFAULT '{}',
    conversation_style jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT long_term_memory_pkey PRIMARY KEY (id),
    CONSTRAINT long_term_memory_user_id_key UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_long_term_memory_user_id
    ON public.long_term_memory (user_id);
```

**Note on pgvector:** MEM-04 requires pgvector for semantic/conversation-style memory — that is Phase 7 scope. Phase 1 only creates the base tables. The `conversation_style jsonb` column is a placeholder; Phase 7 will add a vector column via a separate migration.

### Anti-Patterns to Avoid
- **Using PGHOST/PGPORT/PGUSER vars for Supabase:** These require separate vars; `DATABASE_URL` is cleaner and already supported as first priority.
- **Setting `DATABASE_SSL_MODE=disable` for Supabase:** Will cause TLS handshake failure against the Supabase pooler.
- **Setting `DATABASE_SSL_MODE=require` (strict):** May fail cert verification against the pooler's self-signed cert. Use `no-verify`.
- **Running `db-migrate.sh` without bootstrap awareness:** The script handles this correctly already; do not bypass it with manual `psql -f` of all migration files against Supabase (would replay non-idempotent parts of 0001).
- **Designing memory tables without `IF NOT EXISTS`:** Migrations must be idempotent per the existing pattern in migrations 0002–0005.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Migration tracking | Custom migration runner | `db-migrate.sh` | Already handles idempotency, bootstrap, schema_migrations table |
| SSL negotiation | Custom TLS config | `DATABASE_SSL_MODE=no-verify` + existing `resolveSslOption()` | Already implemented and tested |
| Schema inspection | Custom table-exists check | `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` | PostgreSQL idiomatic; matches existing migration style |

**Key insight:** Everything needed for the DB cutover already exists in the codebase. The work is configuration and verification, not new code.

## Common Pitfalls

### Pitfall 1: Wrong Supabase Connection String (Transaction vs Session Pooler)
**What goes wrong:** The `SUPABASE_DATABASE_URL` in `.env.local` points to the transaction pooler (`*.pooler.supabase.com:6543`). If the API uses prepared statements or long-lived transactions, this will fail.
**Why it happens:** Supabase's transaction pooler (PgBouncer) does not support prepared statements or `BEGIN/COMMIT` across separate requests.
**How to avoid:** The `pg` driver does not use prepared statements by default. Verify no explicit `prepare: true` is set. If issues arise, switch to the session pooler (port 5432) or the direct connection string from the Supabase dashboard.
**Warning signs:** `prepared statement "..." does not exist` errors in API logs after cutover.

### Pitfall 2: Missing `schema_migrations` Bootstrap on Supabase
**What goes wrong:** Running `db-migrate.sh` against the Supabase DB without the bootstrap path would attempt to replay all migrations including 0001 (which is a full pg_dump with `\restrict` and non-idempotent CREATE statements).
**Why it happens:** The Supabase DB already has the full schema; 0001 was applied during the twin copy creation.
**How to avoid:** `db-migrate.sh` already handles this correctly via the bootstrap logic. Run it once and verify the log output says "Detected legacy DB without schema_migrations history; bootstrapping migration tracker".
**Warning signs:** Errors during `db-migrate.sh` run about duplicate tables/constraints.

### Pitfall 3: SSL Certificate Rejection
**What goes wrong:** API fails to connect to Supabase with `self-signed certificate in certificate chain` error.
**Why it happens:** `DATABASE_SSL_MODE` defaults to `auto`, which uses `{ rejectUnauthorized: false }` for non-localhost hosts — this should work. But if `DATABASE_SSL_MODE=require` is set explicitly, it uses `ssl: true` which does verify the cert chain.
**How to avoid:** Use `DATABASE_SSL_MODE=no-verify` explicitly when pointing at Supabase.
**Warning signs:** Connection refused or TLS errors at API startup.

### Pitfall 4: Supabase Row Level Security (RLS)
**What goes wrong:** New tables created in the `public` schema on Supabase may have RLS enabled by default in some Supabase project configurations.
**Why it happens:** Supabase enables RLS on new tables when the project setting is active.
**How to avoid:** The API connects with the Supabase service role key (bypasses RLS) via `SUPABASE_SERVICE_KEY`. However, the `pg` pool connects via `DATABASE_URL` (a standard PostgreSQL user), not via the Supabase client. The `postgres` user in `SUPABASE_DATABASE_URL` is the service role — it bypasses RLS. Explicitly add `ALTER TABLE public.session_memory DISABLE ROW LEVEL SECURITY;` to the migration if any issues arise.
**Warning signs:** Empty result sets or permission denied errors on newly created tables.

### Pitfall 5: Smoke Test Scope vs Unit Test Scope
**What goes wrong:** Running only the existing unit tests (`vitest run`) and declaring DB-02 complete. The existing Vitest tests mock the database and do not hit Supabase.
**Why it happens:** The test suite is unit-level; there are no integration tests that require a live DB connection.
**How to avoid:** DB-02 requires a live smoke test against the running API — either manual `curl` calls or a simple smoke test script hitting `/auth/login`, `/orders`, `/payments`, `/finance` endpoints. This is different from `npm run test:api`.
**Warning signs:** Tests pass but the actual API returns 500 errors after cutover.

## Code Examples

Verified patterns from official sources:

### Env Var Swap (DB-01)
```bash
# In .env.local — replace the local PostgreSQL vars with Supabase
DATABASE_URL=postgresql://postgres.yhfribehpmkbjrrgixsv:PASSWORD@aws-1-eu-central-1.pooler.supabase.com:6543/postgres
DATABASE_SSL_MODE=no-verify

# Remove or comment out the local PG vars (not required when DATABASE_URL is set):
# PGHOST=postgres
# PGPORT=5432
# PGUSER=coziyoo
# PGPASSWORD=...
# PGDATABASE=coziyoo
```

### Connectivity Verification
```bash
# Quick connectivity check using the API's own ping endpoint (if exposed)
curl -s http://localhost:3000/health | jq .

# Or direct psql test using the Supabase DATABASE_URL
psql "$SUPABASE_DATABASE_URL" -c "SELECT now();"
```

### Migration Bootstrap Verification
```bash
# After running db-migrate.sh, verify migration tracking is set up
psql "$SUPABASE_DATABASE_URL" -c "SELECT filename, applied_at FROM schema_migrations ORDER BY filename;"
```

### Memory Table Migration File
```sql
-- apps/api/src/db/migrations/0006_user_memory_tables.sql
CREATE TABLE IF NOT EXISTS public.session_memory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id text NOT NULL,
    user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
    data jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT session_memory_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_memory_room_id
    ON public.session_memory (room_id);

CREATE TABLE IF NOT EXISTS public.long_term_memory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    dietary_preferences jsonb NOT NULL DEFAULT '{}',
    personal_details jsonb NOT NULL DEFAULT '{}',
    order_history_summary jsonb NOT NULL DEFAULT '{}',
    conversation_style jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT long_term_memory_pkey PRIMARY KEY (id),
    CONSTRAINT long_term_memory_user_id_key UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_long_term_memory_user_id
    ON public.long_term_memory (user_id);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Local PostgreSQL (Docker container) | Supabase managed PostgreSQL | Phase 1 | Single DB for all services; n8n can read/write directly in Phase 5+ |
| PGHOST/PGPORT/PGUSER vars | `DATABASE_URL` connection string | Already supported | Simpler config for remote DBs |

**Deprecated/outdated:**
- Local Docker PostgreSQL: replaced by Supabase; `install_postgres.sh` and `docker-compose.yml` Postgres service become obsolete after cutover.

## Open Questions

1. **Transaction pooler vs session pooler for Supabase**
   - What we know: The `SUPABASE_DATABASE_URL` in `.env.local` uses port 6543 (transaction pooler). The `pg` driver does not use prepared statements by default.
   - What's unclear: Whether any part of the API or its dependencies uses session-level features incompatible with the transaction pooler.
   - Recommendation: Start with transaction pooler (6543); switch to session pooler (5432) if connection errors appear. Both URLs are available from the Supabase dashboard.

2. **Supabase DB data state — is it seeded?**
   - What we know: The twin DB copy exists and the schema is there. The STATE.md says "Twin DB copy already exists; env var swap only".
   - What's unclear: Whether test users, admin credentials, and sample orders exist in the Supabase DB for smoke testing.
   - Recommendation: Run `npm run seed:admin --workspace=apps/api` against Supabase if the admin user is missing, and check for test data. The `seed-data.sh` script is available for a full reseed.

3. **`pgcrypto` extension on Supabase**
   - What we know: The initial schema uses `CREATE EXTENSION IF NOT EXISTS pgcrypto`. Supabase supports pgcrypto.
   - What's unclear: Whether pgcrypto is already enabled on the Supabase project.
   - Recommendation: Supabase projects have pgcrypto available by default. If the twin copy was created from a pg_dump of the local DB, the extension is already there. Low risk.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.0.18 |
| Config file | none — uses `package.json` "test" script (`vitest run`) |
| Quick run command | `npm run test:api` (from monorepo root) |
| Full suite command | `npm run test:api` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DB-01 | API starts and connects to Supabase (DATABASE_URL points to Supabase) | smoke | `curl -s http://localhost:3000/health` or `psql $SUPABASE_DATABASE_URL -c "SELECT 1"` | ❌ Wave 0 — manual curl or new smoke script |
| DB-02 | Auth login, orders, payments, finance endpoints return 200 with data | smoke | Manual `curl` sequence or new smoke script | ❌ Wave 0 — no integration tests exist |
| DB-03 | `session_memory` and `long_term_memory` tables exist and are accessible | schema check | `psql $SUPABASE_DATABASE_URL -c "SELECT count(*) FROM session_memory;"` | ❌ Wave 0 — tables don't exist yet |

**Important:** The existing Vitest tests (`npm run test:api`) are unit tests with mocked DB — they do NOT verify Supabase connectivity. DB-02 specifically requires live API testing against Supabase.

### Sampling Rate
- **Per task commit:** `npm run test:api` (unit tests — verifies no regressions in API logic)
- **Per wave merge:** `npm run test:api` + manual smoke curl sequence against running API
- **Phase gate:** All unit tests green + live API smoke passes against Supabase before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] No integration or smoke test file exists — DB-01 and DB-02 require live API verification. Plan 01-02 should include a smoke verification checklist or simple curl script.
- [ ] `0006_user_memory_tables.sql` does not exist yet — created in plan 01-03.

*(Unit test infrastructure is fully in place; gaps are integration/smoke coverage only.)*

## Sources

### Primary (HIGH confidence)
- `apps/api/src/config/env.ts` — DATABASE_URL resolution logic, SSL mode enum, all env var schemas
- `apps/api/src/db/client.ts` — pg Pool creation, `resolveSslOption()` implementation
- `installation/scripts/db-migrate.sh` — migration runner, bootstrap logic, schema_migrations table
- `apps/api/src/db/migrations/0001-0005` — existing migration style and table patterns
- `.env.local` — Supabase credentials already present (`SUPABASE_DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`)
- `.planning/PROJECT.md`, `.planning/STATE.md` — project decisions confirming env-var-only approach

### Secondary (MEDIUM confidence)
- Supabase docs (general knowledge): transaction pooler on port 6543, session pooler on port 5432, pgcrypto available by default, RLS bypassed by service role
- `pg` driver behavior: no prepared statements by default, compatible with PgBouncer transaction pooler

### Tertiary (LOW confidence)
- Whether test data exists in the Supabase twin copy — not verified from codebase alone

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries are already in use; no new dependencies
- Architecture: HIGH — env.ts and db/client.ts source code directly examined
- Pitfalls: HIGH (SSL, bootstrap) / MEDIUM (RLS, pooler mode) — SSL and bootstrap from source code; RLS/pooler from general Supabase knowledge
- Memory table schema: MEDIUM — schema design matches existing patterns and Phase 7 requirements, but exact column design may evolve in Phase 7

**Research date:** 2026-03-12
**Valid until:** 2026-04-12 (stable — no fast-moving dependencies)
