# Testing Patterns

**Analysis Date:** 2026-03-12

## Test Framework

**Runner:**
- Vitest 4.0.18
- Config: No `vitest.config.ts` file found — using defaults
- Run commands in `apps/api/package.json`:

```bash
npm run test              # Run all tests (vitest run)
npm run test:watch       # Watch mode (vitest)
npm test --workspace=apps/api  # Run API tests only
```

**Assertion Library:**
- Vitest's built-in assertions: `expect()`

**Test Infrastructure:**
- Environment variables stubbed with `vi.stubEnv()`
- Module mocking via `vi.mock()`
- Fake timers with `vi.useFakeTimers()` and `vi.setSystemTime()`
- Cleanup with `vi.clearAllMocks()`, `vi.unstubAllEnvs()`

## Test File Organization

**Location:**
- Centralized in `apps/api/tests/unit/` directory (separate from source code)
- Not co-located with source files

**Naming:**
- Pattern: `{feature}.test.ts` or `{service}.test.ts`
- Examples: `security.test.ts`, `normalize.test.ts`, `order-state-machine.test.ts`, `payouts-service.test.ts`

**Directory Structure:**
```
apps/api/
├── src/
│   ├── routes/
│   ├── services/
│   ├── middleware/
│   └── utils/
├── tests/
│   └── unit/
│       ├── security.test.ts
│       ├── normalize.test.ts
│       ├── order-state-machine.test.ts
│       ├── payouts-service.test.ts
│       ├── livekit-mobile-routes.test.ts
│       ├── n8n-service.test.ts
│       └── lots-routes.test.ts
└── package.json
```

## Test Structure

**Suite Organization (Vitest describe/it):**
```typescript
import { describe, expect, it } from "vitest";
import { functionToTest } from "../../src/path/to/module.js";

describe("module name or feature", () => {
  it("describes what should happen", () => {
    // Arrange
    const input = ...;

    // Act
    const result = functionToTest(input);

    // Assert
    expect(result).toBe(expectedValue);
  });

  it("handles error case", () => {
    expect(() => functionToTest(invalid)).toThrow();
  });
});
```

**Patterns:**
- One `describe()` block per test file (wrapping all tests)
- Multiple `it()` blocks for different scenarios
- Clear test names: "does X when Y", "handles Z error"
- Synchronous tests for pure functions, async tests for async operations

## Async Testing

**Pattern:**
```typescript
it("hashes and verifies passwords", async () => {
  const hash = await hashPassword("User12345!");
  expect(hash).toBeTypeOf("string");
  await expect(verifyPassword(hash, "User12345!")).resolves.toBe(true);
  await expect(verifyPassword(hash, "wrong-pass")).resolves.toBe(false);
});
```

**Approach:**
- Use `async/await` syntax (not `.then()` chains)
- Use `expect(...).resolves.toBe()` for promises
- Use `expect(...).rejects.toThrow()` for promise rejections

## Error Testing

**Pattern:**
```typescript
it("blocks invalid transitions", () => {
  expect(canTransition("pending_seller_approval", "completed")).toBe(false);
  expect(canTransition("paid", "seller_approved")).toBe(false);
});
```

**Validation Testing:**
```typescript
it("rejects invalid start session metadata payload", async () => {
  const response = await fetch(`${baseUrl}/endpoint`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ /* invalid data */ }),
  });

  expect(response.status).toBe(400);
  const json = await response.json();
  expect(json.error?.code).toBe("VALIDATION_ERROR");
});
```

## Mocking

**Framework:** Vitest's `vi` utilities

**Module Mocking Pattern:**
```typescript
import { beforeEach, vi } from "vitest";

const mockConnect = vi.fn();
const mockPoolQuery = vi.fn();

vi.mock("../../src/db/client.js", () => ({
  pool: {
    connect: mockConnect,
    query: mockPoolQuery,
  },
}));

describe("service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls database", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "123" }] });
    // test code
    expect(mockPoolQuery).toHaveBeenCalledWith(/* SQL */, /* params */);
  });
});
```

**Environment Stubbing (for integration tests):**
```typescript
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("APP_JWT_SECRET", "test_app_jwt_secret_1234567890_abcdef");
  vi.stubEnv("PGHOST", "127.0.0.1");
  // ... more stubs
});

afterEach(() => {
  vi.unstubAllEnvs();
});
```

**Module Reset (for clean imports):**
```typescript
beforeEach(() => {
  vi.resetModules();
});
```

**Fake Timers:**
```typescript
it("creates idempotent daily batch", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-08T10:00:00.000Z"));

  // test code using current time

  vi.useRealTimers(); // or implicit in cleanup
});
```

**What to Mock:**
- Database connections (`pool.connect`, `pool.query`) — use `vi.mock()` at module level
- External HTTP services — mock in integration tests
- Environment variables — use `vi.stubEnv()`
- Time-dependent logic — use `vi.useFakeTimers()`

**What NOT to Mock:**
- Pure utility functions (`normalizeDisplayName`, `hashPassword`) — test directly
- Business logic state machines (`canTransition`, `isTerminalStatus`) — test behavior
- Type validation (Zod schemas) — test validation rules

## Fixtures and Factories

**Test Data:**
```typescript
type LedgerEntry = { id: string; sellerId: string; amount: number; sourceType: string };
type Batch = {
  id: string;
  sellerId: string;
  payoutDate: string;
  batchKey: string;
  totalAmount: number;
  status: "pending" | "processing" | "paid" | "failed";
};

// In test:
const ledger: LedgerEntry[] = [
  { id: "l1", sellerId: "seller-1", amount: 100, sourceType: "order_finance" },
  { id: "l2", sellerId: "seller-1", amount: -20, sourceType: "finance_adjustment" },
];
```

**Location:**
- Inline within test files (no separate fixtures directory)
- Type definitions at top of test file

**Database Query Mocking (from `payouts-service.test.ts`):**
```typescript
const clientQuery = vi.fn(async (sql: unknown, params: unknown[] = []) => {
  const q = normalizeSql(sql);  // normalize whitespace for comparison

  if (q === "begin" || q === "commit") {
    return { rowCount: 0, rows: [] };
  }
  if (q.includes("insert into seller_payout_batches")) {
    // simulate insert behavior
    batches.push({ id: "b_1", sellerId: params[0], ...otherFields });
    return { rowCount: 1, rows: [...] };
  }
  // ... more SQL patterns
});
```

**SQL Normalization Helper:**
```typescript
function normalizeSql(sql: unknown): string {
  return String(sql).replace(/\s+/g, " ").trim().toLowerCase();
}
```

## Coverage

**Requirements:** No coverage enforcement detected

**View Coverage:**
```bash
# Create coverage report (if vitest configured with coverage)
npm run test -- --coverage
```

**Current State:**
- Tests exist for critical paths: utils, state machines, services
- Not all files have test coverage (e.g., routes with complex business logic have partial coverage)
- 7 test files in `tests/unit/`; routes directory has complex logic but limited test files

## Test Types

**Unit Tests:**
- Scope: Pure functions, utilities, state machines
- Approach: Direct function calls with mocked dependencies
- Examples: `security.test.ts` (password hashing), `order-state-machine.test.ts` (state transitions)
- Location: `tests/unit/`

**Integration Tests:**
- Scope: API route handlers with environment and real app boot
- Approach: HTTP requests to running server, stubbed environment variables
- Example: `livekit-mobile-routes.test.ts` boots Express app with stubs
```typescript
async function bootApp() {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "test");
  // ... more stubs
  const { app } = await import("../../src/app.js");
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return { server, baseUrl: `http://127.0.0.1:${address.port}`, token };
}
```

**Setup/Teardown in Integration Tests:**
```typescript
afterEach(() => {
  vi.unstubAllEnvs();
});

// In test:
try {
  const response = await fetch(`${baseUrl}/endpoint`, { ...options });
  expect(response.status).toBe(200);
} finally {
  await shutdown(app.server);  // Cleanup
}
```

**E2E Tests:**
- Not implemented in codebase
- Integration tests with real app boot serve as nearest equivalent

## Common Testing Scenarios

**Utility Function (Pure):**
```typescript
// tests/unit/normalize.test.ts
describe("normalizeDisplayName", () => {
  it("trims and lowercases", () => {
    expect(normalizeDisplayName("  IsMetKaRaKus  ")).toBe("ismetkarakus");
  });

  it("keeps internal spaces", () => {
    expect(normalizeDisplayName("John Doe")).toBe("john doe");
  });
});
```

**Async Service (Password Hashing):**
```typescript
// tests/unit/security.test.ts
it("hashes and verifies passwords", async () => {
  const hash = await hashPassword("User12345!");
  expect(hash).toBeTypeOf("string");
  await expect(verifyPassword(hash, "User12345!")).resolves.toBe(true);
  await expect(verifyPassword(hash, "wrong-pass")).resolves.toBe(false);
});
```

**State Machine (Transitions):**
```typescript
// tests/unit/order-state-machine.test.ts
it("allows valid transitions", () => {
  expect(canTransition("pending_seller_approval", "seller_approved")).toBe(true);
  expect(canTransition("awaiting_payment", "paid")).toBe(true);
});

it("blocks invalid transitions", () => {
  expect(canTransition("pending_seller_approval", "completed")).toBe(false);
});
```

**Service with Database Mocking:**
```typescript
// tests/unit/payouts-service.test.ts
beforeEach(() => {
  vi.clearAllMocks();
});

it("creates daily payout batch once and keeps next run idempotent", async () => {
  mockPoolQuery.mockResolvedValueOnce({ rowCount: 1, rows: [...] });
  // invoke service
  expect(mockPoolQuery).toHaveBeenCalledWith(/* SQL */, /* params */);
});
```

**Route Handler Integration:**
```typescript
// tests/unit/livekit-mobile-routes.test.ts
it("accepts mobile telemetry payload with app auth", async () => {
  const app = await bootApp();
  try {
    const response = await fetch(`${app.baseUrl}/v1/livekit/mobile/telemetry`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${app.token}`,
      },
      body: JSON.stringify({ level: "info", eventType: "session_started", ... }),
    });
    expect(response.status).toBe(201);
  } finally {
    await shutdown(app.server);
  }
});
```

## Testing Best Practices in Codebase

1. **Descriptive Test Names:** Names clearly state expected behavior
   - ✓ "hashes and verifies passwords"
   - ✓ "allows valid transitions"
   - ✗ "test auth" or "works"

2. **Arrange-Act-Assert Pattern:** Tests follow clear structure (implicit in most cases)

3. **Test One Thing:** Each `it()` tests a single behavior

4. **Use Mocks Sparingly:** Direct function testing preferred; mocks only for external dependencies

5. **Environment Isolation:** Integration tests stub env vars and clean up after each test

6. **Clear Error Expectations:** Validation tests check both status code and error code
   ```typescript
   expect(response.status).toBe(400);
   expect(json.error?.code).toBe("VALIDATION_ERROR");
   ```

---

*Testing analysis: 2026-03-12*
