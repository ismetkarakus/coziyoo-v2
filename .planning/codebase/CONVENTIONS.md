# Coding Conventions

**Analysis Date:** 2026-03-12

## Naming Patterns

**Files:**
- Kebab-case for file names: `token-service.ts`, `order-state-machine.ts`, `admin-users.ts`
- Directory names lowercase: `routes/`, `services/`, `middleware/`, `utils/`
- Router files named by domain: `admin-auth.ts`, `compliance.ts`, `livekit.ts`

**Functions:**
- camelCase: `signAccessToken()`, `verifyPassword()`, `normalizeDisplayName()`, `hashPassword()`
- Middleware and services use descriptive verbs: `requireAuth()`, `abuseProtection()`, `recordPresenceEvent()`
- Database query functions: `pingDatabase()`, `pool.query()`

**Variables:**
- camelCase: `input`, `userId`, `displayNameNormalized`, `passwordHash`
- SQL-based: snake_case in database column references
- Constants: UPPER_SNAKE_CASE: `INVALID_JSON`, `UNAUTHORIZED`, `VALIDATION_ERROR`

**Types:**
- PascalCase: `AccessTokenPayload`, `AuthRealm`, `OrderStatus`
- Suffixes describe purpose: `*Router` (Express routers), `*Schema` (Zod validation schemas)
- Discriminated unions: `OrderStatus` uses literal string types (`"pending_seller_approval"`, `"completed"`, etc.)

**Router Exports:**
- Named exports follow pattern: `{featureRouter}` or `{adminFeatureRouter}` or `{sellerFeatureRouter}`
- Examples: `authRouter`, `adminAuthRouter`, `ordersRouter`, `sellerLotsRouter`, `adminLotsRouter`, `adminUserManagementRouter`

## Code Style

**Formatting:**
- TypeScript 5.0+ with strict mode enabled (tsconfig.json: `"strict": true`)
- No linter or formatter config detected — code follows implicit style patterns
- Line length varies (mix of concise and verbose styles observed)

**Linting:**
- No ESLint or Prettier config found
- Code relying on TypeScript's strict compiler to catch errors

**Import Organization:**
- Node.js built-in modules first: `import crypto from "node:crypto"`
- Third-party libraries second: `import { Router } from "express"`, `import { z } from "zod"`
- Local imports with relative paths last: `import { pool } from "../db/client.js"`
- All paths include `.js` extension for ES modules (required by TypeScript NodeNext)

**Example (from `routes/auth.ts`):**
```typescript
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/client.js";
import { abuseProtection } from "../middleware/abuse-protection.js";
import { requireAuth } from "../middleware/auth.js";
import { recordPresenceEvent } from "../services/user-presence.js";
```

**Path Aliases:**
- None detected — all imports use relative paths with `.js` extensions

## Error Handling

**Error Response Format:**
All errors use uniform JSON structure:
```typescript
{ error: { code: "ERROR_CODE", message: "Human-readable message" } }
```

**HTTP Status Codes:**
- `400` — Validation errors: `code: "VALIDATION_ERROR"` with Zod error details
- `401` — Unauthenticated: `code: "UNAUTHORIZED"` or `code: "TOKEN_INVALID"`
- `403` — Forbidden/permissions: `code: "ROLE_NOT_ALLOWED"`, `code: "AUTH_REALM_MISMATCH"`
- `429` — Rate limit: `code: "ABUSE_RATE_LIMIT"`
- `503` — Service degraded: Health endpoint returns degraded status with error message

**Try-Catch Pattern:**
Routes use try-catch for database operations:
```typescript
const client = await pool.connect();
try {
  await client.query("BEGIN");
  // ... operations
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  // ... error response
} finally {
  client.release();
}
```

**Validation:**
Uses Zod schemas for request body/query validation:
```typescript
const parsed = CreateOrderSchema.safeParse(req.body);
if (!parsed.success) {
  return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
}
```

## Logging

**Framework:** console (no logger library)

**Patterns:**
- `console.log()` — Informational: server startup, telemetry logs
- `console.error()` — Errors: validation failures, database errors, service failures
- Conditional logging by level:
  ```typescript
  const sink = input.level === "error" ? console.error : input.level === "warn" ? console.warn : console.log;
  ```

**When to Log:**
- Startup messages and configuration
- Database connection errors (idle client errors)
- Environment validation failures
- Service operation failures (e.g., payout scheduler)

**Examples:**
- `console.log("API listening on http://localhost:3000")` — Server startup
- `console.error("Invalid environment variables", parsed.error.flatten().fieldErrors)` — Config validation
- `console.error("Postgres pool idle client error:", err.message)` — Connection issues

## Comments

**When to Comment:**
- Complex business logic explanations (e.g., CORS wildcard matching, charset normalization)
- Workarounds and non-obvious decisions
- Section headers for organizational clarity

**Style:**
- Single-line comments: `// Comment here`
- Multi-line comments for detailed explanations:
  ```typescript
  // Some upstream proxies/clients send quoted charset (e.g. charset="UTF-8"),
  // which body-parser rejects. Normalize it before JSON parsing.
  ```

**Sections:**
Headers using dashes for visual separation:
```typescript
// ── Voice Agent Settings ─────────────────────────────────────────────────────
// ── Connection Tests ──────────────────────────────────────────────────────────
```

**JSDoc/TSDoc:**
Not used. Type annotations are explicit in code; no auto-doc generation.

## Function Design

**Size:** No strict limits observed; ranges from single-line utilities to 1000+ line files

**Async/Await Pattern:**
```typescript
async function handler(req: Request, res: Response) {
  try {
    const result = await someAsyncOperation();
    return res.json({ data: result });
  } catch (error) {
    return res.status(500).json({ error: { code: "INTERNAL_ERROR" } });
  }
}
```

**Parameters:**
- Explicit type annotations: `(payload: AccessTokenPayload, options: SignAccessTokenOptions = {})`
- Options objects for optional parameters
- Middleware functions follow Express signature: `(req: Request, res: Response, next: NextFunction)`

**Return Values:**
- Express handlers return explicitly: `return res.json(data)` or `return res.status(code).json(error)`
- Service functions return typed values directly: `Promise<AccessTokenPayload>`, `boolean`, etc.
- Early returns for error conditions (guard clauses):
  ```typescript
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR" } });
  }
  ```

## Module Design

**Exports:**
- Named exports (not default): `export const authRouter = Router()`
- Each module exports one primary item (the router, the service function, the utility)
- Multiple related exports grouped: `export { sellerComplianceRouter, adminComplianceRouter }`

**Barrel Files:**
No barrel files detected. `routes/` directory has individual route modules without `index.ts`.

**Service Modules:**
Services in `services/` are pure functions or stateless utilities:
- `token-service.ts` — JWT signing/verification
- `security.ts` — Password hashing, token generation
- `order-state-machine.ts` — State transition rules
- `finance.ts` — Financial calculations

**Route Modules:**
Mounted in `app.ts` after import:
```typescript
import { authRouter } from "./routes/auth.js";
app.use("/v1/auth", authRouter);
```

## Middleware Pattern

**Signature:**
```typescript
export function middlewareName(config?: ConfigType) {
  return (req: Request, res: Response, next: NextFunction) => {
    // middleware logic
    next();
  };
}
```

**Examples:**
- `requireAuth(realm: AuthRealm)` — Returns middleware factory
- `abuseProtection(config: AbuseConfig)` — Returns configured middleware
- `requireIdempotency(scope: string)` — Idempotency middleware

**Middleware Chain (in `app.ts`):**
```
CORS → Content-Type Normalization → Manual Login Parsing → JSON Parsing →
Request Context → (Other Global Middleware) → Route Handlers
```

---

*Convention analysis: 2026-03-12*
