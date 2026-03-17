import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

// --- DB mock setup ---

const mockConnect = vi.fn();
const mockPoolQuery = vi.fn();
const mockEnqueueOutboxEvent = vi.fn();

vi.mock("../../src/db/client.js", () => ({
  pool: {
    connect: mockConnect,
    query: mockPoolQuery,
  },
}));

vi.mock("../../src/services/outbox.js", () => ({
  enqueueOutboxEvent: mockEnqueueOutboxEvent,
}));

// --- Helpers ---

const AI_SECRET = "test_ai_server_shared_secret_1234";

const VALID_BODY = {
  userId: "11111111-1111-1111-8111-111111111111",
  sellerId: "22222222-2222-2222-8222-222222222222",
  deliveryType: "pickup" as const,
  items: [{ lotId: "33333333-3333-3333-8333-333333333333", quantity: 2 }],
};

const IDEMPOTENCY_KEY = "voice-order-test-key-001";

function normalizeSql(sql: unknown): string {
  return String(sql).replace(/\s+/g, " ").trim().toLowerCase();
}

/** Creates a mock DB client that simulates a happy-path voice order creation */
function createHappyPathClient() {
  const orderId = "aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa";
  const clientQuery = vi.fn(async (sql: unknown, _params?: unknown[]) => {
    const q = normalizeSql(sql);
    if (q === "begin" || q === "commit" || q === "rollback") {
      return { rowCount: 0, rows: [] };
    }
    // Lot query
    if (q.includes("from production_lots l")) {
      return {
        rowCount: 1,
        rows: [
          {
            lot_id: "33333333-3333-3333-8333-333333333333",
            food_id: "44444444-4444-4444-8444-444444444444",
            seller_id: "22222222-2222-2222-8222-222222222222",
            quantity_available: 10,
            status: "open",
            sale_starts_at: new Date(Date.now() - 3_600_000).toISOString(),
            sale_ends_at: new Date(Date.now() + 3_600_000).toISOString(),
            price: "12.50",
            food_is_active: true,
          },
        ],
      };
    }
    // Duplicate lot check (unique lot count handled in handler)
    // Order insert
    if (q.includes("insert into orders")) {
      return { rowCount: 1, rows: [{ id: orderId }] };
    }
    // Order items insert
    if (q.includes("insert into order_items")) {
      return { rowCount: 1, rows: [] };
    }
    // Order events insert
    if (q.includes("insert into order_events")) {
      return { rowCount: 1, rows: [] };
    }
    throw new Error(`Unhandled SQL in happy-path client: ${q}`);
  });
  return {
    query: clientQuery,
    release: vi.fn(),
    orderId,
  };
}

async function bootApp() {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("HOST", "127.0.0.1");
  vi.stubEnv("PORT", "3000");
  vi.stubEnv("APP_JWT_SECRET", "test_app_jwt_secret_1234567890_abcdef");
  vi.stubEnv("ADMIN_JWT_SECRET", "test_admin_jwt_secret_1234567890_abcd");
  vi.stubEnv("PAYMENT_WEBHOOK_SECRET", "test_payment_webhook_secret_12345");
  vi.stubEnv("PGHOST", "127.0.0.1");
  vi.stubEnv("PGPORT", "5432");
  vi.stubEnv("PGUSER", "coziyoo");
  vi.stubEnv("PGPASSWORD", "coziyoo");
  vi.stubEnv("PGDATABASE", "coziyoo");
  vi.stubEnv("LIVEKIT_URL", "wss://livekit.test.local");
  vi.stubEnv("LIVEKIT_API_KEY", "lk_test_key");
  vi.stubEnv("LIVEKIT_API_SECRET", "lk_test_secret");
  vi.stubEnv("AI_SERVER_SHARED_SECRET", AI_SECRET);

  const { app } = await import("../../src/app.js");

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as AddressInfo;

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function shutdown(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// notify-cook helpers
// ---------------------------------------------------------------------------

const NOTIFY_ORDER_ID = "cccccccc-cccc-1ccc-8ccc-cccccccccccc";
const NOTIFY_SELLER_ID = "22222222-2222-2222-8222-222222222222";
const NOTIFY_BUYER_ID = "11111111-1111-1111-8111-111111111111";

function createNotifyCookClient(found = true) {
  const clientQuery = vi.fn(async (sql: unknown, _params?: unknown[]) => {
    const q = normalizeSql(sql);
    if (q === "begin" || q === "commit" || q === "rollback") {
      return { rowCount: 0, rows: [] };
    }
    if (q.includes("select id, seller_id, buyer_id, status from orders")) {
      if (!found) return { rowCount: 0, rows: [] };
      return {
        rowCount: 1,
        rows: [{ id: NOTIFY_ORDER_ID, seller_id: NOTIFY_SELLER_ID, buyer_id: NOTIFY_BUYER_ID, status: "pending_seller_approval" }],
      };
    }
    throw new Error(`Unhandled SQL in notify-cook client: ${q}`);
  });
  return { query: clientQuery, release: vi.fn() };
}

describe("POST /v1/orders/:id/notify-cook", () => {
  it("returns 401 UNAUTHORIZED when x-ai-server-secret is missing", async () => {
    const app = await bootApp();
    try {
      const response = await fetch(`${app.baseUrl}/v1/orders/${NOTIFY_ORDER_ID}/notify-cook`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      expect(response.status).toBe(401);
      const json = (await response.json()) as { error?: { code?: string } };
      expect(json.error?.code).toBe("UNAUTHORIZED");
    } finally {
      await shutdown(app.server);
    }
  });

  it("returns 404 ORDER_NOT_FOUND when order does not exist", async () => {
    const app = await bootApp();
    const client = createNotifyCookClient(false);
    mockConnect.mockResolvedValue(client);
    mockEnqueueOutboxEvent.mockResolvedValue(undefined);
    try {
      const response = await fetch(`${app.baseUrl}/v1/orders/${NOTIFY_ORDER_ID}/notify-cook`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ai-server-secret": AI_SECRET,
        },
      });
      expect(response.status).toBe(404);
      const json = (await response.json()) as { error?: { code?: string } };
      expect(json.error?.code).toBe("ORDER_NOT_FOUND");
    } finally {
      await shutdown(app.server);
    }
  });

  it("returns 200 with notified=true, orderId, sellerId on valid request", async () => {
    const app = await bootApp();
    const client = createNotifyCookClient(true);
    mockConnect.mockResolvedValue(client);
    mockEnqueueOutboxEvent.mockResolvedValue(undefined);
    try {
      const response = await fetch(`${app.baseUrl}/v1/orders/${NOTIFY_ORDER_ID}/notify-cook`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ai-server-secret": AI_SECRET,
        },
      });
      expect(response.status).toBe(200);
      const json = (await response.json()) as { data?: { notified?: boolean; orderId?: string; sellerId?: string } };
      expect(json.data?.notified).toBe(true);
      expect(json.data?.orderId).toBe(NOTIFY_ORDER_ID);
      expect(json.data?.sellerId).toBe(NOTIFY_SELLER_ID);
    } finally {
      await shutdown(app.server);
    }
  });

  it("enqueues outbox event with eventType=cook_notification_sent", async () => {
    const app = await bootApp();
    const client = createNotifyCookClient(true);
    mockConnect.mockResolvedValue(client);
    mockEnqueueOutboxEvent.mockResolvedValue(undefined);
    try {
      await fetch(`${app.baseUrl}/v1/orders/${NOTIFY_ORDER_ID}/notify-cook`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ai-server-secret": AI_SECRET,
        },
      });
      expect(mockEnqueueOutboxEvent).toHaveBeenCalledOnce();
      const [, event] = mockEnqueueOutboxEvent.mock.calls[0] as [unknown, { eventType: string; payload: { channel: string } }];
      expect(event.eventType).toBe("cook_notification_sent");
      expect(event.payload.channel).toBe("voice_order");
    } finally {
      await shutdown(app.server);
    }
  });
});

describe("POST /v1/orders/voice", () => {
  it("returns 401 when x-ai-server-secret header is missing", async () => {
    const app = await bootApp();
    try {
      const response = await fetch(`${app.baseUrl}/v1/orders/voice`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(VALID_BODY),
      });
      expect(response.status).toBe(401);
      const json = (await response.json()) as { error?: { code?: string } };
      expect(json.error?.code).toBe("UNAUTHORIZED");
    } finally {
      await shutdown(app.server);
    }
  });

  it("returns 401 when x-ai-server-secret header has wrong value", async () => {
    const app = await bootApp();
    try {
      const response = await fetch(`${app.baseUrl}/v1/orders/voice`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ai-server-secret": "wrong_secret_value_that_does_not_match",
        },
        body: JSON.stringify(VALID_BODY),
      });
      expect(response.status).toBe(401);
      const json = (await response.json()) as { error?: { code?: string } };
      expect(json.error?.code).toBe("UNAUTHORIZED");
    } finally {
      await shutdown(app.server);
    }
  });

  it("returns 400 IDEMPOTENCY_KEY_REQUIRED when Idempotency-Key header is missing", async () => {
    const app = await bootApp();
    // Idempotency middleware hits pool.query — make it return no cached record
    mockPoolQuery.mockResolvedValue({ rowCount: 0, rows: [] });
    try {
      const response = await fetch(`${app.baseUrl}/v1/orders/voice`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ai-server-secret": AI_SECRET,
        },
        body: JSON.stringify(VALID_BODY),
      });
      expect(response.status).toBe(400);
      const json = (await response.json()) as { error?: { code?: string } };
      expect(json.error?.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    } finally {
      await shutdown(app.server);
    }
  });

  it("returns 400 VALIDATION_ERROR when userId is missing from body", async () => {
    const app = await bootApp();
    try {
      const { userId: _removed, ...bodyWithoutUserId } = VALID_BODY;
      const response = await fetch(`${app.baseUrl}/v1/orders/voice`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ai-server-secret": AI_SECRET,
        },
        body: JSON.stringify(bodyWithoutUserId),
      });
      // Validation happens before idempotency in our route
      expect(response.status).toBe(400);
      const json = (await response.json()) as { error?: { code?: string } };
      expect(json.error?.code).toBe("VALIDATION_ERROR");
    } finally {
      await shutdown(app.server);
    }
  });

  it("returns 201 with orderId, status, totalPrice on valid request", async () => {
    const app = await bootApp();
    const { query: clientQuery, release, orderId } = createHappyPathClient();
    mockConnect.mockResolvedValue({ query: clientQuery, release });
    // pool.query used by idempotency middleware: SELECT returns no record, INSERT succeeds, UPDATE succeeds
    mockPoolQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // SELECT idempotency_keys — no record
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // INSERT idempotency_keys
      .mockResolvedValue({ rowCount: 1, rows: [] });    // UPDATE idempotency_keys (after response)
    mockEnqueueOutboxEvent.mockResolvedValue(undefined);

    try {
      const response = await fetch(`${app.baseUrl}/v1/orders/voice`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ai-server-secret": AI_SECRET,
          "idempotency-key": IDEMPOTENCY_KEY,
        },
        body: JSON.stringify(VALID_BODY),
      });
      expect(response.status).toBe(201);
      const json = (await response.json()) as { data?: { orderId?: string; status?: string; totalPrice?: number } };
      expect(json.data?.orderId).toBe(orderId);
      expect(json.data?.status).toBe("pending_seller_approval");
      expect(typeof json.data?.totalPrice).toBe("number");
    } finally {
      await shutdown(app.server);
    }
  });

  it("replays cached 201 response on duplicate Idempotency-Key (x-idempotent-replay: true)", async () => {
    const app = await bootApp();
    const cachedBody = {
      data: {
        orderId: "bbbbbbbb-bbbb-1bbb-8bbb-bbbbbbbbbbbb",
        status: "pending_seller_approval",
        totalPrice: 25.0,
      },
    };
    // pool.query: SELECT idempotency_keys returns a matching cached row
    mockPoolQuery.mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          // request_hash matches what idempotency middleware computes for this request
          // We trigger replay by returning same hash — middleware uses sha256 of {method,path,actor,body}
          // We pass a pre-set request_hash. The middleware will compute its own hash and compare.
          // To force a replay we need request_hash == computed hash. Since we can't predict
          // the exact sha256, we set request_hash to the wildcard approach: same object.
          // The easiest way: set response_status non-null so middleware returns cached result.
          // Middleware checks row.request_hash !== requestHash → conflict; we need them equal.
          // We set a matching hash below by importing sha256 indirectly via computed value.
          // Simplest approach: return response_status = null to simulate in-progress (409).
          // But the plan requires replay (x-idempotent-replay: true).
          // We'll set request_hash to a placeholder and rely on the fact that the middleware
          // will compute the hash from the actual request. We return a row with response_status
          // set and matching request_hash using a wildcard mock for any SELECT.
          request_hash: "PLACEHOLDER",
          response_status: 201,
          response_body_json: cachedBody,
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        },
      ],
    });

    // Since the idempotency middleware computes a requestHash and compares to stored request_hash,
    // we need them to match. We'll mock the pool.query to return the hash that the middleware
    // would compute. Since we can't pre-compute that here, we override the comparison by
    // making the mock return the exact same request_hash that middleware computes.
    // Workaround: intercept pool.query and for the SELECT call, return a row whose
    // request_hash matches the computed value. We do this by making pool.query dynamic.
    const crypto = await import("node:crypto");
    function sha256(value: string): string {
      return crypto.createHash("sha256").update(value).digest("hex");
    }
    const requestHash = sha256(
      JSON.stringify({
        method: "POST",
        path: "/voice",
        actor: VALID_BODY.userId,
        body: VALID_BODY,
      })
    );
    mockPoolQuery.mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          request_hash: requestHash,
          response_status: 201,
          response_body_json: cachedBody,
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        },
      ],
    });

    try {
      const response = await fetch(`${app.baseUrl}/v1/orders/voice`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ai-server-secret": AI_SECRET,
          "idempotency-key": IDEMPOTENCY_KEY,
        },
        body: JSON.stringify(VALID_BODY),
      });
      expect(response.status).toBe(201);
      expect(response.headers.get("x-idempotent-replay")).toBe("true");
      const json = (await response.json()) as typeof cachedBody;
      expect(json.data?.orderId).toBe(cachedBody.data.orderId);
    } finally {
      await shutdown(app.server);
    }
  });
});
