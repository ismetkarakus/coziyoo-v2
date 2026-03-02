import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getDeviceId } from "../lib/device";
import { readJson, request } from "../lib/api";
import { resolveVoiceProviders } from "../providers";
import type { AgentSettings } from "../types";

type SettingsResponse = {
  data?: AgentSettings;
  error?: { message?: string };
};

type OllamaResponse = {
  data?: {
    models?: string[];
  };
};

type N8nStatusResponse = {
  data?: {
    configured?: boolean;
    reachable?: boolean;
    baseUrl?: string | null;
  };
};

const defaultSettings: AgentSettings = {
  agentName: "Coziyoo Voice Agent",
  voiceLanguage: "tr",
  ollamaModel: "llama3.1",
  ollamaBaseUrl: "",
  n8nBaseUrl: "",
  sttProvider: "remote-speech-server",
  sttBaseUrl: "",
  sttTranscribePath: "/v1/audio/transcriptions",
  sttModel: "whisper-1",
  ttsEngine: "f5-tts",
  ttsEnabled: true,
  sttEnabled: true,
  greetingEnabled: true,
  ttsConfig: {
    stt: {
      provider: "remote-speech-server",
      transcribePath: "/v1/audio/transcriptions",
      model: "whisper-1",
    },
    llm: {},
    n8n: {},
  },
};

export default function SettingsPage() {
  const deviceId = useMemo(() => getDeviceId(), []);
  const [settings, setSettings] = useState<AgentSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [n8nStatus, setN8nStatus] = useState<string>("unknown");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState<null | "stt" | "ollama" | "n8n">(null);

  useEffect(() => {
    const run = async () => {
      try {
        const settingsRes = await request(`/v1/livekit/starter/agent-settings/${encodeURIComponent(deviceId)}`, { method: "GET" }, false);
        if (settingsRes.ok) {
          const body = await readJson<SettingsResponse>(settingsRes);
          if (body.data) {
            const nestedStt = body.data.ttsConfig?.stt ?? {};
            const nestedLlm = body.data.ttsConfig?.llm ?? {};
            const nestedN8n = body.data.ttsConfig?.n8n ?? {};
            setSettings({
              ...defaultSettings,
              ...body.data,
              sttProvider: body.data.sttProvider ?? nestedStt.provider ?? defaultSettings.sttProvider,
              sttBaseUrl: body.data.sttBaseUrl ?? nestedStt.baseUrl ?? defaultSettings.sttBaseUrl,
              sttTranscribePath: body.data.sttTranscribePath ?? nestedStt.transcribePath ?? defaultSettings.sttTranscribePath,
              sttModel: body.data.sttModel ?? nestedStt.model ?? defaultSettings.sttModel,
              ollamaBaseUrl: body.data.ollamaBaseUrl ?? nestedLlm.ollamaBaseUrl ?? defaultSettings.ollamaBaseUrl,
              n8nBaseUrl: body.data.n8nBaseUrl ?? nestedN8n.baseUrl ?? defaultSettings.n8nBaseUrl,
              ttsConfig: { ...defaultSettings.ttsConfig, ...(body.data.ttsConfig ?? {}) },
            });
          }
        }

        const modelsRes = await request("/v1/livekit/starter/ollama/models", { method: "GET" }, false);
        if (modelsRes.ok) {
          const modelBody = await readJson<OllamaResponse>(modelsRes);
          setModels(modelBody.data?.models ?? []);
        }

        const n8nRes = await request(
          `/v1/livekit/starter/tools/status?deviceId=${encodeURIComponent(deviceId)}`,
          { method: "GET" },
          false
        );
        if (n8nRes.ok) {
          const n8nBody = await readJson<N8nStatusResponse>(n8nRes);
          if (!n8nBody.data?.configured) {
            setN8nStatus("not-configured");
          } else {
            setN8nStatus(n8nBody.data?.reachable ? "reachable" : "unreachable");
          }
        }
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [deviceId]);

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setSaveMessage(null);

    try {
      const payload: AgentSettings = {
        ...settings,
        sttProvider: settings.sttProvider ?? "remote-speech-server",
        sttBaseUrl: settings.sttBaseUrl,
        sttTranscribePath: settings.sttTranscribePath ?? "/v1/audio/transcriptions",
        sttModel: settings.sttModel ?? "whisper-1",
        ollamaBaseUrl: settings.ollamaBaseUrl,
        n8nBaseUrl: settings.n8nBaseUrl,
        ttsConfig: {
          ...(settings.ttsConfig ?? {}),
          stt: {
            ...(settings.ttsConfig?.stt ?? {}),
            provider: settings.sttProvider ?? settings.ttsConfig?.stt?.provider ?? "remote-speech-server",
            baseUrl: settings.sttBaseUrl ?? settings.ttsConfig?.stt?.baseUrl,
            transcribePath: settings.sttTranscribePath ?? settings.ttsConfig?.stt?.transcribePath ?? "/v1/audio/transcriptions",
            model: settings.sttModel ?? settings.ttsConfig?.stt?.model ?? "whisper-1",
          },
          llm: {
            ...(settings.ttsConfig?.llm ?? {}),
            ollamaBaseUrl: settings.ollamaBaseUrl ?? settings.ttsConfig?.llm?.ollamaBaseUrl,
          },
          n8n: {
            ...(settings.ttsConfig?.n8n ?? {}),
            baseUrl: settings.n8nBaseUrl ?? settings.ttsConfig?.n8n?.baseUrl,
          },
        },
      };
      const res = await request(`/v1/livekit/starter/agent-settings/${encodeURIComponent(deviceId)}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }, false);
      if (!res.ok) {
        const body = await readJson<SettingsResponse>(res);
        setSaveMessage(body.error?.message ?? "Save failed");
        return;
      }
      setSaveMessage("Saved");
    } catch (e) {
      setSaveMessage(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function testIntegration(kind: "stt" | "ollama" | "n8n") {
    setTesting(kind);
    setTestResult(null);
    try {
      const res = await request(
        `/v1/livekit/starter/agent-settings/${encodeURIComponent(deviceId)}/test/${kind}`,
        { method: "POST" },
        false
      );
      const raw = (await res.json()) as { data?: unknown; error?: { message?: string } };
      if (!res.ok) {
        setTestResult(`${kind.toUpperCase()} failed: ${raw.error?.message ?? "Unknown error"}`);
        return;
      }
      setTestResult(`${kind.toUpperCase()} ok: ${JSON.stringify(raw.data)}`);
    } catch (e) {
      setTestResult(`${kind.toUpperCase()} failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setTesting(null);
    }
  }

  if (loading) {
    return <main className="page-center"><section className="card"><p>Loading settings...</p></section></main>;
  }

  const providers = resolveVoiceProviders(settings);

  return (
    <main className="page-center">
      <section className="card wide">
        <h1>Agent Settings</h1>
        <p>Configure remote STT, TTS engine, Ollama model and n8n before login.</p>
        <p className="hint">Device ID: <code>{deviceId}</code></p>
        <form onSubmit={onSave} className="stack">
          <label>
            Agent Name
            <input value={settings.agentName} onChange={(e) => setSettings((prev) => ({ ...prev, agentName: e.target.value }))} required />
          </label>
          <label>
            Voice Language
            <input value={settings.voiceLanguage} onChange={(e) => setSettings((prev) => ({ ...prev, voiceLanguage: e.target.value }))} required />
          </label>
          <label>
            STT Provider
            <input value={settings.sttProvider ?? "remote-speech-server"} onChange={(e) => setSettings((prev) => ({ ...prev, sttProvider: e.target.value }))} required />
          </label>
          <label>
            STT Base URL
            <input value={settings.sttBaseUrl ?? ""} onChange={(e) => setSettings((prev) => ({ ...prev, sttBaseUrl: e.target.value }))} placeholder="http://speech-server:8000" />
          </label>
          <label>
            STT Transcribe Path
            <input value={settings.sttTranscribePath ?? "/v1/audio/transcriptions"} onChange={(e) => setSettings((prev) => ({ ...prev, sttTranscribePath: e.target.value }))} />
          </label>
          <label>
            STT Model
            <input value={settings.sttModel ?? "whisper-1"} onChange={(e) => setSettings((prev) => ({ ...prev, sttModel: e.target.value }))} />
          </label>
          <label>
            TTS Engine
            <select value={settings.ttsEngine} onChange={(e) => setSettings((prev) => ({ ...prev, ttsEngine: e.target.value as AgentSettings["ttsEngine"] }))}>
              <option value="f5-tts">f5-tts</option>
              <option value="xtts">xtts</option>
              <option value="chatterbox">chatterbox</option>
            </select>
          </label>
          <label>
            Ollama Base URL
            <input value={settings.ollamaBaseUrl ?? ""} onChange={(e) => setSettings((prev) => ({ ...prev, ollamaBaseUrl: e.target.value }))} placeholder="http://ollama:11434" />
          </label>
          <label>
            Ollama Model
            <input list="ollama-models" value={settings.ollamaModel} onChange={(e) => setSettings((prev) => ({ ...prev, ollamaModel: e.target.value }))} required />
            <datalist id="ollama-models">
              {models.map((model) => <option key={model} value={model} />)}
            </datalist>
          </label>
          <label>
            n8n Base URL
            <input value={settings.n8nBaseUrl ?? ""} onChange={(e) => setSettings((prev) => ({ ...prev, n8nBaseUrl: e.target.value }))} placeholder="http://n8n:5678" />
          </label>
          <div className="row">
            <label className="checkbox"><input type="checkbox" checked={settings.sttEnabled} onChange={(e) => setSettings((prev) => ({ ...prev, sttEnabled: e.target.checked }))} /> STT enabled</label>
            <label className="checkbox"><input type="checkbox" checked={settings.ttsEnabled} onChange={(e) => setSettings((prev) => ({ ...prev, ttsEnabled: e.target.checked }))} /> TTS enabled</label>
          </div>
          <p className="hint">n8n status: {n8nStatus}</p>
          <div className="row">
            <button type="button" className="ghost" onClick={() => testIntegration("stt")} disabled={testing !== null}>
              {testing === "stt" ? "Testing STT..." : "Test STT"}
            </button>
            <button type="button" className="ghost" onClick={() => testIntegration("ollama")} disabled={testing !== null}>
              {testing === "ollama" ? "Testing Ollama..." : "Test Ollama"}
            </button>
            <button type="button" className="ghost" onClick={() => testIntegration("n8n")} disabled={testing !== null}>
              {testing === "n8n" ? "Testing n8n..." : "Test n8n"}
            </button>
          </div>
          {testResult ? <p className="hint">{testResult}</p> : null}
          <p className="hint">Resolved providers: {providers.stt.provider} / {providers.tts.provider} / {providers.llm.provider}</p>
          {saveMessage ? <p className="hint">{saveMessage}</p> : null}
          <button type="submit" disabled={saving}>{saving ? "Saving..." : "Save Settings"}</button>
        </form>
        <div className="row-split">
          <Link to="/login">Back to Login</Link>
        </div>
      </section>
    </main>
  );
}
