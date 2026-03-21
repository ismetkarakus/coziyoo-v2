# Testing Patterns

**Analysis Date:** 2026-03-21

## Test Framework

**Runner:**
- Vitest 4.0.18 (configured in `apps/api/package.json`)
- Config: No explicit vitest config file; uses default Vitest settings with TypeScript support

**Assertion Library:**
- Vitest built-in expect API (`import { expect } from "vitest"`)

**Run Commands:**
```bash
npm run test                    # Run all tests across workspaces
npm run test:api               # Run API tests only (vitest run)
npm run test:watch             # Watch mode (vitest without --run flag)
npm run test --workspace=apps/api -- --run src/path/to/file.test.ts  # Single test file
```

Test execution: `npm test` runs `vitest run` (single run, no watch by default).

## Test File Organization

**Location:**
- Tests co-located in `apps/api/tests/unit/` directory
- Pattern: separate `tests/` directory rather than co-located with source

**Naming:**
- Convention: `[feature-name].test.ts`
- Examples: `order-state-machine.test.ts`, `security.test.ts`, `n8n-service.test.ts`, `payouts-service.test.ts`

**Structure:**
```
apps/api/
├── tests/
│   └── unit/
│       ├── order-state-machine.test.ts
│       ├── security.test.ts
│       ├── n8n-service.test.ts
│       └── ... (9 test files)
└── src/
    ├── services/
    ├── routes/
    ├── middleware/
    └── ...
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, expect, it, vi } from "vitest";

describe("feature-name", () => {
  it("does thing A", () => {
    // Arrange
    // Act
    // Assert
  });

  it("does thing B", () => {
    // ...
  });
});
```

**Patterns:**
- Top-level `describe()` per file, named after feature
- Multiple `it()` test cases per describe block
- Descriptive test names: `"allows valid transitions"`, `"blocks invalid transitions"`, `"enforces actor permissions"`
- Flat test structure; no nested describe blocks observed

**Typical Test Flow:**
```typescript
// Example: order-state-machine.test.ts
describe("order-state-machine", () => {
  it("allows valid transitions", () => {
    expect(canTransition("pending_seller_approval", "seller_approved")).toBe(true);
    expect(canTransition("awaiting_payment", "paid")).toBe(true);
  });

  it("blocks invalid transitions", () => {
    expect(canTransition("pending_seller_approval", "completed")).toBe(false);
    expect(canTransition("paid", "seller_approved")).toBe(false);
  });
});
```

## Mocking

**Framework:** Vitest built-in mocking via `vi` object

**Patterns:**

1. **Module Mocking:**
```typescript
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/db/client.js", () => ({
  pool: {
    connect: mockConnect,
    query: mockPoolQuery,
  },
}));
```

2. **Environment Variable Stubbing:**
```typescript
function stubCoreEnv() {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("HOST", "127.0.0.1");
  vi.stubEnv("PORT", "3000");
  vi.stubEnv("APP_JWT_SECRET", "test_app_jwt_secret_1234567890_abcdef");
  // ... more env vars
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
```

3. **Fetch Mocking:**
```typescript
const fetchMock = vi
  .fn<typeof fetch>()
  .mockImplementation(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/healthz")) {
      return new Response("ok", { status: 200 });
    }
    if (url.includes("/api/v1/workflows/6KFFgjd26nF0kNCA")) {
      return new Response("{}", { status: 200 });
    }
    return new Response("not-found", { status: 404 });
  });
vi.stubGlobal("fetch", fetchMock);
```

4. **Function Mocks:**
```typescript
const mockConnect = vi.fn();
const mockPoolQuery = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});
```

5. **Module Reload in Tests:**
```typescript
async function loadService() {
  vi.resetModules(); // Clear module cache
  return import("../../src/services/n8n.js");
}

// Usage
const { getN8nStatus } = await loadService();
```

6. **Fake Timers:**
```typescript
it("creates daily payout batch once and keeps next run idempotent", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-08T10:00:00.000Z"));
  // ... test logic
});
```

**What to Mock:**
- External service calls (fetch, HTTP requests)
- Database operations (via module mocking `../../src/db/client.js`)
- Environment variables (via `vi.stubEnv()`)
- Global objects (fetch, timers via `vi.stubGlobal()`)
- Time-dependent logic (via `vi.useFakeTimers()`)

**What NOT to Mock:**
- Utility functions being tested (hashPassword, generateRefreshToken)
- State machine logic (canTransition, canActorSetStatus)
- Direct function calls within the same module
- Pure functions (encryption, normalization)

## Fixtures and Factories

**Test Data:**
No formal fixture or factory pattern observed. Test data created inline:

```typescript
// From payouts-service.test.ts
const ledger: LedgerEntry[] = [
  { id: "l1", sellerId: "seller-1", amount: 100, sourceType: "order_finance" },
  { id: "l2", sellerId: "seller-1", amount: -20, sourceType: "finance_adjustment" },
];

const batches: Batch[] = [];
const items: BatchItem[] = [];

// Inline type definitions
type LedgerEntry = { id: string; sellerId: string; amount: number; sourceType: string };
type Batch = {
  id: string;
  sellerId: string;
  payoutDate: string;
  batchKey: string;
  totalAmount: number;
  status: "pending" | "processing" | "paid" | "failed";
};
```

**Location:**
- Test data defined in test file itself
- No shared fixtures directory
- Recommend: Create `tests/fixtures/` if factories needed across multiple tests

## Coverage

**Requirements:** No coverage enforcement detected (no nyc/c8 config)

**View Coverage:**
```bash
# Coverage reporting not configured; would need to add coverage plugin:
npm run test -- --coverage
```

**Current Gap:**
- Coverage configuration not present in codebase
- Recommend: Add vitest coverage for CI pipeline

## Test Types

**Unit Tests:**
- **Scope:** Pure functions, state machines, utility functions
- **Approach:** Arrange-Act-Assert (AAA) pattern
- **Examples:**
  - `order-state-machine.test.ts` — Tests `canTransition()`, `canActorSetStatus()`, `isTerminalStatus()` functions
  - `security.test.ts` — Tests password hashing, token generation, token hashing
  - `normalize.test.ts` — Tests display name and content normalization

**Integration Tests:**
- **Scope:** Service layer with mocked database
- **Approach:** Mock database calls, test service logic, verify query patterns
- **Examples:**
  - `payouts-service.test.ts` — Tests payout batch creation with mocked database pool
  - `n8n-service.test.ts` — Tests N8N workflow status checks with mocked fetch
  - `livekit-stt-tts-preflight.test.ts` — Tests LiveKit preflight with service calls

**E2E Tests:**
- Framework: Not found
- Status: Not implemented

## Common Patterns

**Async Testing:**
```typescript
// From security.test.ts
it("hashes and verifies passwords", async () => {
  const hash = await hashPassword("User12345!");
  expect(hash).toBeTypeOf("string");
  await expect(verifyPassword(hash, "User12345!")).resolves.toBe(true);
  await expect(verifyPassword(hash, "wrong-pass")).resolves.toBe(false);
});
```

**Boolean/Type Checking:**
```typescript
expect(a).not.toBe(b);
expect(a.length).toBeGreaterThan(20);
expect(status.configured).toBe(true);
expect(status.reachable).toBe(true);
expect(hash).toBeTypeOf("string");
```

**Collection Assertions:**
```typescript
// From order-state-machine.test.ts
const terminal: OrderStatus[] = ["completed", "rejected", "cancelled"];
for (const status of terminal) expect(isTerminalStatus(status)).toBe(true);
```

**Mock Call Verification:**
```typescript
expect(fetchMock).toHaveBeenCalledTimes(3);
expect(status.workflows["6KFFgjd26nF0kNCA"]).toEqual({ reachable: true, status: 200 });
expect(status.workflows["XYiIkxpa4PlnddQt"]).toEqual({ reachable: false, status: 404 });
```

**Deterministic Test Helpers:**
```typescript
// From payouts-service.test.ts
function normalizeSql(sql: unknown): string {
  return String(sql).replace(/\s+/g, " ").trim().toLowerCase();
}

// Use in mock implementation
const q = normalizeSql(sql);
if (q.includes("insert into seller_payout_batches")) {
  // handle insert
}
```

**Setup and Teardown:**
```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("feature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // tests...
});
```

## Database Mocking Patterns

Tests mock database pool completely:

```typescript
const mockPoolQuery = vi.fn(async (sql: unknown, params: unknown[] = []) => {
  const q = normalizeSql(sql);

  // Return based on query type
  if (q === "begin" || q === "commit" || q === "rollback") {
    return { rowCount: 0, rows: [] };
  }
  if (q.includes("pg_try_advisory_xact_lock")) {
    return { rowCount: 1, rows: [{ acquired: true }] };
  }
  if (q.includes("select to_regclass")) {
    return { rowCount: 1, rows: [{ exists: true }] };
  }
  // ... more query handlers

  return { rowCount: 0, rows: [] };
});

vi.mock("../../src/db/client.js", () => ({
  pool: {
    query: mockPoolQuery,
  },
}));
```

**Pattern:** Query-based dispatch in mock implementation to simulate database behavior without real DB dependency.

## File Test Coverage

**Current Test Files:**
- `apps/api/tests/unit/livekit-mobile-routes.test.ts`
- `apps/api/tests/unit/security.test.ts`
- `apps/api/tests/unit/orders-voice.test.ts`
- `apps/api/tests/unit/normalize.test.ts`
- `apps/api/tests/unit/n8n-service.test.ts`
- `apps/api/tests/unit/livekit-stt-tts-preflight.test.ts`
- `apps/api/tests/unit/lots-routes.test.ts`
- `apps/api/tests/unit/payouts-service.test.ts`
- `apps/api/tests/unit/order-state-machine.test.ts`

**Key Coverage Areas:**
- Authentication & security (JWT, password hashing)
- Order state machine transitions
- Payout service batch creation
- LiveKit integration preflight
- N8N service health checks
- Voice order routes
- Normalization utilities

**Gaps:**
- Admin panel (`apps/admin`) has no tests
- Mobile app (`apps/mobile`) has Expo typecheck but no unit tests
- Route-level integration tests limited
- No E2E test suite

---

*Testing analysis: 2026-03-21*
