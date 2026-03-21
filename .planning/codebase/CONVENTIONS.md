# Coding Conventions

**Analysis Date:** 2026-03-21

## Naming Patterns

**Files:**
- kebab-case: `order-state-machine.ts`, `login-security.ts`, `admin-audit.ts`
- Grouping by feature/domain: routes organized by feature (`auth.ts`, `orders.ts`, `compliance.ts`)
- Router files export with `Router` suffix: `authRouter`, `ordersRouter`, `adminComplianceRouter`

**Functions:**
- camelCase: `hashPassword()`, `verifyPassword()`, `generateRefreshToken()`
- Middleware functions start with verb: `requestContext()`, `requireAuth()`, `abuseProtection()`
- Service functions follow feature pattern: `getN8nStatus()`, `recordPresenceEvent()`, `recordFailure()`
- Helper functions descriptive: `isCorsOriginAllowed()`, `wildcardOriginMatches()`, `normalizeSql()`
- Type guards use `is` prefix: `isTerminalStatus()`

**Variables:**
- camelCase for standard variables: `passwordHash`, `displayNameNormalized`, `corsOrigins`
- Descriptive names for collections: `allowedCorsOrigins`, `wildcardCorsOrigins`, `suggestionRows`
- Boolean variables prefixed with `is`/`can`/`has`: `isLoginPath`, `canTransition`, `hasProperty`
- Abbreviations kept short: `req`, `res`, `sql`, `sle` (table alias in queries)

**Types:**
- PascalCase: `RegisterSchema`, `LoginSchema`, `OrderStatus`, `AuthRealm`, `AccessTokenPayload`
- Union types with readable names: `OrderStatus` with clear values like `"pending_seller_approval"`
- Type guards exported separately with descriptive names
- Zod schemas use PascalCase and `Schema` suffix: `RegisterSchema`, `LoginSchema`, `RefreshSchema`

**Database/Identifiers:**
- snake_case in SQL and database schemas: `display_name_normalized`, `user_type`, `seller_id`
- Underscores separate parts in enum/status values: `pending_seller_approval`, `finance_adjustment`
- Table aliases shortened: `sle` for `seller_ledger_entries`

## Code Style

**Formatting:**
- TypeScript 5.0+, strict mode enabled (`"strict": true` in tsconfig.json)
- ES2022 target, NodeNext module resolution
- Line length: observable patterns suggest ~100-120 character practical limit (no explicit config)
- No visible linting or prettier config at project root; individual workspaces don't enforce specific formatting

**Linting:**
- No project-wide eslint config detected
- TypeScript strict mode enforces type safety as primary linting mechanism
- Recommended: Apply consistent formatting rules across monorepo

**Imports:**
- Node.js built-ins imported with `node:` prefix: `import crypto from "node:crypto"`
- External packages next: `import express from "express"`
- Local imports with `.js` file extensions (ESM): `from "./routes/health.js"`
- Type imports separate: `import type { OrderStatus } from "..."`

**Import Order:**
1. Node.js built-ins (`node:*`)
2. External packages
3. Local type imports (`import type`)
4. Local imports

Example from `apps/api/src/routes/auth.ts`:
```typescript
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { pool } from "../db/client.js";
import { env } from "../config/env.js";
import { abuseProtection } from "../middleware/abuse-protection.js";
import { requireAuth } from "../middleware/auth.js";
```

**Path Aliases:**
- No path aliases configured; relative imports used throughout (`../db/client.js`)
- Service layer accessed via relative paths: `"../services/order-state-machine.js"`

## Error Handling

**Patterns:**
All API errors follow consistent shape:
```typescript
{ error: { code: "ERROR_CODE", message: "Human-readable message" } }
```

**Common Error Codes:**
- `VALIDATION_ERROR` — Input validation failed (400)
- `UNAUTHORIZED` — Missing/invalid auth token (401)
- `TOKEN_INVALID` — Token parsing/verification failed (401)
- `FORBIDDEN` / `AUTH_REALM_MISMATCH` — Insufficient permissions (403)
- `NOT_FOUND` — Resource not found (404)
- `EMAIL_TAKEN` / `DISPLAY_NAME_TAKEN` — Constraint violation (409)
- `ACCOUNT_LOCKED` — Security lockout (423)
- `TOO_MANY_ATTEMPTS` — Rate limit hit (429)
- `INTERNAL_ERROR` — Unhandled server error (500)

**Error Response Examples:**
```typescript
// Validation
return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });

// Auth failure
return res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Email or password invalid" } });

// Constraint violation
return res.status(409).json({ error: { code: "EMAIL_TAKEN", message: "Email already used" } });

// Rate limit with retry info
return res.status(429).json({ error: { code: "TOO_MANY_ATTEMPTS", message: "...", retryAfterSeconds: state.retryAfterSeconds } });
```

**Throwing patterns:**
- Validation errors caught from Zod `.safeParse()` and converted to error responses
- Database constraint errors caught and mapped to semantic error codes
- Middleware catches auth errors and returns 401/403 with appropriate codes
- Async errors in routes use try-catch with explicit error mapping

## Logging

**Framework:** console.log (structured JSON logging in middleware)

**Patterns:**
- Request lifecycle logged as JSON: `{ level: "info", type: "http_request", requestId, method, path, statusCode, durationMs }`
- Each request gets unique UUID (`requestId`) added in middleware `requestContext()`
- Response header includes `x-request-id` for tracing
- Schema validation errors logged with field details: `parsed.error.flatten().fieldErrors`

Example from `apps/api/src/middleware/observability.ts`:
```typescript
console.log(
  JSON.stringify({
    level: "info",
    type: "http_request",
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    statusCode: res.statusCode,
    durationMs,
  })
);
```

## Comments

**When to Comment:**
- Complex logic with non-obvious intent (e.g., CORS wildcard matching, charset normalization)
- Workarounds for external constraints or proxy issues
- Security-relevant decisions and validations

**Examples:**
```typescript
// Some upstream proxies/clients send quoted charset (e.g. charset="UTF-8"),
// which body-parser rejects. Normalize it before JSON parsing.

// Parse login payloads manually to bypass body-parser charset checks entirely.
// Some proxy chains send malformed Content-Type (e.g., charset="UTF-8 " with trailing space)
// which causes body-parser to throw 415 errors.
```

**JSDoc/TSDoc:**
- Sparse usage observed; only used where API intent is non-obvious
- Example from `apps/admin/src/components/ui/KpiCard.tsx`:
```typescript
/**
 * KpiCard — 4-area layout:
 *   ┌──────────┬──────────────────┐
 *   │ topLeft  │ topRight         │
 *   │ (icon)   │ (label)          │
 *   ├──────────┼──────────────────┤
 *   │ bottomLeft│ bottomRight      │
 *   │ (empty)  │ (value + extra)  │
 *   └──────────┴──────────────────┘
 */
```

## Function Design

**Size:**
- Route handlers: 20-50 lines (logic extracted to services)
- Service functions: 5-30 lines (focused responsibility)
- Utility functions: 2-15 lines (pure, testable)
- Middleware: 10-25 lines (single concern)

**Parameters:**
- Prefer object parameters for functions with 3+ arguments
- Middleware uses standard Express signature: `(req: Request, res: Response, next: NextFunction)`
- Service functions pass dependencies as parameters; no global state outside `env` and `db/client`

**Return Values:**
- Route handlers return void (handle response directly)
- Service functions return typed data: `Promise<Type>` or `Type`
- Error handling via try-catch or type guards (avoid throwing from services; let route handlers decide response)

## Module Design

**Exports:**
- Named exports preferred: `export function hashPassword()`, `export type OrderStatus`
- Single default export only for routers: `export const authRouter = Router()`
- Type exports with `type` keyword: `export type AuthRealm = "app" | "admin"`

**Barrel Files:**
- Used in component directories: `apps/admin/src/components/ui/index.ts` exports multiple components
- Service layer does not use barrel files; imports directly from service files

**Module Scope:**
- `env` config imported once and reused: `import { env } from "../config/env.js"`
- Database pool shared: `import { pool } from "../db/client.js"`
- Service functions stateless; database pool and env are only stateful dependencies

## Validation

**Zod Schemas:**
All user input validated with Zod before processing:
```typescript
const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  displayName: z.string().min(3).max(40),
  userType: z.enum(["buyer", "seller", "both"]),
  // ...
});

const parsed = RegisterSchema.safeParse(req.body);
if (!parsed.success) {
  return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
}
const input = parsed.data; // Fully typed after safeParse
```

**Custom Validators:**
- Normalization functions before validation: `normalizeDisplayName()`, `normalizeIdentifier()`
- Domain-specific validation in services: `canTransition()`, `canActorSetStatus()`

---

*Convention analysis: 2026-03-21*
