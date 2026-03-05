import { type FormEvent, useEffect, useRef, useState } from "react";
import { request, parseJson } from "../lib/api";
import { DICTIONARIES } from "../lib/i18n";
import type { Language, ApiError } from "../types/core";
import type { DeviceRow, AgentSettingsFull, VoiceSettingsTab } from "../types/voice";

function readNestedStr(config: Record<string, unknown> | null, ...path: string[]): string {
  let cur: unknown = config;
  for (const key of path) {
    if (cur == null || typeof cur !== "object") return "";
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === "string" ? cur : "";
}

function QueryParamsEditor({
  label,
  params,
  onChange,
}: {
  label: string;
  params: Array<{ key: string; value: string }>;
  onChange: (p: Array<{ key: string; value: string }>) => void;
}) {
  const add = () => onChange([...params, { key: "", value: "" }]);
  const remove = (i: number) => onChange(params.filter((_, idx) => idx !== i));
  const update = (i: number, field: "key" | "value", val: string) =>
    onChange(params.map((p, idx) => (idx === i ? { ...p, [field]: val } : p)));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: "0.82em", fontWeight: 600, color: "var(--color-secondary-text)" }}>{label}</span>
        <button className="ghost" type="button" style={{ fontSize: "0.78em", padding: "2px 10px" }} onClick={add}>+ Add</button>
      </div>
      {params.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          {params.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
              <input style={{ flex: 1, fontSize: "0.82em", padding: "4px 8px" }} value={p.key} onChange={(e) => update(i, "key", e.target.value)} placeholder="key" />
              <input style={{ flex: 2, fontSize: "0.82em", padding: "4px 8px" }} value={p.value} onChange={(e) => update(i, "value", e.target.value)} placeholder="value" />
              <button className="ghost" type="button" style={{ fontSize: "0.78em", padding: "2px 8px", color: "#ef4444", flexShrink: 0 }} onClick={() => remove(i)}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function VoiceAgentSettingsPage({ language }: { language: Language }) {
  const dict = DICTIONARIES[language];
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deviceIdInput, setDeviceIdInput] = useState("default");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<VoiceSettingsTab>("summary");
  const [isCreateProfileOpen, setIsCreateProfileOpen] = useState(false);
  const [newProfileIdInput, setNewProfileIdInput] = useState("");

  // form state
  const [agentName, setAgentName] = useState("");
  const [voiceLanguage, setVoiceLanguage] = useState("en");
  const [ollamaModel, setOllamaModel] = useState("llama3.1:8b");
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState("");
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaModelsFetching, setOllamaModelsFetching] = useState(false);
  const [ollamaModelsError, setOllamaModelsError] = useState<string | null>(null);
  const [ollamaModelsPath, setOllamaModelsPath] = useState("");
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [ttsBaseUrl, setTtsBaseUrl] = useState("");
  const [ttsSynthPath, setTtsSynthPath] = useState("");
  const [sttEnabled, setSttEnabled] = useState(true);
  const [sttProvider, setSttProvider] = useState("");
  const [sttBaseUrl, setSttBaseUrl] = useState("");
  const [sttTranscribePath, setSttTranscribePath] = useState("/v1/transcribe");
  const [sttModel, setSttModel] = useState("");
  const [sttQueryParams, setSttQueryParams] = useState<Array<{ key: string; value: string }>>([]);
  const [ttsQueryParams, setTtsQueryParams] = useState<Array<{ key: string; value: string }>>([]);
  const [sttAuthHeader, setSttAuthHeader] = useState("");
  const [ttsAuthHeader, setTtsAuthHeader] = useState("");
  const [llmAuthHeader, setLlmAuthHeader] = useState("");
  const [n8nBaseUrl, setN8nBaseUrl] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [greetingEnabled, setGreetingEnabled] = useState(true);
  const [greetingInstruction, setGreetingInstruction] = useState("");

  // connection test state: null = untested, true = ok, false = fail
  type TestStatus = { ok: boolean; detail?: string } | null;
  const [testLiveKit, setTestLiveKit] = useState<TestStatus>(null);
  const [testStt, setTestStt] = useState<TestStatus>(null);
  const [testOllama, setTestOllama] = useState<TestStatus>(null);
  const [testN8n, setTestN8n] = useState<TestStatus>(null);
  const [testTts, setTestTts] = useState<TestStatus>(null);
  const [testing, setTesting] = useState(false);

  // TTS test
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const [ttsSynthesizing, setTtsSynthesizing] = useState(false);
  const [ttsSynthError, setTtsSynthError] = useState<string | null>(null);
  const [ttsAudioUrl, setTtsAudioUrl] = useState<string | null>(null);

  // STT record test
  const sttMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const sttChunksRef = useRef<Blob[]>([]);
  const [sttRecording, setSttRecording] = useState(false);
  const [sttTranscribing, setSttTranscribing] = useState(false);
  const [sttTranscript, setSttTranscript] = useState<string | null>(null);
  const [sttTestError, setSttTestError] = useState<string | null>(null);

  function resetSettingsFormToDefaults() {
    setAgentName("");
    setVoiceLanguage("en");
    setOllamaModel("llama3.1:8b");
    setOllamaBaseUrl("");
    setOllamaModels([]);
    setOllamaModelsError(null);
    setOllamaModelsPath("");
    setTtsEnabled(true);
    setTtsBaseUrl("");
    setTtsSynthPath("");
    setSttEnabled(true);
    setSttProvider("");
    setSttBaseUrl("");
    setSttTranscribePath("/v1/transcribe");
    setSttModel("");
    setSttQueryParams([]);
    setTtsQueryParams([]);
    setSttAuthHeader("");
    setTtsAuthHeader("");
    setLlmAuthHeader("");
    setN8nBaseUrl("");
    setSystemPrompt("");
    setGreetingEnabled(true);
    setGreetingInstruction("");
  }

  async function startNewProfileDraft(profileId: string) {
    const normalized = profileId.trim();
    if (!normalized) return;
    setSaving(true);
    setSaveMsg(null);
    setSaveError(null);
    try {
      const res = await request(`/v1/admin/livekit/agent-settings/${encodeURIComponent(normalized)}`, {
        method: "PUT",
        body: JSON.stringify({}),
      });
      const body = await parseJson<{ data?: AgentSettingsFull } & ApiError>(res);
      if (res.status !== 200 || !body.data) {
        setSaveError(body.error?.message ?? dict.voiceAgentSettings.saveError);
        return;
      }
      setIsCreateProfileOpen(false);
      setNewProfileIdInput("");
      await loadDeviceList();
      await loadSettings(normalized);
      setActiveTab("general");
    } catch {
      setSaveError(dict.voiceAgentSettings.saveError);
    } finally {
      setSaving(false);
    }
  }

  async function loadDeviceList(): Promise<DeviceRow[]> {
    const res = await request("/v1/admin/livekit/agent-settings");
    const body = await parseJson<{ data?: DeviceRow[] } & ApiError>(res);
    if (res.status === 200 && body.data) {
      setDevices(body.data);
      return body.data;
    }
    return [];
  }

  async function loadSettings(
    id: string,
    options?: {
      runTestsAfterLoad?: boolean;
    }
  ) {
    setLoadError(null);
    setSaveMsg(null);
    setSaveError(null);
    const res = await request(`/v1/admin/livekit/agent-settings/${encodeURIComponent(id)}`);
    const body = await parseJson<{ data?: AgentSettingsFull } & ApiError>(res);
    if (res.status === 200 && body.data) {
      const s = body.data;
      const loadedOllamaBaseUrl = readNestedStr(s.ttsConfig, "llm", "ollamaBaseUrl");
      const loadedTtsBaseUrl = readNestedStr(s.ttsConfig, "baseUrl");
      const loadedSttProvider = readNestedStr(s.ttsConfig, "stt", "provider");
      const loadedSttBaseUrl = readNestedStr(s.ttsConfig, "stt", "baseUrl");
      const loadedSttTranscribePath = readNestedStr(s.ttsConfig, "stt", "transcribePath") || "/v1/transcribe";
      const loadedSttModel = readNestedStr(s.ttsConfig, "stt", "model");
      const loadedN8nBaseUrl = readNestedStr(s.ttsConfig, "n8n", "baseUrl");
      setCurrentDeviceId(id);
      setAgentName(s.agentName ?? "");
      setVoiceLanguage(s.voiceLanguage ?? "en");
      setOllamaModel(s.ollamaModel ?? "llama3.1:8b");
      setOllamaBaseUrl(loadedOllamaBaseUrl);
      setTtsEnabled(s.ttsEnabled ?? true);
      setTtsBaseUrl(loadedTtsBaseUrl);
      setTtsSynthPath(readNestedStr(s.ttsConfig, "path"));
      setSttEnabled(s.sttEnabled ?? true);
      setSttProvider(loadedSttProvider);
      setSttBaseUrl(loadedSttBaseUrl);
      setSttTranscribePath(loadedSttTranscribePath);
      setSttModel(loadedSttModel);
      const rawSttQP = (typeof s.ttsConfig?.stt === "object" && s.ttsConfig.stt !== null ? (s.ttsConfig.stt as Record<string, unknown>).queryParams : null) ?? {};
      setSttQueryParams(Object.entries(typeof rawSttQP === "object" && rawSttQP !== null ? rawSttQP as Record<string, string> : {}).map(([k, v]) => ({ key: k, value: String(v) })));
      const rawTtsQP = s.ttsConfig?.queryParams ?? {};
      setTtsQueryParams(Object.entries(typeof rawTtsQP === "object" && rawTtsQP !== null ? rawTtsQP as Record<string, string> : {}).map(([k, v]) => ({ key: k, value: String(v) })));
      setSttAuthHeader(readNestedStr(s.ttsConfig, "stt", "authHeader"));
      setTtsAuthHeader(readNestedStr(s.ttsConfig, "authHeader"));
      setLlmAuthHeader(readNestedStr(s.ttsConfig, "llm", "authHeader"));
      setN8nBaseUrl(loadedN8nBaseUrl);
      setSystemPrompt(s.systemPrompt ?? "");
      setGreetingEnabled(s.greetingEnabled ?? true);
      setGreetingInstruction(s.greetingInstruction ?? "");
      if (options?.runTestsAfterLoad) {
        setActiveTab("summary");
        await runTestAll({
          sttBaseUrl: loadedSttBaseUrl,
          sttTranscribePath: loadedSttTranscribePath,
          ollamaBaseUrl: loadedOllamaBaseUrl,
          n8nBaseUrl: loadedN8nBaseUrl,
          ttsBaseUrl: loadedTtsBaseUrl,
        });
      }
    } else if (res.status === 404) {
      // New profile draft
      setCurrentDeviceId(id);
      resetSettingsFormToDefaults();
    } else {
      setLoadError(body.error?.message ?? dict.voiceAgentSettings.loadError);
    }
  }

  async function onLoad(event: FormEvent) {
    event.preventDefault();
    const id = deviceIdInput.trim();
    if (!id) return;
    await loadSettings(id, { runTestsAfterLoad: true });
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    const id = currentDeviceId ?? deviceIdInput.trim();
    if (!id) return;
    setSaving(true);
    setSaveMsg(null);
    setSaveError(null);
    try {
      const res = await request(`/v1/admin/livekit/agent-settings/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify({
          agentName: agentName.trim() || undefined,
          voiceLanguage: voiceLanguage.trim() || undefined,
          ollamaModel: ollamaModel.trim() || undefined,
          ollamaBaseUrl: ollamaBaseUrl.trim() || undefined,
          ttsEnabled,
          ttsBaseUrl: ttsBaseUrl.trim() || undefined,
          ttsSynthPath: ttsSynthPath.trim() || undefined,
          sttEnabled,
          sttProvider: sttProvider.trim() || undefined,
          sttBaseUrl: sttBaseUrl.trim() || undefined,
          sttTranscribePath: sttTranscribePath.trim() || undefined,
          sttModel: sttModel.trim() || undefined,
          sttQueryParams: Object.fromEntries(sttQueryParams.filter((p) => p.key.trim()).map((p) => [p.key.trim(), p.value])),
          ttsQueryParams: Object.fromEntries(ttsQueryParams.filter((p) => p.key.trim()).map((p) => [p.key.trim(), p.value])),
          sttAuthHeader: sttAuthHeader.trim() || undefined,
          ttsAuthHeader: ttsAuthHeader.trim() || undefined,
          llmAuthHeader: llmAuthHeader.trim() || undefined,
          n8nBaseUrl: n8nBaseUrl.trim() || undefined,
          systemPrompt: systemPrompt.trim() || undefined,
          greetingEnabled,
          greetingInstruction: greetingInstruction.trim() || undefined,
        }),
      });
      const body = await parseJson<{ data?: AgentSettingsFull } & ApiError>(res);
      if (res.status !== 200 || !body.data) {
        setSaveError(body.error?.message ?? dict.voiceAgentSettings.saveError);
        return;
      }
      setCurrentDeviceId(id);
      setSaveMsg(dict.voiceAgentSettings.saveSuccess);
      await loadDeviceList();
    } catch {
      setSaveError(dict.voiceAgentSettings.saveError);
    } finally {
      setSaving(false);
    }
  }

  async function deleteProfile(profileId: string) {
    if (!window.confirm(language === "tr" ? `"${profileId}" profilini silmek istediğinizden emin misiniz?` : `Delete profile "${profileId}"?`)) return;
    const res = await request(`/v1/admin/livekit/agent-settings/${encodeURIComponent(profileId)}`, { method: "DELETE" });
    if (res.status === 200) {
      if (currentDeviceId === profileId) {
        setCurrentDeviceId(null);
        resetSettingsFormToDefaults();
      }
      await loadDeviceList();
    } else {
      const body = await parseJson<ApiError>(res);
      setSaveError(body.error?.message ?? "Delete failed");
    }
  }

  async function activateProfile(profileId: string) {
    const res = await request(`/v1/admin/livekit/agent-settings/${encodeURIComponent(profileId)}/activate`, { method: "POST", body: "{}" });
    if (res.status === 200) {
      await loadDeviceList();
    } else {
      const body = await parseJson<ApiError>(res);
      setSaveError(body.error?.message ?? "Activate failed");
    }
  }

  async function runTestLiveKit() {
    setTestLiveKit(null);
    const res = await request("/v1/admin/livekit/test/livekit", { method: "POST", body: "{}" });
    const body = await parseJson<{ data?: { ok: boolean; reason?: string; wsUrl?: string } } & ApiError>(res);
    setTestLiveKit({ ok: body.data?.ok ?? false, detail: body.data?.reason ?? body.data?.wsUrl });
  }

  async function startSttRecording() {
    setSttTranscript(null);
    setSttTestError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      sttChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) sttChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        // ondataavailable fires before onstop completes in all browsers,
        // so chunks are fully collected by the time we reach here.
        void sendSttRecording();
      };
      recorder.start();
      sttMediaRecorderRef.current = recorder;
      setSttRecording(true);
    } catch (err) {
      setSttTestError(err instanceof Error ? err.message : "Microphone access denied");
    }
  }

  function stopSttRecording() {
    const recorder = sttMediaRecorderRef.current;
    if (!recorder) return;
    // requestData() flushes any buffered audio before stop() fires onstop
    recorder.requestData();
    recorder.stop();
    sttMediaRecorderRef.current = null;
    setSttRecording(false);
  }

  async function sendSttRecording() {
    const url = sttBaseUrl.trim();
    const transcribePath = sttTranscribePath.trim() || "/v1/transcribe";
    if (!url) { setSttTestError("No STT URL configured"); return; }
    setSttTranscribing(true);
    setSttTestError(null);
    try {
      const blob = new Blob(sttChunksRef.current, { type: "audio/webm" });
      if (blob.size === 0) { setSttTestError("Recording is empty — try again"); setSttTranscribing(false); return; }
      const form = new FormData();
      form.append("file", blob, "recording.webm");
      if (sttModel.trim()) form.append("model", sttModel.trim());
      for (const { key, value } of sttQueryParams) {
        if (key.trim()) form.append(key.trim(), value);
      }
      const headers: Record<string, string> = {};
      if (sttAuthHeader.trim()) headers["Authorization"] = sttAuthHeader.trim();
      const fullUrl = `${url.replace(/\/$/, "")}${transcribePath}`;
      const res = await fetch(fullUrl, { method: "POST", headers, body: form });
      const text = await res.text();
      if (!res.ok) {
        setSttTestError(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        return;
      }
      try {
        const json = JSON.parse(text) as Record<string, unknown>;
        const transcript = (json.text ?? json.transcript ?? json.transcription ?? text) as string;
        setSttTranscript(String(transcript));
      } catch {
        setSttTranscript(text);
      }
    } catch (err) {
      setSttTestError(err instanceof Error ? err.message : "STT request failed");
    } finally {
      setSttTranscribing(false);
    }
  }

  async function runTestStt(sttBaseUrlOverride?: string, sttTranscribePathOverride?: string) {
    setTestStt(null);
    const url = (sttBaseUrlOverride ?? sttBaseUrl).trim();
    const transcribePath = (sttTranscribePathOverride ?? sttTranscribePath).trim() || "/v1/transcribe";
    if (!url) { setTestStt({ ok: false, detail: "No STT URL configured" }); return; }
    const res = await request("/v1/admin/livekit/test/stt", {
      method: "POST",
      body: JSON.stringify({ baseUrl: url, transcribePath }),
    });
    const body = await parseJson<{ data?: { ok: boolean; reason?: string; status?: number } } & ApiError>(res);
    setTestStt({ ok: body.data?.ok ?? false, detail: body.data?.reason ?? (body.data?.status ? `HTTP ${body.data.status}` : undefined) });
  }

  async function runTestOllama(baseUrlOverride?: string) {
    setTestOllama(null);
    const res = await request("/v1/admin/livekit/test/ollama", {
      method: "POST",
      body: JSON.stringify({ baseUrl: (baseUrlOverride ?? ollamaBaseUrl).trim() || undefined }),
    });
    const body = await parseJson<{ data?: { ok: boolean; reason?: string; models?: string[] } } & ApiError>(res);
    setTestOllama({ ok: body.data?.ok ?? false, detail: body.data?.reason ?? (body.data?.models ? body.data.models.slice(0, 3).join(", ") : undefined) });
  }

  async function runTestN8n(baseUrlOverride?: string) {
    setTestN8n(null);
    const res = await request("/v1/admin/livekit/test/n8n", {
      method: "POST",
      body: JSON.stringify({ baseUrl: (baseUrlOverride ?? n8nBaseUrl).trim() || undefined }),
    });
    const body = await parseJson<{ data?: { ok: boolean; reason?: string } } & ApiError>(res);
    setTestN8n({ ok: body.data?.ok ?? false, detail: body.data?.reason });
  }

  async function fetchOllamaModels(customPath?: string) {
    const url = ollamaBaseUrl.trim();
    if (!url) return;
    setOllamaModelsFetching(true);
    setOllamaModelsError(null);
    try {
      const body: Record<string, string> = { baseUrl: url };
      if (customPath?.trim()) body.modelsPath = customPath.trim();
      const res = await request("/v1/admin/livekit/test/ollama", { method: "POST", body: JSON.stringify(body) });
      const data = await parseJson<{ data?: { ok: boolean; models?: string[]; reason?: string } }>(res);
      const models = data.data?.models ?? [];
      if (models.length === 0) {
        setOllamaModelsError(language === "tr" ? "Model bulunamadı. API path'ini girin ve tekrar deneyin." : "No models found. Enter the API path and try again.");
        setOllamaModels([]);
      } else {
        setOllamaModels(models);
        setOllamaModelsError(null);
        if (!models.includes(ollamaModel)) setOllamaModel(models[0]);
      }
    } catch {
      setOllamaModelsError(language === "tr" ? "Sunucuya ulaşılamadı." : "Could not reach server.");
      setOllamaModels([]);
    } finally {
      setOllamaModelsFetching(false);
    }
  }

  async function runTestSttHealth(urlOverride?: string) {
    const url = (urlOverride ?? sttBaseUrl).trim();
    setTestStt(null);
    if (!url) { setTestStt({ ok: false, detail: "No STT URL configured" }); return; }
    const healthUrl = `${url.replace(/\/$/, "")}/health`;
    try {
      const res = await fetch(healthUrl);
      setTestStt({ ok: res.ok, detail: res.ok ? undefined : `HTTP ${res.status}` });
    } catch {
      try {
        await fetch(healthUrl, { mode: "no-cors" });
        setTestStt({ ok: true });
      } catch (err) {
        setTestStt({ ok: false, detail: err instanceof Error ? err.message : "Unreachable" });
      }
    }
  }

  async function runTestTtsHealth(urlOverride?: string) {
    const url = (urlOverride ?? ttsBaseUrl).trim();
    setTestTts(null);
    if (!url) { setTestTts({ ok: false, detail: "No TTS URL configured" }); return; }
    const healthUrl = `${url.replace(/\/$/, "")}/health`;
    try {
      const res = await fetch(healthUrl);
      setTestTts({ ok: res.ok, detail: res.ok ? undefined : `HTTP ${res.status}` });
    } catch {
      try {
        await fetch(healthUrl, { mode: "no-cors" });
        setTestTts({ ok: true });
      } catch (err) {
        setTestTts({ ok: false, detail: err instanceof Error ? err.message : "Unreachable" });
      }
    }
  }

  async function runTestAll(overrides?: { sttBaseUrl?: string; sttTranscribePath?: string; ollamaBaseUrl?: string; n8nBaseUrl?: string; ttsBaseUrl?: string }) {
    setTesting(true);
    setTestLiveKit(null);
    setTestStt(null);
    setTestOllama(null);
    setTestN8n(null);
    setTestTts(null);
    await Promise.allSettled([
      runTestLiveKit(),
      runTestSttHealth(overrides?.sttBaseUrl),
      runTestOllama(overrides?.ollamaBaseUrl),
      runTestN8n(overrides?.n8nBaseUrl),
      runTestTtsHealth(overrides?.ttsBaseUrl),
    ]);
    setTesting(false);
  }

  async function runTestTts() {
    const baseUrlTrimmed = ttsBaseUrl.trim();
    if (!baseUrlTrimmed) { setTtsSynthError(dict.voiceAgentSettings.testTtsNoUrl); return; }
    setTtsSynthesizing(true);
    setTtsSynthError(null);
    if (ttsAudioUrl) { URL.revokeObjectURL(ttsAudioUrl); setTtsAudioUrl(null); }
    try {
      const path = ttsSynthPath.trim() || "/tts";
      const ttsUrl = `${baseUrlTrimmed.replace(/\/$/, "")}${path}`;
      const bodyParams = Object.fromEntries(ttsQueryParams.filter((p) => p.key.trim()).map((p) => [p.key.trim(), p.value]));
      const textParam = (bodyParams.text as string | undefined)?.trim() || "Hello";
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (ttsAuthHeader.trim()) headers["Authorization"] = ttsAuthHeader.trim();
      const res = await fetch(ttsUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ text: textParam, ...bodyParams }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        const msg = `TTS error ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`;
        setTtsSynthError(msg);
        return;
      }
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      setTtsAudioUrl(objUrl);
      if (ttsAudioRef.current) {
        ttsAudioRef.current.src = objUrl;
        ttsAudioRef.current.play().catch(() => undefined);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "TTS request failed";
      setTtsSynthError(msg);
    } finally {
      setTtsSynthesizing(false);
    }
  }

  useEffect(() => {
    loadDeviceList()
      .then((list) => {
        if (list.length === 0) return;
        const first = list.find((d) => d.is_active) ?? list[0];
        loadSettings(first.device_id, { runTestsAfterLoad: true }).catch(() => undefined);
      })
      .catch(() => undefined);
  }, []);

  function StatusDot({ status }: { status: TestStatus }) {
    const color = status === null ? "#999" : status.ok ? "#22c55e" : "#ef4444";
    const label = status === null ? dict.voiceAgentSettings.statusUnknown : status.ok ? dict.voiceAgentSettings.statusOk : dict.voiceAgentSettings.statusFail;
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, display: "inline-block", flexShrink: 0 }} />
        <span style={{ fontSize: "0.8em", color, fontWeight: 600 }}>{label}</span>
        {status?.detail ? <span style={{ fontSize: "0.75em", color: "var(--text-muted, #888)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{status.detail}</span> : null}
      </span>
    );
  }

  const voiceTabs: Array<{ key: VoiceSettingsTab; label: string }> = [
    { key: "summary", label: "Summary" },
    { key: "general", label: dict.voiceAgentSettings.sectionGeneral },
    { key: "stt", label: dict.voiceAgentSettings.sectionStt },
    { key: "tts", label: dict.voiceAgentSettings.sectionTts },
    { key: "llm", label: dict.voiceAgentSettings.sectionLlm },
    { key: "n8n", label: dict.voiceAgentSettings.sectionN8n },
    { key: "behaviour", label: dict.voiceAgentSettings.sectionBehaviour },
  ];

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <p className="eyebrow">{dict.voiceAgentSettings.eyebrow}</p>
          <h1>{dict.voiceAgentSettings.title}</h1>
          <p className="subtext">{dict.voiceAgentSettings.subtitle}</p>
        </div>
        <div className="topbar-actions">
          <button className="ghost" type="button" onClick={() => { loadDeviceList().catch(() => undefined); }}>{dict.actions.refresh}</button>
        </div>
      </header>

      {loadError ? <div className="alert">{loadError}</div> : null}
      {saveError ? <div className="alert">{saveError}</div> : null}

      {/* ── Card 1: Profile Manager ────────────────────────────── */}
      <section className="panel">
        <div className="panel-header">
          <h2>{language === "tr" ? "Profil Yönetimi" : "Profile Manager"}</h2>
          <button className="primary" type="button" onClick={() => setIsCreateProfileOpen((prev) => !prev)}>
            {isCreateProfileOpen ? (language === "tr" ? "İptal" : "Cancel") : (language === "tr" ? "+ Yeni Profil" : "+ New Profile")}
          </button>
        </div>

        {isCreateProfileOpen ? (
          <div style={{ padding: "0.6rem 1.5rem", borderBottom: "1px solid var(--color-border)" }}>
            <form
              onSubmit={(event) => { event.preventDefault(); void startNewProfileDraft(newProfileIdInput); }}
              style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}
            >
              <div style={{ position: "relative", flex: 1 }}>
                <span style={{ position: "absolute", top: "-0.45em", left: "0.6rem", fontSize: "0.72em", fontWeight: 600, color: "var(--color-secondary-text)", background: "var(--color-panel-bg, var(--color-bg))", padding: "0 4px", lineHeight: 1, pointerEvents: "none" }}>
                  {language === "tr" ? "Profil ID" : "Profile ID"}
                </span>
                <input
                  style={{ margin: 0, padding: "5px 10px", fontSize: "0.85em", width: "100%" }}
                  value={newProfileIdInput}
                  onChange={(e) => setNewProfileIdInput(e.target.value)}
                  placeholder="default, english, production…"
                  autoFocus
                />
              </div>
              <button className="primary" type="submit" style={{ fontSize: "0.82em", padding: "5px 14px", flexShrink: 0 }}>
                {language === "tr" ? "Oluştur" : "Create"}
              </button>
            </form>
          </div>
        ) : null}

        {devices.length === 0 ? (
          <p className="panel-meta" style={{ padding: "1.25rem 1.5rem" }}>
            {language === "tr" ? "Henüz profil yok. Bir tane oluşturun." : "No profiles yet. Create one above."}
          </p>
        ) : (
          <div className="table-wrap" style={{ padding: "0 1rem 0.75rem" }}>
            <div className="table">
              <div className="table-row table-head">
                <span>{language === "tr" ? "Profil ID" : "Profile ID"}</span>
                <span>{language === "tr" ? "Ajan Adı" : "Agent Name"}</span>
                <span>{language === "tr" ? "Dil" : "Language"}</span>
                <span>TTS</span>
                <span>{language === "tr" ? "Güncellendi" : "Updated"}</span>
                <span>{language === "tr" ? "İşlemler" : "Actions"}</span>
              </div>
            {devices.map((d) => {
              const isSelected = currentDeviceId === d.device_id;
              return (
                <div
                  key={d.device_id}
                  className={`table-row${isSelected ? " table-row--selected" : ""}`}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontFamily: "monospace", fontSize: "0.85em", fontWeight: isSelected ? 700 : 500 }}>
                    {d.device_id}
                    {d.is_active ? (
                      <span style={{ fontSize: "0.65em", fontWeight: 700, color: "#fff", background: "#22c55e", borderRadius: 4, padding: "1px 6px", textTransform: "uppercase", flexShrink: 0 }}>
                        {language === "tr" ? "Aktif" : "Active"}
                      </span>
                    ) : null}
                  </span>
                  <span>{d.agent_name || "—"}</span>
                  <span>{d.voice_language || "—"}</span>
                  <span>{d.tts_enabled ? "ON" : "OFF"}</span>
                  <span className="panel-meta" style={{ fontSize: "0.85em" }}>
                    {new Date(d.updated_at).toLocaleDateString()}
                  </span>
                  <span style={{ display: "inline-flex", gap: "0.4rem" }}>
                    <button
                      className={isSelected ? "primary" : "ghost"}
                      type="button"
                      style={{ fontSize: "0.8em", padding: "4px 10px" }}
                      onClick={() => { setDeviceIdInput(d.device_id); loadSettings(d.device_id, { runTestsAfterLoad: true }).catch(() => undefined); }}
                    >
                      {isSelected ? (language === "tr" ? "Yüklü" : "Loaded") : (language === "tr" ? "Yükle" : "Load")}
                    </button>
                    {!d.is_active ? (
                      <button
                        className="ghost"
                        type="button"
                        style={{ fontSize: "0.8em", padding: "4px 10px" }}
                        onClick={() => activateProfile(d.device_id).catch(() => undefined)}
                      >
                        {language === "tr" ? "Aktif Yap" : "Set Active"}
                      </button>
                    ) : null}
                    <button
                      className="ghost"
                      type="button"
                      style={{ fontSize: "0.8em", padding: "4px 10px", color: "#ef4444" }}
                      onClick={() => deleteProfile(d.device_id).catch(() => undefined)}
                    >
                      {language === "tr" ? "Sil" : "Delete"}
                    </button>
                  </span>
                </div>
              );
            })}
            </div>
          </div>
        )}

      </section>

      {/* ── Card 2: Tabbed Settings ────────────────────────────── */}
      <section className="panel" style={{ paddingBottom: 0 }}>
        {/* Tab bar */}
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--color-border)", overflowX: "auto" }}>
          {voiceTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: "0.65rem 1.1rem",
                fontSize: "0.82em",
                fontWeight: activeTab === tab.key ? 700 : 500,
                color: activeTab === tab.key ? "var(--color-accent)" : "var(--color-secondary-text)",
                borderRadius: 0,
                background: "none",
                border: "none",
                borderBottom: activeTab === tab.key ? "2px solid var(--color-accent)" : "2px solid transparent",
                cursor: "pointer",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* No-profile empty state */}
        {currentDeviceId === null ? (
          <div style={{ padding: "2rem 1.5rem", textAlign: "center" }}>
            <p style={{ fontSize: "1em", color: "var(--color-secondary-text)" }}>
              {language === "tr"
                ? "Ayarları görmek için üstten bir profil yükleyin veya yeni oluşturun."
                : "Load or create a profile above to view and edit settings."}
            </p>
          </div>
        ) : (
          <form onSubmit={onSave} style={{ display: "flex", flexDirection: "column" }}>
            {/* ── Summary tab ─────────────────────────── */}
            {activeTab === "summary" ? (
              <div style={{ padding: "1.25rem 1.5rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                {/* Connection tests */}
                <div>
                  <p style={{ fontWeight: 600, fontSize: "0.85em", marginBottom: "0.6rem", color: "var(--color-secondary-text)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    {dict.voiceAgentSettings.sectionConnection}
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    {[
                      { label: "LiveKit", status: testLiveKit, onTest: runTestLiveKit },
                      { label: "STT", status: testStt, onTest: runTestSttHealth },
                      { label: "Ollama / LLM", status: testOllama, onTest: runTestOllama },
                      { label: "N8N", status: testN8n, onTest: runTestN8n },
                      { label: "TTS", status: testTts, onTest: runTestTtsHealth },
                    ].map(({ label, status, onTest }) => (
                      <div key={label} style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.5rem 0.75rem", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-card-bg)" }}>
                        <span style={{ width: 9, height: 9, borderRadius: "50%", background: status === null ? "#aaa" : status.ok ? "#22c55e" : "#ef4444", flexShrink: 0 }} />
                        <span style={{ fontSize: "0.85em", fontWeight: 600, width: 100, flexShrink: 0 }}>{label}</span>
                        <span className="panel-meta" style={{ flex: 1, fontSize: "0.78em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{status?.detail ?? ""}</span>
                        <button className="ghost" type="button" style={{ fontSize: "0.75em", padding: "2px 10px", flexShrink: 0 }} onClick={() => { void onTest(); }}>Test</button>
                      </div>
                    ))}

                  </div>
                  <div style={{ marginTop: "0.75rem" }}>
                    <button className="primary" type="button" onClick={() => { void runTestAll(); }} disabled={testing} style={{ fontSize: "0.85em" }}>
                      {testing ? dict.voiceAgentSettings.testing : dict.voiceAgentSettings.testAll}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {/* ── General tab ─────────────────────────── */}
            {activeTab === "general" ? (
              <div style={{ padding: "1.25rem 1.5rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                <div className="form-grid">
                  <label>{dict.voiceAgentSettings.agentName}<input value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="coziyoo-agent" /></label>
                  <label style={{ gap: "0.5rem" }}>
                    {dict.voiceAgentSettings.voiceLanguage}
                    <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                      {["tr", "en"].map((lang) => (
                        <button
                          key={lang}
                          type="button"
                          onClick={() => setVoiceLanguage(lang)}
                          style={{
                            padding: "3px 12px",
                            borderRadius: 20,
                            fontSize: "0.82em",
                            fontWeight: 600,
                            border: "1px solid",
                            cursor: "pointer",
                            borderColor: voiceLanguage === lang ? "var(--color-primary)" : "var(--color-border)",
                            background: voiceLanguage === lang ? "var(--color-primary)" : "transparent",
                            color: voiceLanguage === lang ? "#fff" : "var(--color-text)",
                          }}
                        >
                          {lang}
                        </button>
                      ))}
                    </div>
                  </label>
                </div>
              </div>
            ) : null}

            {/* ── STT tab ─────────────────────────────── */}
            {activeTab === "stt" ? (
              <div style={{ padding: "1.25rem 1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div className="checkbox-grid">
                  <label><input type="checkbox" checked={sttEnabled} onChange={(e) => setSttEnabled(e.target.checked)} />{dict.voiceAgentSettings.sttEnabled}</label>
                </div>
                <div className="form-grid">
                  <label>{dict.voiceAgentSettings.sttProvider}<input value={sttProvider} onChange={(e) => setSttProvider(e.target.value)} placeholder="remote-speech-server" /></label>
                  <label>{dict.voiceAgentSettings.sttBaseUrl}<input value={sttBaseUrl} onChange={(e) => setSttBaseUrl(e.target.value)} placeholder="http://127.0.0.1:7000" /></label>
                  <label>{dict.voiceAgentSettings.sttTranscribePath}<input value={sttTranscribePath} onChange={(e) => setSttTranscribePath(e.target.value)} placeholder="/v1/transcribe" /></label>
                  <label>{dict.voiceAgentSettings.sttModel}<input value={sttModel} onChange={(e) => setSttModel(e.target.value)} placeholder="whisper-large-v3" /></label>
                </div>
                <QueryParamsEditor
                  label={language === "tr" ? "Query Parametreleri" : "Query Parameters"}
                  params={sttQueryParams}
                  onChange={setSttQueryParams}
                />
                <label>
                  {language === "tr" ? "Yetkilendirme (Authorization)" : "Authorization"}
                  <input value={sttAuthHeader} onChange={(e) => setSttAuthHeader(e.target.value)} placeholder="Bearer sk-..." />
                </label>
                {/* ── STT record test ── */}
                <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: "1rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    {sttRecording ? (
                      <button className="ghost" type="button" style={{ color: "#ef4444" }} onClick={stopSttRecording}>
                        {language === "tr" ? "Durdur" : "Stop"}
                      </button>
                    ) : (
                      <button className="ghost" type="button" disabled={sttTranscribing || !sttBaseUrl.trim()} onClick={() => { void startSttRecording(); }}>
                        {sttTranscribing ? (language === "tr" ? "Çevriliyor…" : "Transcribing…") : (language === "tr" ? "Kaydet & Test Et" : "Record & Test")}
                      </button>
                    )}
                    {sttRecording && (
                      <span style={{ fontSize: "0.8em", color: "#ef4444", fontWeight: 600 }}>
                        {language === "tr" ? "Kayıt yapılıyor…" : "Recording…"}
                      </span>
                    )}
                  </div>
                  {sttTestError ? <p style={{ color: "#ef4444", margin: 0, fontSize: "0.85em" }}>{sttTestError}</p> : null}
                  {sttTranscript !== null ? (
                    <div style={{ background: "var(--color-surface, #f5f5f5)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "0.5rem 0.75rem", fontSize: "0.9em" }}>
                      <span style={{ fontSize: "0.75em", fontWeight: 600, color: "var(--color-secondary-text)", display: "block", marginBottom: "0.25rem" }}>
                        {language === "tr" ? "Transkripsiyon" : "Transcript"}
                      </span>
                      {sttTranscript}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* ── TTS tab ─────────────────────────────── */}
            {activeTab === "tts" ? (
              <div style={{ padding: "1.25rem 1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div className="checkbox-grid">
                  <label><input type="checkbox" checked={ttsEnabled} onChange={(e) => setTtsEnabled(e.target.checked)} />{dict.voiceAgentSettings.ttsEnabled}</label>
                </div>
                <div className="form-grid">
                  <label>{dict.voiceAgentSettings.ttsBaseUrl}<input value={ttsBaseUrl} onChange={(e) => setTtsBaseUrl(e.target.value)} placeholder="http://127.0.0.1:7100" /></label>
                  <label>{language === "tr" ? "Synth Path" : "Synth Path"}<input value={ttsSynthPath} onChange={(e) => setTtsSynthPath(e.target.value)} placeholder="/tts" /></label>
                </div>
                <QueryParamsEditor
                  label={language === "tr" ? "Query Parametreleri" : "Query Parameters"}
                  params={ttsQueryParams}
                  onChange={setTtsQueryParams}
                />
                <label>
                  {language === "tr" ? "Yetkilendirme (Authorization)" : "Authorization"}
                  <input value={ttsAuthHeader} onChange={(e) => setTtsAuthHeader(e.target.value)} placeholder="Bearer sk-..." />
                </label>
                {/* ── TTS test ── */}
                <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: "1rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                  <button className="ghost" type="button" disabled={ttsSynthesizing || !ttsBaseUrl.trim()} onClick={() => { void runTestTts(); }}>
                    {ttsSynthesizing ? "…" : dict.voiceAgentSettings.testTtsPlay}
                  </button>
                  {ttsSynthError ? <p style={{ color: "#ef4444", margin: 0 }}>{ttsSynthError}</p> : null}
                  {ttsAudioUrl
                    ? <audio ref={ttsAudioRef} controls src={ttsAudioUrl} style={{ width: "100%", height: 32 }} />
                    : <audio ref={ttsAudioRef} style={{ display: "none" }} />}
                </div>
              </div>
            ) : null}

            {/* ── LLM tab ─────────────────────────────── */}
            {activeTab === "llm" ? (
              <div style={{ padding: "1.25rem 1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div className="form-grid">
                  <label style={{ gridColumn: "1 / -1" }}>
                    {dict.voiceAgentSettings.ollamaBaseUrl}
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <input style={{ flex: 1 }} value={ollamaBaseUrl} onChange={(e) => setOllamaBaseUrl(e.target.value)} placeholder="http://127.0.0.1:11434" />
                      <button className="ghost" type="button" style={{ flexShrink: 0 }} disabled={ollamaModelsFetching || !ollamaBaseUrl.trim()} onClick={() => { void fetchOllamaModels(); }}>
                        {ollamaModelsFetching ? "…" : (language === "tr" ? "Modelleri Getir" : "Fetch Models")}
                      </button>
                    </div>
                  </label>
                  <label style={{ gridColumn: "1 / -1" }}>
                    {dict.voiceAgentSettings.ollamaModel}
                    {ollamaModels.length > 0 ? (
                      <select value={ollamaModel} onChange={(e) => setOllamaModel(e.target.value)}>
                        {ollamaModels.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    ) : (
                      <input value={ollamaModel} onChange={(e) => setOllamaModel(e.target.value)} placeholder="llama3.1:8b" />
                    )}
                  </label>
                </div>
                {ollamaModelsError ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <p style={{ fontSize: "0.82em", color: "#ef4444", margin: 0 }}>{ollamaModelsError}</p>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <input
                        style={{ flex: 1, fontSize: "0.82em", padding: "4px 8px" }}
                        value={ollamaModelsPath}
                        onChange={(e) => setOllamaModelsPath(e.target.value)}
                        placeholder="/api/tags"
                      />
                      <button className="ghost" type="button" style={{ fontSize: "0.82em", flexShrink: 0 }} disabled={ollamaModelsFetching} onClick={() => { void fetchOllamaModels(ollamaModelsPath); }}>
                        {language === "tr" ? "Tekrar Dene" : "Retry"}
                      </button>
                    </div>
                  </div>
                ) : null}
                <label>
                  {language === "tr" ? "Yetkilendirme (Authorization)" : "Authorization"}
                  <input value={llmAuthHeader} onChange={(e) => setLlmAuthHeader(e.target.value)} placeholder="Bearer sk-..." />
                </label>
              </div>
            ) : null}

            {/* ── N8N tab ─────────────────────────────── */}
            {activeTab === "n8n" ? (
              <div style={{ padding: "1.25rem 1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div className="form-grid">
                  <label>{dict.voiceAgentSettings.n8nBaseUrl}<input value={n8nBaseUrl} onChange={(e) => setN8nBaseUrl(e.target.value)} placeholder="http://127.0.0.1:5678" /></label>
                </div>
              </div>
            ) : null}

            {/* ── Behaviour tab ───────────────────────── */}
            {activeTab === "behaviour" ? (
              <div style={{ padding: "1.25rem 1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div className="checkbox-grid">
                  <label><input type="checkbox" checked={greetingEnabled} onChange={(e) => setGreetingEnabled(e.target.checked)} />{dict.voiceAgentSettings.greetingEnabled}</label>
                </div>
                <div className="form-grid">
                  <label style={{ gridColumn: "1 / -1" }}>
                    {dict.voiceAgentSettings.greetingInstruction}
                    <textarea rows={2} value={greetingInstruction} onChange={(e) => setGreetingInstruction(e.target.value)} />
                  </label>
                  <label style={{ gridColumn: "1 / -1" }}>
                    {dict.voiceAgentSettings.systemPrompt}
                    <textarea rows={6} value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} />
                  </label>
                </div>
              </div>
            ) : null}

            {/* ── Footer: save (shown on all settings tabs) ── */}
            {activeTab !== "summary" ? (
              <div style={{ padding: "1rem 1.5rem", borderTop: "1px solid var(--color-border)", display: "flex", alignItems: "center", gap: "1rem" }}>
                <button className="primary" type="submit" disabled={saving}>{saving ? (language === "tr" ? "Kaydediliyor..." : "Saving...") : dict.actions.save}</button>
                {saveMsg ? <span style={{ fontSize: "0.85em", color: "#22c55e", fontWeight: 600 }}>{saveMsg}</span> : null}
              </div>
            ) : null}
          </form>
        )}
      </section>
    </div>
  );
}
