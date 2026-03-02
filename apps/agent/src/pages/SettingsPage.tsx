import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getDeviceId } from "../lib/device";
import { readJson, request } from "../lib/api";
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

  useEffect(() => {
    const run = async () => {
      try {
        const settingsRes = await request(`/v1/livekit/starter/agent-settings/${encodeURIComponent(deviceId)}`, { method: "GET" }, false);
        if (settingsRes.ok) {
          const body = await readJson<SettingsResponse>(settingsRes);
          if (body.data) {
            setSettings({ ...defaultSettings, ...body.data, ttsConfig: { ...defaultSettings.ttsConfig, ...(body.data.ttsConfig ?? {}) } });
          }
        }

        const modelsRes = await request("/v1/livekit/starter/ollama/models", { method: "GET" }, false);
        if (modelsRes.ok) {
          const modelBody = await readJson<OllamaResponse>(modelsRes);
          setModels(modelBody.data?.models ?? []);
        }

        const n8nRes = await request("/v1/livekit/starter/tools/status", { method: "GET" }, false);
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
        ttsConfig: {
          ...(settings.ttsConfig ?? {}),
          stt: {
            ...(settings.ttsConfig?.stt ?? {}),
            provider: settings.ttsConfig?.stt?.provider ?? "remote-speech-server",
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

  if (loading) {
    return <main className="page-center"><section className="card"><p>Loading settings...</p></section></main>;
  }

  const stt = settings.ttsConfig?.stt ?? {};
  const llm = settings.ttsConfig?.llm ?? {};
  const n8n = settings.ttsConfig?.n8n ?? {};

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
            <input value={stt.provider ?? "remote-speech-server"} onChange={(e) => setSettings((prev) => ({ ...prev, ttsConfig: { ...(prev.ttsConfig ?? {}), stt: { ...(prev.ttsConfig?.stt ?? {}), provider: e.target.value } } }))} required />
          </label>
          <label>
            STT Base URL
            <input value={stt.baseUrl ?? ""} onChange={(e) => setSettings((prev) => ({ ...prev, ttsConfig: { ...(prev.ttsConfig ?? {}), stt: { ...(prev.ttsConfig?.stt ?? {}), baseUrl: e.target.value } } }))} placeholder="http://speech-server:8000" />
          </label>
          <label>
            STT Transcribe Path
            <input value={stt.transcribePath ?? "/v1/audio/transcriptions"} onChange={(e) => setSettings((prev) => ({ ...prev, ttsConfig: { ...(prev.ttsConfig ?? {}), stt: { ...(prev.ttsConfig?.stt ?? {}), transcribePath: e.target.value } } }))} />
          </label>
          <label>
            STT Model
            <input value={stt.model ?? "whisper-1"} onChange={(e) => setSettings((prev) => ({ ...prev, ttsConfig: { ...(prev.ttsConfig ?? {}), stt: { ...(prev.ttsConfig?.stt ?? {}), model: e.target.value } } }))} />
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
            <input value={llm.ollamaBaseUrl ?? ""} onChange={(e) => setSettings((prev) => ({ ...prev, ttsConfig: { ...(prev.ttsConfig ?? {}), llm: { ...(prev.ttsConfig?.llm ?? {}), ollamaBaseUrl: e.target.value } } }))} placeholder="http://ollama:11434" />
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
            <input value={n8n.baseUrl ?? ""} onChange={(e) => setSettings((prev) => ({ ...prev, ttsConfig: { ...(prev.ttsConfig ?? {}), n8n: { ...(prev.ttsConfig?.n8n ?? {}), baseUrl: e.target.value } } }))} placeholder="http://n8n:5678" />
          </label>
          <div className="row">
            <label className="checkbox"><input type="checkbox" checked={settings.sttEnabled} onChange={(e) => setSettings((prev) => ({ ...prev, sttEnabled: e.target.checked }))} /> STT enabled</label>
            <label className="checkbox"><input type="checkbox" checked={settings.ttsEnabled} onChange={(e) => setSettings((prev) => ({ ...prev, ttsEnabled: e.target.checked }))} /> TTS enabled</label>
          </div>
          <p className="hint">n8n status: {n8nStatus}</p>
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
