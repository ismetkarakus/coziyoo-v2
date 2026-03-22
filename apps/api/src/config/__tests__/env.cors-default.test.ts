import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("dotenv", () => ({
  default: {
    config: vi.fn(),
  },
}));

const REQUIRED_ENV: Record<string, string> = {
  APP_JWT_SECRET: "a".repeat(32),
  ADMIN_JWT_SECRET: "b".repeat(32),
  PAYMENT_WEBHOOK_SECRET: "c".repeat(16),
  AI_SERVER_SHARED_SECRET: "d".repeat(16),
  PGHOST: "localhost",
  PGUSER: "postgres",
  PGDATABASE: "coziyoo_test",
};

const originalEnv = process.env;

function resetEnvForTest() {
  process.env = {
    ...originalEnv,
    ...REQUIRED_ENV,
  };
  delete process.env.CORS_ALLOWED_ORIGINS;
}

async function loadEnvModule() {
  vi.resetModules();
  return import("../env.js");
}

describe("env CORS fallback defaults", () => {
  afterEach(() => {
    process.env = originalEnv;
  });

  it("includes localhost dashboard origin when CORS_ALLOWED_ORIGINS is unset", async () => {
    resetEnvForTest();
    const { env } = await loadEnvModule();

    expect(env.CORS_ALLOWED_ORIGINS.split(",")).toContain("http://localhost:3001");
  });

  it("includes production dashboard origin when CORS_ALLOWED_ORIGINS is unset", async () => {
    resetEnvForTest();
    const { env } = await loadEnvModule();

    expect(env.CORS_ALLOWED_ORIGINS.split(",")).toContain("https://agent.coziyoo.com");
  });
});
