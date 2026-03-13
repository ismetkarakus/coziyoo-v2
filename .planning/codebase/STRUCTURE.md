# Codebase Structure

**Analysis Date:** 2026-03-12

## Directory Layout

```
coziyoo-v2/
├── apps/                          # Runnable services
│   ├── api/                       # Express/TypeScript REST API
│   ├── admin/                     # React/Vite admin panel
│   ├── mobile/                    # Expo/React Native mobile app
│   ├── voice-agent/               # Python LiveKit voice agent
│   └── livekit/                   # LiveKit room config (legacy/docs)
├── packages/                      # Shared libraries
│   ├── shared-types/              # TypeScript interfaces
│   └── shared-utils/              # Utility functions
├── installation/                  # VPS deployment scripts
├── .github/                       # GitHub Actions CI/CD
├── .planning/                     # GSD planning documents
├── .claude/                       # Claude tooling and commands
├── docker-compose.yml             # Local development stack
├── package.json                   # Workspace root (npm workspaces)
├── CLAUDE.md                      # Developer guidelines
└── README.md                      # Project overview
```

## Directory Purposes

**apps/api:**
- Purpose: Express REST API server handling all business logic (orders, payments, voice, admin)
- Contains: TypeScript route handlers, services, middleware, database client
- Key files: `src/server.ts`, `src/app.ts`, `src/db/client.ts`
- Workspace: Defined in package.json, can be targeted with `--workspace=apps/api`
- Build: TypeScript compiled to `dist/` via `tsc`
- Run: `npm run dev` (tsx watch) or `node dist/src/server.js`
- Tests: Vitest unit tests in `tests/unit/`

**apps/admin:**
- Purpose: React admin panel for system operators (dashboard, user management, audit, compliance)
- Contains: TSX components, pages, utility libraries, Vite config
- Build: Vite bundler produces `dist/` for static hosting
- Run: `npm run dev` (Vite server on port 5174) or build for production
- Port: 5174 (development) / 8000 (production via Nginx)

**apps/mobile:**
- Purpose: Expo-based React Native mobile app (buyer and seller features)
- Contains: Screen components, hooks, utilities, LiveKit voice integration
- Run: `npm start` (Expo), `npm run ios`, `npm run android`
- Note: NOT part of npm workspaces; managed separately by Expo

**apps/voice-agent:**
- Purpose: Python FastAPI/LiveKit Agents worker for AI voice sales assistant
- Contains: Agent entrypoint, join API, actions, configuration, providers
- Run: Two separate processes:
  - Worker: `python -m voice_agent.entrypoint`
  - Dispatch API: `uvicorn voice_agent.join_api:app --port 9000`
- Note: NOT part of npm workspaces; has its own Python venv

**packages/shared-types:**
- Purpose: TypeScript type definitions shared across API, admin, mobile
- Contains: Zod schemas, type exports in `src/index.ts`
- Build: `tsc` compiles to `dist/`
- Used by: Imported as `@coziyoo/shared-types` in consumer apps

**packages/shared-utils:**
- Purpose: Utility functions shared across services
- Contains: Helper functions, formatters, validators
- Build: `tsc` compiles to `dist/`
- Used by: Imported as `@coziyoo/shared-utils` in consumer apps

**installation/:**
- Purpose: Bash scripts for VPS deployment, database setup, service management
- Contains: install scripts (first-time setup), update scripts (rolling deploys), database migrations
- Key scripts:
  - `install_all.sh`: Sets up all services on fresh VPS
  - `update_all.sh`: Pulls code, runs migrations, rebuilds, restarts services
  - `db-migrate.sh`: Runs pending SQL migrations
  - `seed-data.sh`: Populates demo data
  - `generate_env.sh`: Creates root `.env` from template

**.github/workflows/:**
- Purpose: GitHub Actions CI/CD pipeline
- Contains: `deploy-on-push.yml` (triggers deploy on main branch push)
- Behavior: SSHes to DEPLOY_TARGETS, runs `update_all.sh`

**docker-compose.yml:**
- Purpose: Local development environment
- Contains: PostgreSQL, Nginx Proxy Manager, optional services
- Run: `docker-compose up`

## Key File Locations

**Entry Points:**

- `apps/api/src/server.ts`: Starts Express server, initializes payout scheduler
- `apps/api/src/app.ts`: Express app setup, middleware registration, route mounting
- `apps/admin/src/main.tsx`: Vite entry point, React app mount
- `apps/admin/src/App.tsx`: Root App component with routing
- `apps/mobile/src/screens/`: Screen entry points (HomeScreen.tsx, VoiceSessionScreen.tsx, etc.)
- `apps/voice-agent/src/voice_agent/entrypoint.py`: LiveKit agent worker registration
- `apps/voice-agent/src/voice_agent/join_api.py`: FastAPI dispatch endpoint

**Configuration:**

- `apps/api/src/config/env.ts`: Environment variable schema and typed access
- `apps/api/tsconfig.json`: TypeScript config for API (ES2022, strict, outDir: dist)
- `apps/admin/tsconfig.json`: TypeScript config for admin panel
- `apps/mobile/app.json`: Expo app config
- `apps/voice-agent/src/voice_agent/config/settings.py`: Voice agent settings schema
- `.env.example`: Template for root environment variables
- `installation/config.env`: VPS-specific settings (domains, OS passwords)

**Core Logic:**

**API Routes** (`apps/api/src/routes/`):
- Public: `health.ts`, `auth.ts`, `docs.ts`
- App-realm: `orders.ts`, `payments.ts`, `finance.ts`, `compliance.ts`, `delivery-proof.ts`, `lots.ts`, `order-allergen.ts`
- Admin-realm: `admin-auth.ts`, `admin-dashboard.ts`, `admin-users.ts`, `admin-audit.ts`, `admin-system.ts`, `admin-metadata.ts`, `admin-api-tokens.ts`, `admin-livekit.ts`, `admin-sales-commission-settings.ts`
- Voice: `livekit.ts` (mobile token generation), `voice.ts` (mobile agent dispatch)

**API Services** (`apps/api/src/services/`):
- Auth: `token-service.ts`
- Orders: `order-state-machine.ts`
- Voice: `livekit.ts`, `starter-agent-settings.ts`, `ollama.ts`, `tts-engines.ts`
- Finance: `finance.ts`, `payouts.ts`, `payout-scheduler.ts`
- Integrations: `n8n.ts`, `resolve-providers.ts`
- Operations: `admin-audit.ts`, `user-presence.ts`, `outbox.ts`, `lots.ts`

**API Middleware** (`apps/api/src/middleware/`):
- Core: `observability.ts`, `auth.ts`, `abuse-protection.ts`, `idempotency.ts`
- Authorization: `admin-rbac.ts`, `app-role.ts`

**API Database** (`apps/api/src/db/`):
- `client.ts`: PostgreSQL pool with SSL negotiation
- `migrations/`: Sequential numbered SQL files (0001_initial_schema.sql through 0005_complaint_admin_notes.sql)

**Admin Panel** (`apps/admin/src/`):
- Pages: `pages/*.tsx` (Dashboard, Users, Audit, Compliance, Voice settings, etc.)
- Components: `components/` (reusable UI elements)
- Libraries: `lib/` (API client, auth, utilities)
- Hooks: `hooks/` (custom React hooks)
- Internationalization: `i18n/` (translations)

**Mobile App** (`apps/mobile/src/`):
- Screens: `screens/` (HomeScreen.tsx, VoiceSessionScreen.tsx, SettingsScreen.tsx)
- Utilities: `utils/` (settings, API client)

**Testing:**

- `apps/api/tests/unit/`: Vitest unit tests
  - `security.test.ts`, `normalize.test.ts`, `order-state-machine.test.ts`, `payouts-service.test.ts`, `n8n-service.test.ts`, `lots-routes.test.ts`, `livekit-mobile-routes.test.ts`
- No integration tests (database integration via direct SQL, not mocked)
- No mobile/admin tests configured

## Naming Conventions

**Files:**

- Route files: Kebab-case with domain prefix (e.g., `admin-auth.ts`, `order-allergen.ts`)
- Service files: Kebab-case, service suffix optional (e.g., `token-service.ts`, `livekit.ts`)
- Middleware files: Kebab-case (e.g., `abuse-protection.ts`, `admin-rbac.ts`)
- SQL migrations: Numbered prefix + kebab-case (e.g., `0001_initial_schema.sql`)
- React components: PascalCase with component type suffix (e.g., `UsersPage.tsx`, `DashboardPage.tsx`)
- Utility files: Kebab-case (e.g., `normalize.ts`, `security.ts`)

**Directories:**

- Services/domain-specific: Singular nouns where logical (db, config, middleware) or plural for collections (routes, services, utils, pages, hooks)
- Feature directories in admin: `pages/users/`, `components/`
- Voice agent modules: Snake_case (Python convention): `voice_agent/actions/`, `voice_agent/providers/`, `voice_agent/session/`

**Functions:**

- Export const routers: Kebab-case with `Router` suffix (e.g., `export const authRouter = Router()`)
- Service functions: camelCase (e.g., `signAccessToken()`, `canTransition()`, `verifyPassword()`)
- Middleware factories: camelCase (e.g., `requireAuth()`, `abuseProtection()`)
- Utility functions: camelCase (e.g., `normalizeDisplayName()`, `hashPassword()`)

**Variables:**

- Zod schemas: PascalCase with `Schema` suffix (e.g., `RegisterSchema`, `LoginSchema`)
- Enums: UPPER_SNAKE_CASE or PascalCase (TypeScript convention, used for union types)
- Constants: UPPER_SNAKE_CASE (e.g., environment limits, magic numbers)

**Types:**

- Exported types: PascalCase (e.g., `AuthRealm`, `OrderStatus`, `AccessTokenPayload`)
- Database row types: Generic names or domain-specific (e.g., `User`, `Order`, `AdminAuditLog`)
- React props: PascalCase ending in `Props` (e.g., `ButtonProps`, `UsersPageProps`)

## Where to Add New Code

**New API Route Endpoint:**
- Primary code: Create/edit route file in `apps/api/src/routes/[domain].ts`
- Handler placement: Define `export const [domain]Router = Router()`, add endpoint methods
- Validation: Use Zod schema at top of file
- Pattern: Match existing endpoint structure (validate → query → respond)
- Middleware: Apply `requireAuth("app"|"admin")` via `router.use()` or per-endpoint
- Tests: Add to `apps/api/tests/unit/[domain]-routes.test.ts` if tests exist

**New Service/Business Logic:**
- Implementation: Create `apps/api/src/services/[feature].ts`
- Pattern: Export individual functions or class if stateful (rare)
- Imports: Use `pool` from `db/client.ts` for database access, env from `config/env.ts`
- Database queries: Write SQL directly, use Zod for response types
- Integration: Import and call from routes or other services

**New Middleware:**
- Implementation: Create `apps/api/src/middleware/[concern].ts`
- Pattern: Export function that matches Express middleware signature: `(req, res, next) => void`
- Integration: Import and call `app.use()` in `app.ts` (or as middleware factory via `router.use()`)

**Database Schema Changes:**
- Create migration: `apps/api/src/db/migrations/NNNN_description.sql` (increment number)
- Pattern: Use next sequential number from highest existing (e.g., 0006 if 0005 exists)
- Deployment: Migration runs automatically via `db-migrate.sh` before service restart
- Reversibility: Include rollback SQL in same file if possible (but not enforced)

**New Admin Page:**
- Component: Create `apps/admin/src/pages/[Feature]Page.tsx`
- Routing: Add route in `apps/admin/src/AppShell.tsx` or routing config
- API calls: Use fetch or client from `lib/api.ts`
- Styling: Add CSS to shared `styles.css`
- Pattern: Follow existing page structure (layout, data fetching, error handling)

**New Mobile Screen:**
- Component: Create `apps/mobile/src/screens/[Feature]Screen.tsx`
- Navigation: Register in navigation stack (check existing HomeScreen, VoiceSessionScreen)
- LiveKit integration: Use `@livekit/react-native` for audio/video
- Pattern: Use React Native components, follow existing screen patterns

**Shared Type or Utility:**
- Types: Add to `packages/shared-types/src/index.ts`, export
- Utils: Create file in `packages/shared-utils/src/`, export function
- Build: Run `npm run build --workspace=packages/shared-types` (or shared-utils)
- Usage: Import as `@coziyoo/shared-types` or `@coziyoo/shared-utils` in consumer

**Voice Agent Feature:**
- Action handler: Create in `apps/voice-agent/src/voice_agent/actions/[feature].py`
- Tool integration: Register tool in entrypoint agent initialization
- Provider: Create in `apps/voice-agent/src/voice_agent/providers/[service].py`
- Pattern: Follow LiveKit Agents patterns (async functions, proper logging)

## Special Directories

**apps/api/dist/:**
- Purpose: Compiled JavaScript output
- Generated: Yes (created by `tsc` during build)
- Committed: No (in .gitignore)
- Rebuild: `npm run build --workspace=apps/api`

**apps/admin/dist/:**
- Purpose: Bundled static files for production
- Generated: Yes (created by Vite during build)
- Committed: No (in .gitignore)
- Rebuild: `npm run build --workspace=apps/admin`

**apps/api/node_modules/, apps/admin/node_modules/:**
- Purpose: Workspace-local dependencies
- Generated: Yes (via npm install)
- Committed: No (in .gitignore)
- Note: Root node_modules/ shared by all workspaces

**apps/api/tests/:​**
- Purpose: Vitest unit tests
- Generated: No (checked in)
- Committed: Yes
- Run: `npm run test --workspace=apps/api`

**installation/scripts/:​**
- Purpose: Operational bash scripts (deploy, database, service management)
- Generated: No (checked in)
- Committed: Yes
- Requires: Bash, database tools, npm/node, systemctl

**.planning/codebase/:​**
- Purpose: GSD analysis documents (architecture, structure, conventions, testing, etc.)
- Generated: Yes (created by map-codebase command)
- Committed: Yes (referenced by other GSD commands)

**.env and .env.local:**
- Purpose: Environment configuration
- Generated: No (user creates from .env.example)
- Committed: No (in .gitignore, contains secrets)
- Priority: .env.local overrides .env, both sourced by dotenv in env.ts

**docker-compose.yml services:**
- PostgreSQL: Persistent volume at `/var/lib/postgresql/data/`
- Nginx Proxy Manager: Proxies API and admin panel locally
- LiveKit (optional): Self-hosted LiveKit server (not always running locally)

---

*Structure analysis: 2026-03-12*
