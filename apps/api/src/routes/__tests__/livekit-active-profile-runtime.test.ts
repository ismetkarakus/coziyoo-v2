import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPoolQuery = vi.fn();

vi.mock("../../db/client.js", () => ({
  pool: {
    query: (...args: unknown[]) => mockPoolQuery(...args),
  },
}));

describe("resolveRuntimeProfileConfig", () => {
  beforeEach(() => {
    mockPoolQuery.mockReset();
  });

  it("returns normalized providers from active profile", async () => {
    mockPoolQuery.mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          id: "profile-active",
          is_active: true,
          system_prompt: "aktif prompt",
          greeting_enabled: true,
          greeting_instruction: "merhaba de",
          voice_language: "tr",
          llm_config: { model: "gpt-4o-mini", base_url: "http://llm.local" },
          stt_config: { provider: "remote-speech-server", base_url: "http://stt.local" },
          tts_config: { engine: "f5-tts", base_url: "http://tts.local" },
          n8n_config: { base_url: "http://n8n.local", workflow_id: "wf-1" },
        },
      ],
    });

    const { resolveRuntimeProfileConfig } = await import("../../services/agent-profile-runtime.js");
    const resolved = await resolveRuntimeProfileConfig();

    expect(resolved).not.toBeNull();
    expect(resolved?.profileId).toBe("profile-active");
    expect(resolved?.voiceLanguage).toBe("tr");
    expect(resolved?.systemPrompt).toBe("aktif prompt");
    expect(resolved?.greetingEnabled).toBe(true);
    expect(resolved?.greetingInstruction).toBe("merhaba de");
    expect(resolved?.providers.stt.baseUrl).toBe("http://stt.local");
    expect(resolved?.providers.tts.baseUrl).toBe("http://tts.local");
    expect(resolved?.providers.n8n.baseUrl).toBe("http://n8n.local");
  });

  it("prefers explicit settingsProfileId over active profile", async () => {
    mockPoolQuery.mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          id: "profile-explicit",
          is_active: false,
          system_prompt: null,
          greeting_enabled: false,
          greeting_instruction: null,
          voice_language: "en",
          llm_config: {},
          stt_config: {},
          tts_config: {},
          n8n_config: {},
        },
      ],
    });

    const { resolveRuntimeProfileConfig } = await import("../../services/agent-profile-runtime.js");
    const resolved = await resolveRuntimeProfileConfig("profile-explicit");

    expect(resolved?.profileId).toBe("profile-explicit");
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    expect(String(mockPoolQuery.mock.calls[0]?.[0] ?? "")).toContain("WHERE id = $1");
    expect(mockPoolQuery.mock.calls[0]?.[1]).toEqual(["profile-explicit"]);
  });

  it("returns null when there is no active profile", async () => {
    mockPoolQuery.mockResolvedValue({
      rowCount: 0,
      rows: [],
    });

    const { resolveRuntimeProfileConfig } = await import("../../services/agent-profile-runtime.js");
    const resolved = await resolveRuntimeProfileConfig();

    expect(resolved).toBeNull();
  });
});
