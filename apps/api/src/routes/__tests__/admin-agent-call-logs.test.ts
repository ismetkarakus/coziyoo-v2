import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminAgentCallLogsRouter } from "../admin-agent-call-logs.js";

const mockPoolQuery = vi.fn();

vi.mock("../../db/client.js", () => ({
  pool: {
    query: (...args: unknown[]) => mockPoolQuery(...args),
  },
}));

async function shutdown(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function createTestApp() {
  const app = express();
  app.use((req, res, next) => {
    if (req.headers.authorization !== "Bearer admin-test-token") {
      return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Missing admin auth" } });
    }
    return next();
  });
  app.use("/v1/admin/agent-call-logs", adminAgentCallLogsRouter);
  return app;
}

describe("admin-agent-call-logs route", () => {
  beforeEach(() => {
    mockPoolQuery.mockReset();
    mockPoolQuery.mockResolvedValue({ rows: [] });
  });

  it("rejects unauthorized requests", async () => {
    const app = createTestApp();
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    try {
      const response = await fetch(`${baseUrl}/v1/admin/agent-call-logs`);
      expect(response.status).toBe(401);
      expect(mockPoolQuery).not.toHaveBeenCalled();
    } finally {
      await shutdown(server);
    }
  });

  it("returns logs ordered by started_at desc with pagination defaults", async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [
        {
          id: "1",
          room_name: "room-1",
          profile_id: null,
          profile_name: null,
          started_at: "2026-03-22T10:00:00.000Z",
          ended_at: "2026-03-22T10:01:00.000Z",
          duration_seconds: 60,
          outcome: "completed",
          summary: "ok",
          device_id: null,
          created_at: "2026-03-22T10:01:00.000Z",
        },
      ],
    });

    const app = createTestApp();
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    try {
      const response = await fetch(`${baseUrl}/v1/admin/agent-call-logs`, {
        headers: { authorization: "Bearer admin-test-token" },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { data: Array<{ room_name: string }> };
      expect(body.data[0]?.room_name).toBe("room-1");
      expect(String(mockPoolQuery.mock.calls[0]?.[0] ?? "")).toContain("ORDER BY l.started_at DESC");
      expect(mockPoolQuery.mock.calls[0]?.[1]).toEqual([50, 0]);
    } finally {
      await shutdown(server);
    }
  });

  it("applies profile and date range filters", async () => {
    const app = createTestApp();
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const profileId = "d8b4a349-b9d2-4d70-9daf-58a89f983dd8";
    const from = "2026-03-21T00:00:00.000Z";
    const to = "2026-03-22T23:59:59.000Z";

    try {
      const response = await fetch(
        `${baseUrl}/v1/admin/agent-call-logs?profileId=${profileId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=20&offset=5`,
        { headers: { authorization: "Bearer admin-test-token" } },
      );
      expect(response.status).toBe(200);
      const query = String(mockPoolQuery.mock.calls[0]?.[0] ?? "");
      expect(query).toContain("l.profile_id = $1");
      expect(query).toContain("l.started_at >= $2::timestamptz");
      expect(query).toContain("l.started_at <= $3::timestamptz");
      expect(mockPoolQuery.mock.calls[0]?.[1]).toEqual([profileId, from, to, 20, 5]);
    } finally {
      await shutdown(server);
    }
  });
});

