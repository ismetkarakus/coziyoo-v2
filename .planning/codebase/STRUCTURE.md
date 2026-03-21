# Codebase Structure

**Analysis Date:** 2026-03-21

## Directory Layout

```
coziyoo-v2/
├── apps/
│   ├── api/                           # Node.js/Express REST API
│   │   ├── src/
│   │   │   ├── app.ts                 # Express setup, middleware, route mounting
│   │   │   ├── server.ts              # Entry point, starts listener
│   │   │   ├── config/
│   │   │   │   └── env.ts             # Zod-validated environment schema
│   │   │   ├── db/
│   │   │   │   ├── client.ts          # PostgreSQL pool, connection management
│   │   │   │   └── migrations/        # Sequential SQL migration files (0001_*.sql → 0013_*.sql)
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts            # JWT verification, realm validation
│   │   │   │   ├── app-role.ts        # Buyer/seller role resolution
│   │   │   │   ├── admin-rbac.ts      # Admin permission checking
│   │   │   │   ├── abuse-protection.ts # Rate limiting
│   │   │   │   ├── idempotency.ts     # Request deduplication
│   │   │   │   └── observability.ts   # Request context, logging
│   │   │   ├── routes/                # 20 route files, domain-grouped
│   │   │   │   ├── auth.ts            # /v1/auth (app user login/register)
│   │   │   │   ├── admin-auth.ts      # /v1/admin/auth (admin login/logout)
│   │   │   │   ├── orders.ts          # /v1/orders (CRUD, state updates, voice orders)
│   │   │   │   ├── payments.ts        # /v1/payments (process, refund)
│   │   │   │   ├── compliance.ts      # /v1/*/compliance (seller docs, admin review)
│   │   │   │   ├── finance.ts         # /v1/sellers, /v1/admin/finance (payouts, disputes)
│   │   │   │   ├── foods.ts           # /v1/foods (catalog)
│   │   │   │   ├── lots.ts            # /v1/*/lots (inventory)
│   │   │   │   ├── livekit.ts         # /v1/livekit /v1/voice /v1/session (agent tokens)
│   │   │   │   ├── admin-*.ts         # 10+ admin routes (dashboard, users, audit, etc.)
│   │   │   │   └── health.ts          # /v1/health (database check)
│   │   │   ├── services/              # Business logic layer
│   │   │   │   ├── order-state-machine.ts    # Status transitions, role permissions
│   │   │   │   ├── finance.ts                # Payment processing, payout calculations
│   │   │   │   ├── outbox.ts                 # Transactional event queueing
│   │   │   │   ├── token-service.ts          # JWT generation/verification
│   │   │   │   ├── livekit.ts                # LiveKit token generation
│   │   │   │   ├── payout-scheduler.ts       # Background payout job
│   │   │   │   ├── payouts.ts                # Payout logic
│   │   │   │   ├── n8n.ts                    # N8N workflow webhooks
│   │   │   │   ├── ollama.ts                 # LLM integration
│   │   │   │   ├── login-security.ts         # 2FA, brute-force checks
│   │   │   │   └── [more services]
│   │   │   ├── types/
│   │   │   │   └── express.d.ts       # Express Request augmentation (auth, requestId)
│   │   │   └── utils/
│   │   │       ├── security.ts        # Password hashing (Argon2)
│   │   │       └── normalize.ts       # Content-type charset normalization
│   │   ├── dist/                      # Compiled output (tsc)
│   │   ├── tests/                     # Vitest test files
│   │   ├── openapi/                   # OpenAPI schema artifacts
│   │   ├── package.json               # Workspace package
│   │   └── tsconfig.json              # TypeScript config
│   │
│   ├── admin/                         # React/Vite admin panel
│   │   ├── src/
│   │   │   ├── main.tsx               # React root
│   │   │   ├── App.tsx                # React Router setup
│   │   │   ├── AppShell.tsx           # Main layout, navigation, global search
│   │   │   ├── lib/
│   │   │   │   ├── api.ts             # HTTP request wrapper, JWT refresh on 401
│   │   │   │   ├── auth.ts            # Token/admin storage (localStorage)
│   │   │   │   ├── i18n.ts            # Language switching (en/tr)
│   │   │   │   ├── [more helpers]
│   │   │   │   └── [10+ utility modules]
│   │   │   ├── pages/                 # One .tsx per admin page
│   │   │   │   ├── DashboardPage.tsx
│   │   │   │   ├── UsersPage.tsx
│   │   │   │   ├── ReviewQueuePage.tsx
│   │   │   │   ├── InvestigationPage.tsx
│   │   │   │   ├── [more pages]
│   │   │   │   └── users/            # User detail pages
│   │   │   ├── components/
│   │   │   │   ├── NotesPanel.tsx         # Reusable notes sidebar
│   │   │   │   ├── ApiHealthBadge.tsx     # API status indicator
│   │   │   │   ├── ui/                    # UI primitives
│   │   │   │   │   ├── KpiCard.tsx
│   │   │   │   │   ├── Pager.tsx
│   │   │   │   │   ├── SortableHeader.tsx
│   │   │   │   │   └── [more primitives]
│   │   │   │   ├── dashboard/             # Dashboard-specific components
│   │   │   │   ├── buyer/                 # Buyer detail components
│   │   │   │   └── [domain-specific dirs]
│   │   │   ├── i18n/
│   │   │   │   ├── en.json            # English strings
│   │   │   │   └── tr.json            # Turkish strings
│   │   │   ├── types/
│   │   │   │   └── core.ts            # Shared TypeScript types
│   │   │   ├── hooks/                 # Custom React hooks
│   │   │   └── [more]
│   │   ├── dist/                      # Vite build output
│   │   ├── public/                    # Static assets
│   │   ├── vite.config.ts             # Vite config (dev port 5174)
│   │   └── package.json
│   │
│   ├── mobile/                        # Expo/React Native app
│   │   ├── src/
│   │   │   ├── screens/               # Navigation screens
│   │   │   │   ├── HomeScreen.tsx     # Main buyer/seller feed
│   │   │   │   ├── LoginScreen.tsx    # Auth
│   │   │   │   ├── VoiceSessionScreen.tsx # Voice agent interface
│   │   │   │   └── [more screens]
│   │   │   ├── voice/                 # Voice session orchestration
│   │   │   │   ├── VoiceSessionScreen.tsx (duplicate?)
│   │   │   │   └── [voice hooks]
│   │   │   ├── utils/
│   │   │   │   ├── auth.ts            # JWT token management
│   │   │   │   ├── settings.ts        # User settings storage
│   │   │   │   └── [more helpers]
│   │   │   ├── theme/                 # Styling, colors
│   │   │   ├── copy/                  # Localization strings, brand voice
│   │   │   └── app.json               # Expo config
│   │   └── package.json
│   │
│   ├── voice-agent/                   # Python FastAPI + LiveKit Agents
│   │   ├── src/voice_agent/
│   │   │   ├── entrypoint.py          # Worker process, LLM/VAD/TTS pipeline
│   │   │   ├── join_api.py            # FastAPI endpoint for token generation
│   │   │   ├── config/
│   │   │   │   └── settings.py        # Env config
│   │   │   ├── providers/
│   │   │   │   ├── http_stt.py        # Speech-to-text HTTP provider
│   │   │   │   └── http_tts.py        # Text-to-speech HTTP provider
│   │   │   ├── tools/
│   │   │   │   └── sales_tools.py     # LLM tool definitions (actions)
│   │   │   ├── actions/
│   │   │   │   ├── schema.py          # UI action schemas
│   │   │   │   └── emitter.py         # Action dispatch to mobile
│   │   │   └── session/
│   │   │       └── end_session.py     # Order creation on call end
│   │   ├── tests/                     # Python tests
│   │   ├── workflows/                 # N8N workflow exports
│   │   └── .venv/                     # Python virtualenv
│   │
│   └── livekit/                       # (Placeholder/support files)
│
├── packages/                          # Shared npm workspaces
│   ├── shared-types/                  # TypeScript type definitions
│   │   ├── src/
│   │   │   └── index.ts               # Exported types
│   │   └── package.json
│   │
│   └── shared-utils/                  # Utility functions
│       ├── src/
│       │   └── index.ts               # Exported helpers
│       └── package.json
│
├── installation/                      # Deployment scripts
│   ├── scripts/
│   │   ├── install_all.sh             # First-time VPS setup
│   │   ├── update_all.sh              # Deploy + restart services
│   │   ├── db-migrate.sh              # Run pending migrations
│   │   ├── seed-data.sh               # Seed test data
│   │   └── generate_env.sh            # Create .env from template
│   ├── config.env                     # VPS-specific config
│   ├── nginx/                         # Nginx Proxy Manager Docker compose
│   └── systemd/                       # systemd service files
│
├── .planning/                         # GSD planning documents
│   ├── codebase/                      # Analysis docs (ARCHITECTURE.md, STRUCTURE.md, etc.)
│   └── phases/                        # Implementation phase plans
│
├── .github/
│   └── workflows/
│       └── deploy-on-push.yml         # CI/CD: SSH deploy on push
│
├── .env                               # Runtime config (single source of truth)
├── .env.local                         # Local overrides (loaded before .env)
├── .env.example                       # Template for first-time setup
├── package.json                       # Root workspace definition
├── package-lock.json                  # Lock file
├── docker-compose.yml                 # Dev database + services
├── CLAUDE.md                          # This file: Claude working instructions
└── README.md                          # Project overview
```

## Directory Purposes

**`apps/api/src/`** — Core REST API implementation
- **Purpose:** Serve buyer/seller/admin requests; manage orders, payments, compliance
- **Contains:** Route handlers, business logic, database queries
- **Key files:** `app.ts` (middleware setup), `server.ts` (entry point), routes in `routes/`, services in `services/`

**`apps/api/src/routes/`** — Request handlers grouped by domain
- **Purpose:** Define endpoints, validate input, call services
- **Contains:** 20 router files mounted at `/v1/*` paths
- **Naming:** `{domain}.ts` or `admin-{domain}.ts` (e.g., `orders.ts`, `admin-users.ts`)

**`apps/api/src/services/`** — Business logic, no HTTP coupling
- **Purpose:** Implement domain operations (order state machine, payouts, tokens)
- **Contains:** Pure functions and state managers
- **Import from routes:** Services always called by route handlers, never imported by other services

**`apps/api/src/middleware/`** — Request pipeline logic
- **Purpose:** Handle auth, rate limiting, idempotency, logging before routes execute
- **Order matters:** Middleware registered in `app.ts` in order: CORS → normalize → context → auth → abuse → idempotency → parse body

**`apps/api/src/db/`** — Database connectivity and migrations
- **Purpose:** Maintain database schema and manage connections
- **Contains:** PostgreSQL client pool, migration SQL files
- **Migrations:** Sequential numbered files (0001_*.sql) run in order by `db-migrate.sh`

**`apps/admin/src/pages/`** — Full-page components
- **Purpose:** One page per admin feature (Dashboard, Users, ReviewQueue, etc.)
- **Naming:** `{Feature}Page.tsx` (e.g., `DashboardPage.tsx`, `AuditPage.tsx`)
- **Import:** Pages are lazy-imported by AppShell router

**`apps/admin/src/components/ui/`** — Reusable UI primitives
- **Purpose:** Shared UI building blocks (buttons, cards, tables, pagers)
- **Naming:** PascalCase component name (e.g., `KpiCard.tsx`, `Pager.tsx`)
- **Usage:** Imported by pages and domain-specific components

**`apps/admin/src/lib/`** — Utility modules and helpers
- **Purpose:** API communication, auth state, i18n, formatting, table sorting
- **Key files:**
  - `api.ts` — HTTP request wrapper with JWT refresh on 401
  - `auth.ts` — Token storage in localStorage
  - `i18n.ts` — Language dictionaries and switching

**`apps/mobile/src/screens/`** — Navigation screens
- **Purpose:** Top-level screens (Home, Login, Settings, Voice)
- **Naming:** `{Name}Screen.tsx` (e.g., `HomeScreen.tsx`, `VoiceSessionScreen.tsx`)
- **Navigation:** Controlled by Expo Router or manual navigation state

**`apps/voice-agent/src/`** — Python voice agent implementation
- **Purpose:** LiveKit worker for handling AI voice calls
- **Contains:** LLM integration, audio processing, UI action dispatching
- **Entry:** `entrypoint.py` (worker), `join_api.py` (FastAPI server for token generation)

**`packages/shared-*`** — Shared code across workspaces
- **Purpose:** Types and utilities used by API, admin, mobile
- **Import as:** `@coziyoo/shared-types`, `@coziyoo/shared-utils`

**`installation/scripts/`** — Deployment automation
- **Purpose:** VPS setup, migrations, service restart
- **Run by:** CI/CD pipeline (deploy-on-push.yml)
- **Key scripts:** `update_all.sh` (production deployment), `install_all.sh` (first-time)

## Key File Locations

**Entry Points:**
- `apps/api/src/server.ts` — API starts here; imports `app.ts`
- `apps/admin/src/main.tsx` — Admin panel React root
- `apps/mobile/src/screens/HomeScreen.tsx` — Mobile main screen
- `apps/voice-agent/src/voice_agent/entrypoint.py` — Voice agent worker

**Configuration:**
- `apps/api/src/config/env.ts` — Zod schema for all env vars; single source of truth
- `.env` — Runtime secrets, database URL, API keys (single file used by all services)
- `apps/admin/vite.config.ts` — Vite config, dev port is 5174 (not 5173)
- `apps/voice-agent/src/voice_agent/config/settings.py` — Python config

**Core Logic:**
- `apps/api/src/services/order-state-machine.ts` — Order status transitions and role permissions
- `apps/api/src/services/finance.ts` — Payment finalization, payout calculation
- `apps/api/src/services/outbox.ts` — Transactional event queueing
- `apps/api/src/middleware/auth.ts` — JWT verification and realm validation

**Database:**
- `apps/api/src/db/client.ts` — PostgreSQL pool instance
- `apps/api/src/db/migrations/` — SQL migration files, numbered sequentially

**Testing:**
- `apps/api/tests/` — Vitest test files (run with `npm run test:api`)
- No centralized test patterns yet; tests co-located with features

## Naming Conventions

**Files:**
- API routes: `{domain}.ts` or `admin-{domain}.ts` (e.g., `orders.ts`, `admin-users.ts`)
- Services: `{entity}-{action}.ts` (e.g., `order-state-machine.ts`, `payout-scheduler.ts`)
- Middleware: `{concern}.ts` (e.g., `auth.ts`, `abuse-protection.ts`)
- Admin pages: `{Feature}Page.tsx` (e.g., `DashboardPage.tsx`, `UsersPage.tsx`)
- Mobile screens: `{Screen}Screen.tsx` (e.g., `HomeScreen.tsx`, `LoginScreen.tsx`)
- React components: PascalCase (e.g., `NotesPanel.tsx`, `KpiCard.tsx`)

**Directories:**
- API layers: `config/`, `db/`, `middleware/`, `routes/`, `services/`, `types/`, `utils/`
- Admin sections: `pages/`, `components/`, `lib/`, `hooks/`, `i18n/`, `types/`
- Mobile sections: `screens/`, `voice/`, `utils/`, `theme/`, `copy/`
- Feature-specific components: `components/{domain}/` (e.g., `components/dashboard/`, `components/buyer/`)

**Variables & Functions:**
- Use camelCase (e.g., `orderId`, `createOrder()`, `canTransition()`)
- Database columns: snake_case (e.g., `order_id`, `created_at`)
- TypeScript types: PascalCase (e.g., `OrderStatus`, `AuthRealm`, `AdminUser`)

## Where to Add New Code

**New API endpoint:**
- Primary code: `apps/api/src/routes/{domain}.ts` — add route handler
- Business logic: `apps/api/src/services/{entity}.ts` — extract business functions
- Database queries: Inline in route or in service; use `pool.connect()` for transactions
- Tests: `apps/api/tests/{domain}.test.ts`
- Middleware if needed: `apps/api/src/middleware/{concern}.ts`
- Update `apps/api/src/app.ts` to mount new route

**New admin page:**
- Implementation: `apps/admin/src/pages/{Feature}Page.tsx`
- API calls: Use `request()` from `apps/admin/src/lib/api.ts`
- Components: Share UI via `apps/admin/src/components/ui/` or domain-specific dirs
- Navigation: Add route to AppShell.tsx router definition
- Localization: Add strings to `apps/admin/src/i18n/en.json` and `tr.json`

**New mobile screen:**
- Implementation: `apps/mobile/src/screens/{Name}Screen.tsx`
- Voice integration: Coordinate with `apps/mobile/src/voice/VoiceSessionScreen.tsx`
- API calls: Use token from `apps/mobile/src/utils/auth.ts`
- Navigation: Implement with Expo Router or manual state

**New shared utility:**
- Implementation: `packages/shared-utils/src/index.ts` or new file
- Types: `packages/shared-types/src/index.ts`
- Usage: Import as `@coziyoo/shared-utils` from any workspace

**New database migration:**
- File: `apps/api/src/db/migrations/{NNNN}_description.sql` (use next sequential number)
- Run: `bash installation/scripts/db-migrate.sh` (auto-runs on deployment)
- Schema changes: Direct SQL, no ORM
- Example: `0013_add_cuisine_to_foods.sql`

**New service integration:**
- Implementation: `apps/api/src/services/{service-name}.ts`
- Config: Add env vars to `.env.example`, validate in `apps/api/src/config/env.ts`
- Usage: Call from route handlers only, not from other services
- Example: `ollama.ts`, `livekit.ts`, `n8n.ts`

## Special Directories

**`apps/api/dist/`**
- Purpose: Compiled TypeScript output
- Generated: By `npm run build:api` (tsc)
- Committed: No; git-ignored

**`apps/api/openapi/`**
- Purpose: OpenAPI schema artifacts
- Generated: Possibly by build or manual generation
- Committed: Unclear; review .gitignore

**`.planning/codebase/`**
- Purpose: Architecture, testing, conventions documentation
- Generated: By GSD codebase mapper
- Committed: Yes; consumed by plan and execute commands

**`.runtime/`**
- Purpose: Voice agent worker heartbeat file, temp runtime state
- Generated: At runtime
- Committed: No

---

*Structure analysis: 2026-03-21*
