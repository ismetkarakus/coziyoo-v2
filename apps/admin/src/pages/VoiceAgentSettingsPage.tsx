import { useCallback, useEffect, useRef, useState } from "react";
import { request, parseJson } from "../lib/api";
import type { Language, ApiError } from "../types/core";
import type { AgentSettingsFull, SttServer, TtsServer, LlmServer, N8nServer, VoiceSettingsTab } from "../types/voice";

// ── Helpers ──────────────────────────────────────────────────────────────────

function readNestedStr(config: Record<string, unknown> | null, ...path: string[]): string {
  let cur: unknown = config;
  for (const key of path) {
    if (cur == null || typeof cur !== "object") return "";
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === "string" ? cur : "";
}

function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

function objToParams(obj: Record<string, string>): Array<{ key: string; value: string }> {
  return Object.entries(obj).map(([key, value]) => ({ key, value }));
}

function paramsToObj(params: Array<{ key: string; value: string }>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const p of params) {
    if (p.key.trim()) result[p.key.trim()] = p.value;
  }
  return result;
}

// ── cURL parser ───────────────────────────────────────────────────────────────

function tokenizeCurl(raw: string): string[] {
  // Normalize line continuations (\<newline>)
  const src = raw.replace(/\\\r?\n/g, " ");
  const tokens: string[] = [];
  let i = 0;
  while (i < src.length) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (i >= src.length) break;
    if (src[i] === '"') {
      i++;
      let t = "";
      while (i < src.length && src[i] !== '"') {
        if (src[i] === "\\" && i + 1 < src.length) { t += src[i + 1]; i += 2; }
        else t += src[i++];
      }
      i++;
      tokens.push(t);
    } else if (src[i] === "'") {
      i++;
      let t = "";
      while (i < src.length && src[i] !== "'") t += src[i++];
      i++;
      tokens.push(t);
    } else {
      let t = "";
      while (i < src.length && !/\s/.test(src[i])) t += src[i++];
      tokens.push(t);
    }
  }
  return tokens;
}

function parseCurlCommand(curlStr: string): Partial<ServerDraft> {
  const tokens = tokenizeCurl(curlStr);
  let url = "";
  const headers: Record<string, string> = {};
  const formFields: Array<{ key: string; value: string }> = [];
  let bodyRaw = "";

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === "curl" || tok === "-s" || tok === "-i" || tok === "-v" || tok === "-L" || tok === "--silent" || tok === "--compressed") continue;
    if (tok === "-X" || tok === "--request") { i++; continue; }
    if (tok === "-o" || tok === "--output" || tok === "--max-time" || tok === "--connect-timeout" || tok === "-m") { i++; continue; }
    if (tok === "-H" || tok === "--header") {
      const hdr = tokens[++i] ?? "";
      const colon = hdr.indexOf(":");
      if (colon > 0) {
        const k = hdr.slice(0, colon).trim().toLowerCase();
        const v = hdr.slice(colon + 1).trim();
        headers[k] = v;
      }
    } else if (tok === "-F" || tok === "--form") {
      const fv = tokens[++i] ?? "";
      const eq = fv.indexOf("=");
      if (eq > 0) {
        const k = fv.slice(0, eq).trim();
        const v = fv.slice(eq + 1).trim();
        if (!v.startsWith("@")) formFields.push({ key: k, value: v });
      }
    } else if (tok === "-d" || tok === "--data" || tok === "--data-raw" || tok === "--data-binary" || tok === "--data-urlencode") {
      bodyRaw = tokens[++i] ?? "";
    } else if (!tok.startsWith("-") && (tok.startsWith("http://") || tok.startsWith("https://"))) {
      url = tok;
    }
  }

  if (!url) return {};

  let parsed: URL;
  try { parsed = new URL(url); } catch { return {}; }

  const baseUrl = `${parsed.protocol}//${parsed.host}`;
  const path = parsed.pathname;

  // URL query params
  const queryParams: Array<{ key: string; value: string }> = [];
  parsed.searchParams.forEach((v, k) => queryParams.push({ key: k, value: v }));

  // Auth header
  const authHeader = headers["authorization"] ?? "";

  // Try to parse JSON body
  let bodyObj: Record<string, unknown> = {};
  if (bodyRaw) {
    try { bodyObj = JSON.parse(bodyRaw) as Record<string, unknown>; } catch { /* not JSON */ }
  }

  // Model: form > body > url param
  const model =
    (formFields.find(f => f.key === "model")?.value ?? "") ||
    (typeof bodyObj["model"] === "string" ? bodyObj["model"] : "") ||
    (parsed.searchParams.get("model") ?? "");

  // Merge form fields (skip model/file) into queryParams (for STT multipart forms)
  for (const { key, value } of formFields) {
    if (key !== "model" && key !== "file" && !queryParams.find(p => p.key === key)) {
      queryParams.push({ key, value });
    }
  }

  // Detect text field name (OpenAI-compatible servers use "input" instead of "text")
  let textFieldName = "text";
  if (typeof bodyObj["input"] === "string" && typeof bodyObj["text"] !== "string") {
    textFieldName = "input";
  }

  // Extract body params: all JSON body fields except the text field itself
  const bodyParams: Array<{ key: string; value: string }> = [];
  for (const [k, v] of Object.entries(bodyObj)) {
    if (k === "text" || k === "input") continue; // skip the dynamic text field
    bodyParams.push({ key: k, value: String(v) });
  }

  // Derive a name from hostname
  const name = parsed.hostname.split(".")[0]?.replace(/^(stt|tts|llm|n8n|api|www)-?/i, "") || "";

  return { name, baseUrl, transcribePath: path, synthPath: path, authHeader, model, textFieldName, bodyParams, queryParams };
}

// ── Server draft (unified form state for all server types) ────────────────────

type ServerDraft = {
  name: string;
  enabled: boolean;
  provider: string;
  baseUrl: string;
  transcribePath: string;
  synthPath: string;
  /** Field name used to send speech text in the JSON body ("text" or "input" for OpenAI-compatible) */
  textFieldName: string;
  model: string;
  /** Path to fetch available models from (e.g. /api/tags for Ollama) */
  modelsPath: string;
  queryParams: Array<{ key: string; value: string }>;
  /** Extra key-value pairs merged into the JSON request body (model, voice, temperature, etc.) */
  bodyParams: Array<{ key: string; value: string }>;
  authHeader: string;
};

function emptyDraft(): ServerDraft {
  return { name: "", enabled: true, provider: "remote-speech-server", baseUrl: "", transcribePath: "/v1/audio/transcriptions", synthPath: "/tts", textFieldName: "text", model: "", modelsPath: "", queryParams: [], bodyParams: [], authHeader: "" };
}

function sttToDraft(s: SttServer): ServerDraft {
  return { name: s.name, enabled: s.enabled, provider: s.provider, baseUrl: s.baseUrl, transcribePath: s.transcribePath, synthPath: "", textFieldName: "text", model: s.model, modelsPath: "", queryParams: objToParams(s.queryParams), bodyParams: [], authHeader: s.authHeader };
}

function ttsToDraft(s: TtsServer): ServerDraft {
  return { name: s.name, enabled: s.enabled, provider: "", baseUrl: s.baseUrl, transcribePath: "", synthPath: s.synthPath, textFieldName: s.textFieldName || "text", model: "", modelsPath: "", queryParams: objToParams(s.queryParams), bodyParams: objToParams(s.bodyParams ?? {}), authHeader: s.authHeader };
}

function llmToDraft(s: LlmServer): ServerDraft {
  return { name: s.name, enabled: s.enabled, provider: "", baseUrl: s.baseUrl, transcribePath: "", synthPath: "", textFieldName: "text", model: s.model, modelsPath: s.modelsPath ?? "", queryParams: [], bodyParams: [], authHeader: s.authHeader };
}

function n8nToDraft(s: N8nServer): ServerDraft {
  return { name: s.name, enabled: s.enabled, provider: "", baseUrl: s.baseUrl, transcribePath: "", synthPath: "", textFieldName: "text", model: "", modelsPath: "", queryParams: [], bodyParams: [], authHeader: "" };
}

function draftToStt(id: string, d: ServerDraft): SttServer {
  return { id, name: d.name || "STT Server", enabled: d.enabled, provider: d.provider || "remote-speech-server", baseUrl: d.baseUrl, transcribePath: d.transcribePath || "/v1/audio/transcriptions", model: d.model, queryParams: paramsToObj(d.queryParams), authHeader: d.authHeader };
}

function draftToTts(id: string, d: ServerDraft): TtsServer {
  return { id, name: d.name || "TTS Server", enabled: d.enabled, baseUrl: d.baseUrl, synthPath: d.synthPath || "/tts", textFieldName: d.textFieldName || "text", bodyParams: paramsToObj(d.bodyParams), queryParams: paramsToObj(d.queryParams), authHeader: d.authHeader };
}

function draftToLlm(id: string, d: ServerDraft): LlmServer {
  return { id, name: d.name || "LLM Server", enabled: d.enabled, baseUrl: d.baseUrl, model: d.model, modelsPath: d.modelsPath || undefined, authHeader: d.authHeader };
}

function draftToN8n(id: string, d: ServerDraft): N8nServer {
  return { id, name: d.name || "N8N Server", enabled: d.enabled, baseUrl: d.baseUrl };
}

// ── QueryParamsEditor ─────────────────────────────────────────────────────────

function QueryParamsEditor({ label = "Query Params", hint, params, onChange }: { label?: string; hint?: string; params: Array<{ key: string; value: string }>; onChange: (p: Array<{ key: string; value: string }>) => void }) {
  const add = () => onChange([...params, { key: "", value: "" }]);
  const remove = (i: number) => onChange(params.filter((_, idx) => idx !== i));
  const update = (i: number, field: "key" | "value", val: string) => onChange(params.map((p, idx) => (idx === i ? { ...p, [field]: val } : p)));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: "0.82em", fontWeight: 600, color: "var(--color-secondary-text)" }}>{label}</span>
        <button className="ghost" type="button" style={{ fontSize: "0.78em", padding: "2px 10px" }} onClick={add}>+ Add</button>
      </div>
      {hint && <span style={{ fontSize: "0.76em", color: "var(--color-secondary-text)" }}>{hint}</span>}
      {params.map((p, i) => (
        <div key={i} style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
          <input style={{ flex: 1, fontSize: "0.82em", padding: "4px 8px" }} value={p.key} onChange={(e) => update(i, "key", e.target.value)} />
          <input style={{ flex: 2, fontSize: "0.82em", padding: "4px 8px" }} value={p.value} onChange={(e) => update(i, "value", e.target.value)} />
          <button className="ghost" type="button" style={{ fontSize: "0.78em", padding: "2px 8px", color: "#ef4444" }} onClick={() => remove(i)}>✕</button>
        </div>
      ))}
    </div>
  );
}

// ── ServerInlineForm ──────────────────────────────────────────────────────────

function ServerInlineForm({ type, draft, onChange, onSave, onCancel, isSaving }: {
  type: "stt" | "tts" | "llm" | "n8n";
  draft: ServerDraft;
  onChange: (d: ServerDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const set = (field: keyof ServerDraft, val: unknown) => onChange({ ...draft, [field]: val } as ServerDraft);
  const inp = { width: "100%", fontSize: "0.88em", padding: "5px 10px", boxSizing: "border-box" as const };
  const lbl = { fontSize: "0.8em", fontWeight: 600, color: "var(--color-secondary-text)", marginBottom: "3px", display: "block" } as const;

  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [modelsFetching, setModelsFetching] = useState(false);
  const [modelsFetchError, setModelsFetchError] = useState<string | null>(null);

  const fetchModels = async () => {
    if (!draft.baseUrl) return;
    setModelsFetching(true);
    setModelsFetchError(null);
    try {
      const res = await request("/v1/admin/livekit/test/ollama", {
        method: "POST",
        body: JSON.stringify({ baseUrl: draft.baseUrl, modelsPath: draft.modelsPath || undefined }),
      });
      const json = await parseJson<{ data?: { ok?: boolean; models?: string[] }; error?: { message?: string } }>(res);
      if (json.data?.ok && Array.isArray(json.data.models)) {
        setFetchedModels(json.data.models);
        if (json.data.models.length > 0 && !draft.model) {
          set("model", json.data.models[0]);
        }
      } else {
        setModelsFetchError(json.error?.message ?? "Could not fetch models");
      }
    } catch {
      setModelsFetchError("Request failed");
    } finally {
      setModelsFetching(false);
    }
  };

  const field = (label: string, node: React.ReactNode) => (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      <label style={lbl}>{label}</label>
      {node}
    </div>
  );

  return (
    <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "8px", padding: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.5rem" }}>
      {field("Name", <input style={inp} value={draft.name} onChange={(e) => set("name", e.target.value)} />)}
      <label style={{ fontSize: "0.88em", display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
        <input type="checkbox" checked={draft.enabled} onChange={(e) => set("enabled", e.target.checked)} />
        Enabled
      </label>
      {type === "stt" && field("Provider", <input style={inp} value={draft.provider} onChange={(e) => set("provider", e.target.value)} />)}
      {field("Base URL", <input style={inp} value={draft.baseUrl} onChange={(e) => set("baseUrl", e.target.value)} />)}
      {type === "stt" && field("Transcribe Path", <input style={inp} value={draft.transcribePath} onChange={(e) => set("transcribePath", e.target.value)} />)}
      {type === "tts" && field("Synth Path", <input style={inp} value={draft.synthPath} onChange={(e) => set("synthPath", e.target.value)} />)}
      {type === "tts" && field(
        "Text Field Name",
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <input style={inp} value={draft.textFieldName} onChange={(e) => set("textFieldName", e.target.value)} />
          <span style={{ fontSize: "0.76em", color: "var(--color-secondary-text)" }}>Field that carries the speech text in the body. Use <code>text</code> (default) or <code>input</code> for OpenAI-compatible servers.</span>
        </div>
      )}
      {type === "stt" && field("Model", <input style={inp} value={draft.model} onChange={(e) => set("model", e.target.value)} />)}
      {type === "llm" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <label style={lbl}>Model</label>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              {fetchedModels.length > 0 ? (
                <select style={{ ...inp, flex: 1 }} value={draft.model} onChange={(e) => set("model", e.target.value)}>
                  {fetchedModels.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              ) : (
                <input style={{ ...inp, flex: 1 }} value={draft.model} onChange={(e) => set("model", e.target.value)} />
              )}
              <button className="ghost" type="button" style={{ fontSize: "0.82em", padding: "4px 12px", flexShrink: 0 }} onClick={fetchModels} disabled={!draft.baseUrl || modelsFetching}>
                {modelsFetching ? "…" : fetchedModels.length > 0 ? "↻ Refresh" : "Fetch Models"}
              </button>
            </div>
            {modelsFetchError && <span style={{ fontSize: "0.78em", color: "#ef4444", marginTop: "2px" }}>{modelsFetchError}</span>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <label style={{ ...lbl, fontWeight: 400 }}>Models endpoint <span style={{ opacity: 0.6 }}>(optional)</span></label>
            <input style={{ ...inp, fontSize: "0.82em" }} value={draft.modelsPath} onChange={(e) => set("modelsPath", e.target.value)} />
          </div>
        </div>
      )}
      {type === "stt" && <QueryParamsEditor label="Query Params" params={draft.queryParams} onChange={(p) => set("queryParams", p)} />}
      {type === "tts" && field("Auth Header", <input style={inp} value={draft.authHeader} onChange={(e) => set("authHeader", e.target.value)} />)}
      {type === "tts" && (
        <>
          <div style={{ border: "1px solid var(--color-border)", borderRadius: "6px", padding: "0.75rem" }}>
            <QueryParamsEditor label="Body Params" params={draft.bodyParams} onChange={(p) => set("bodyParams", p)} hint="Static fields merged into the JSON body (e.g. model, voice, temperature). Values that look like numbers or booleans are coerced automatically." />
          </div>
          <div style={{ border: "1px solid var(--color-border)", borderRadius: "6px", padding: "0.75rem" }}>
            <QueryParamsEditor label="URL Query Params" params={draft.queryParams} onChange={(p) => set("queryParams", p)} />
          </div>
        </>
      )}
      {(type === "stt" || type === "llm") && field("Auth Header", <input style={inp} value={draft.authHeader} onChange={(e) => set("authHeader", e.target.value)} />)}
      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", borderTop: "1px solid var(--color-border)", paddingTop: "0.75rem" }}>
        <button className="ghost" type="button" onClick={onCancel}>Cancel</button>
        <button className="primary" type="button" onClick={onSave} disabled={isSaving}>{isSaving ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}

// ── CurlImportModal ───────────────────────────────────────────────────────────

function CurlImportModal({ type, onImport, onClose }: {
  type: "stt" | "tts";
  onImport: (draft: Partial<ServerDraft>) => void;
  onClose: () => void;
}) {
  const [curlInput, setCurlInput] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  const handleImport = () => {
    setParseError(null);
    if (!curlInput.trim()) { setParseError("Paste a cURL command first."); return; }
    const result = parseCurlCommand(curlInput);
    if (!result.baseUrl) { setParseError("Could not extract a URL from the cURL command. Make sure it starts with http:// or https://."); return; }
    onImport(result);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }} onClick={onClose}>
      <div style={{ background: "var(--color-bg, #fff)", borderRadius: "10px", padding: "1.5rem", width: "100%", maxWidth: 560, display: "flex", flexDirection: "column", gap: "1rem", boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0, fontSize: "1em", fontWeight: 700 }}>Add {type.toUpperCase()} Server from cURL</h3>
          <button className="ghost" type="button" style={{ padding: "2px 8px", fontSize: "1.1em" }} onClick={onClose}>✕</button>
        </div>
        <p style={{ margin: 0, fontSize: "0.85em", color: "var(--color-secondary-text)" }}>
          Paste a cURL command below. The URL, auth header, path, model, and query params will be extracted and pre-filled in the form.
        </p>
        <textarea
          value={curlInput}
          onChange={e => { setCurlInput(e.target.value); setParseError(null); }}
          rows={8}
          style={{ fontFamily: "monospace", fontSize: "0.82em", padding: "10px", resize: "vertical", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "6px" }}
          autoFocus
        />
        {parseError && <div style={{ color: "#ef4444", fontSize: "0.85em" }}>{parseError}</div>}
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button className="ghost" type="button" onClick={onClose}>Cancel</button>
          <button className="primary" type="button" onClick={handleImport}>Parse &amp; Fill Form</button>
        </div>
      </div>
    </div>
  );
}

// ── SttRecordPanel ────────────────────────────────────────────────────────────

function SttRecordPanel({ server, recording, transcribing, transcript, error, debugInfo, onStart, onStop }: {
  server: SttServer;
  recording: boolean;
  transcribing: boolean;
  transcript: string | null;
  error: string | null;
  debugInfo: string | null;
  onStart: () => void;
  onStop: () => void;
}) {
  return (
    <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "8px", padding: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: "0.88em", fontWeight: 600 }}>STT Test — {server.name}</span>
        <span style={{ fontSize: "0.78em", color: "var(--color-secondary-text)" }}>{server.baseUrl}{server.transcribePath}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        {recording ? (
          <button className="ghost" type="button" style={{ color: "#ef4444", fontWeight: 600 }} onClick={onStop}>
            ⏹ Stop Recording
          </button>
        ) : (
          <button className="primary" type="button" onClick={onStart} disabled={transcribing}>
            {transcribing ? "Transcribing…" : "🎤 Record & Transcribe"}
          </button>
        )}
        {recording && (
          <span style={{ fontSize: "0.85em", color: "#ef4444", display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", display: "inline-block", animation: "pulse 1s infinite" }} />
            Recording…
          </span>
        )}
      </div>
      {transcript !== null && (
        <div style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: "6px", padding: "0.75rem" }}>
          <div style={{ fontSize: "0.78em", fontWeight: 600, color: "var(--color-secondary-text)", marginBottom: "4px" }}>TRANSCRIPT</div>
          <div style={{ fontSize: "0.92em" }}>{transcript || <em style={{ opacity: 0.5 }}>empty</em>}</div>
        </div>
      )}
      {error && <div style={{ color: "#ef4444", fontSize: "0.85em" }}>{error}</div>}
      {debugInfo && (
        <details style={{ fontSize: "0.78em" }}>
          <summary style={{ cursor: "pointer", color: "var(--color-secondary-text)", userSelect: "none" }}>Request debug</summary>
          <pre style={{ marginTop: "0.5rem", background: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: "4px", padding: "0.5rem", overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{debugInfo}</pre>
        </details>
      )}
    </div>
  );
}

// ── StatusDot ─────────────────────────────────────────────────────────────────

type TestStatus = { ok: boolean; detail?: string } | null;

function StatusDot({ status, label }: { status: TestStatus; label: string }) {
  const color = status === null ? "var(--color-secondary-text)" : status.ok ? "#22c55e" : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 0" }}>
      <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, display: "inline-block", flexShrink: 0 }} />
      <span style={{ fontSize: "0.88em" }}>{label}</span>
      {status && !status.ok && status.detail && (
        <span style={{ fontSize: "0.78em", color: "#ef4444", marginLeft: "4px" }}>{status.detail.slice(0, 100)}</span>
      )}
    </div>
  );
}

// ── Legacy migration ──────────────────────────────────────────────────────────

function migrateLegacy(cfg: Record<string, unknown>, ollamaModel: string) {
  let sttList: SttServer[] = Array.isArray(cfg.sttServers) ? (cfg.sttServers as SttServer[]) : [];
  let defaultSttId = typeof cfg.defaultSttServerId === "string" ? cfg.defaultSttServerId : "";
  if (sttList.length === 0) {
    const legacyUrl = readNestedStr(cfg, "stt", "baseUrl");
    if (legacyUrl) {
      const id = newId();
      sttList = [{ id, name: "Default", enabled: true, provider: readNestedStr(cfg, "stt", "provider") || "remote-speech-server", baseUrl: legacyUrl, transcribePath: readNestedStr(cfg, "stt", "transcribePath") || "/v1/audio/transcriptions", model: readNestedStr(cfg, "stt", "model"), queryParams: ((cfg.stt as Record<string, unknown>)?.queryParams ?? {}) as Record<string, string>, authHeader: readNestedStr(cfg, "stt", "authHeader") }];
      defaultSttId = id;
    }
  }

  let ttsList: TtsServer[] = Array.isArray(cfg.ttsServers) ? (cfg.ttsServers as TtsServer[]) : [];
  let defaultTtsId = typeof cfg.defaultTtsServerId === "string" ? cfg.defaultTtsServerId : "";
  if (ttsList.length === 0) {
    const legacyUrl = readNestedStr(cfg, "baseUrl");
    if (legacyUrl) {
      const id = newId();
      ttsList = [{ id, name: "Default", enabled: true, baseUrl: legacyUrl, synthPath: readNestedStr(cfg, "path") || "/tts", textFieldName: "text", bodyParams: {}, queryParams: (cfg.queryParams as Record<string, string>) ?? {}, authHeader: readNestedStr(cfg, "authHeader") }];
      defaultTtsId = id;
    }
  }

  let llmList: LlmServer[] = Array.isArray(cfg.llmServers) ? (cfg.llmServers as LlmServer[]) : [];
  let defaultLlmId = typeof cfg.defaultLlmServerId === "string" ? cfg.defaultLlmServerId : "";
  if (llmList.length === 0) {
    const legacyUrl = readNestedStr(cfg, "llm", "ollamaBaseUrl");
    if (legacyUrl) {
      const id = newId();
      llmList = [{ id, name: "Default", enabled: true, baseUrl: legacyUrl, model: ollamaModel, authHeader: readNestedStr(cfg, "llm", "authHeader") }];
      defaultLlmId = id;
    }
  }

  let n8nList: N8nServer[] = Array.isArray(cfg.n8nServers) ? (cfg.n8nServers as N8nServer[]) : [];
  let defaultN8nId = typeof cfg.defaultN8nServerId === "string" ? cfg.defaultN8nServerId : "";
  if (n8nList.length === 0) {
    const legacyUrl = readNestedStr(cfg, "n8n", "baseUrl");
    if (legacyUrl) {
      const id = newId();
      n8nList = [{ id, name: "Default", enabled: true, baseUrl: legacyUrl }];
      defaultN8nId = id;
    }
  }

  return { sttList, defaultSttId, ttsList, defaultTtsId, llmList, defaultLlmId, n8nList, defaultN8nId };
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function VoiceAgentSettingsPage({ language: _language }: { language: Language }) {
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<VoiceSettingsTab>("summary");

  // Server lists
  const [sttServers, setSttServers] = useState<SttServer[]>([]);
  const [defaultSttServerId, setDefaultSttServerId] = useState("");
  const [ttsServers, setTtsServers] = useState<TtsServer[]>([]);
  const [defaultTtsServerId, setDefaultTtsServerId] = useState("");
  const [llmServers, setLlmServers] = useState<LlmServer[]>([]);
  const [defaultLlmServerId, setDefaultLlmServerId] = useState("");
  const [n8nServers, setN8nServers] = useState<N8nServer[]>([]);
  const [defaultN8nServerId, setDefaultN8nServerId] = useState("");

  // General settings
  const [agentName, setAgentName] = useState("");
  const [voiceLanguage, setVoiceLanguage] = useState("en");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [greetingEnabled, setGreetingEnabled] = useState(true);
  const [greetingInstruction, setGreetingInstruction] = useState("");

  // cURL import modal state
  const [curlModalType, setCurlModalType] = useState<"stt" | "tts" | null>(null);

  // Inline edit state
  type EditTarget = { type: "stt" | "tts" | "llm" | "n8n"; id: string | null };
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [serverDraft, setServerDraft] = useState<ServerDraft>(emptyDraft());
  const [serverSaving, setServerSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // General save state
  const [generalSaving, setGeneralSaving] = useState(false);
  const [generalMsg, setGeneralMsg] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Connection test state
  const [testLiveKit, setTestLiveKit] = useState<TestStatus>(null);
  const [testStt, setTestStt] = useState<TestStatus>(null);
  const [testOllama, setTestOllama] = useState<TestStatus>(null);
  const [testN8n, setTestN8n] = useState<TestStatus>(null);
  const [testTts, setTestTts] = useState<TestStatus>(null);
  const [testing, setTesting] = useState(false);

  // TTS audio test
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const [ttsTestBusy, setTtsTestBusy] = useState(false);
  const [ttsTestError, setTtsTestError] = useState<string | null>(null);

  // STT record test
  const sttMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const sttChunksRef = useRef<Blob[]>([]);
  const [sttTestingServerId, setSttTestingServerId] = useState<string | null>(null);
  const [sttRecording, setSttRecording] = useState(false);
  const [sttTranscribing, setSttTranscribing] = useState(false);
  const [sttTranscript, setSttTranscript] = useState<string | null>(null);
  const [sttTestError, setSttTestError] = useState<string | null>(null);
  const [sttDebugInfo, setSttDebugInfo] = useState<string | null>(null);

  // ── Load ────────────────────────────────────────────────────────────────────

  const loadSettings = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await request("/v1/admin/livekit/agent-settings/default");
      if (res.status === 404) {
        await request("/v1/admin/livekit/agent-settings/default", { method: "PUT", body: JSON.stringify({ agentName: "coziyoo-agent", voiceLanguage: "en" }) });
        return;
      }
      const json = await parseJson<ApiError & { data?: AgentSettingsFull }>(res);
      if (json.error) {
        setLoadError(json.error.message ?? "Load failed");
        return;
      }
      const data = json.data as AgentSettingsFull;
      const cfg = (data.ttsConfig ?? {}) as Record<string, unknown>;

      setAgentName(data.agentName ?? "");
      setVoiceLanguage(data.voiceLanguage ?? "en");
      setSystemPrompt(data.systemPrompt ?? "");
      setGreetingEnabled(data.greetingEnabled ?? true);
      setGreetingInstruction(data.greetingInstruction ?? "");

      const { sttList, defaultSttId, ttsList, defaultTtsId, llmList, defaultLlmId, n8nList, defaultN8nId } = migrateLegacy(cfg, data.ollamaModel ?? "");

      setSttServers(sttList);
      setDefaultSttServerId(defaultSttId);
      setTtsServers(ttsList);
      setDefaultTtsServerId(defaultTtsId);
      setLlmServers(llmList);
      setDefaultLlmServerId(defaultLlmId);
      setN8nServers(n8nList);
      setDefaultN8nServerId(defaultN8nId);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Load failed");
    }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  // ── Save servers (called after every server list mutation) ──────────────────

  const saveServers = useCallback(async (opts: {
    sttServers?: SttServer[]; defaultSttServerId?: string;
    ttsServers?: TtsServer[]; defaultTtsServerId?: string;
    llmServers?: LlmServer[]; defaultLlmServerId?: string;
    n8nServers?: N8nServer[]; defaultN8nServerId?: string;
  }) => {
    const _stt = opts.sttServers ?? sttServers;
    const _dStt = opts.defaultSttServerId ?? defaultSttServerId;
    const _tts = opts.ttsServers ?? ttsServers;
    const _dTts = opts.defaultTtsServerId ?? defaultTtsServerId;
    const _llm = opts.llmServers ?? llmServers;
    const _dLlm = opts.defaultLlmServerId ?? defaultLlmServerId;
    const _n8n = opts.n8nServers ?? n8nServers;
    const _dN8n = opts.defaultN8nServerId ?? defaultN8nServerId;

    const defaultStt = _stt.find(s => s.id === _dStt);
    const defaultTts = _tts.find(s => s.id === _dTts);
    const defaultLlm = _llm.find(s => s.id === _dLlm);
    const defaultN8n = _n8n.find(s => s.id === _dN8n);

    const body: Record<string, unknown> = {
      sttServers: _stt, defaultSttServerId: _dStt,
      ttsServers: _tts, defaultTtsServerId: _dTts,
      llmServers: _llm, defaultLlmServerId: _dLlm,
      n8nServers: _n8n, defaultN8nServerId: _dN8n,
    };

    // Backward-compat: derive scalar fields from default servers
    if (defaultStt) { body.sttBaseUrl = defaultStt.baseUrl; body.sttProvider = defaultStt.provider; body.sttTranscribePath = defaultStt.transcribePath; body.sttModel = defaultStt.model; body.sttQueryParams = defaultStt.queryParams; body.sttAuthHeader = defaultStt.authHeader; }
    if (defaultTts) { body.ttsBaseUrl = defaultTts.baseUrl; body.ttsSynthPath = defaultTts.synthPath; body.ttsQueryParams = defaultTts.queryParams; body.ttsAuthHeader = defaultTts.authHeader; }
    if (defaultLlm) { body.ollamaBaseUrl = defaultLlm.baseUrl; body.ollamaModel = defaultLlm.model; body.llmAuthHeader = defaultLlm.authHeader; }
    if (defaultN8n) { body.n8nBaseUrl = defaultN8n.baseUrl; }

    const res = await request("/v1/admin/livekit/agent-settings/default", { method: "PUT", body: JSON.stringify(body) });
    const json = await parseJson<ApiError>(res);
    if (json.error) throw new Error(json.error.message ?? "Save failed");
  }, [sttServers, defaultSttServerId, ttsServers, defaultTtsServerId, llmServers, defaultLlmServerId, n8nServers, defaultN8nServerId]);

  // ── Server mutations ────────────────────────────────────────────────────────

  const handleAddServer = useCallback(async (type: "stt" | "tts" | "llm" | "n8n", draft: ServerDraft) => {
    const id = newId();
    setServerSaving(true);
    setServerError(null);
    try {
      if (type === "stt") {
        const server = draftToStt(id, draft);
        const newList = [...sttServers, server];
        const newDefault = defaultSttServerId || id;
        await saveServers({ sttServers: newList, defaultSttServerId: newDefault });
        setSttServers(newList);
        setDefaultSttServerId(newDefault);
      } else if (type === "tts") {
        const server = draftToTts(id, draft);
        const newList = [...ttsServers, server];
        const newDefault = defaultTtsServerId || id;
        await saveServers({ ttsServers: newList, defaultTtsServerId: newDefault });
        setTtsServers(newList);
        setDefaultTtsServerId(newDefault);
      } else if (type === "llm") {
        const server = draftToLlm(id, draft);
        const newList = [...llmServers, server];
        const newDefault = defaultLlmServerId || id;
        await saveServers({ llmServers: newList, defaultLlmServerId: newDefault });
        setLlmServers(newList);
        setDefaultLlmServerId(newDefault);
      } else {
        const server = draftToN8n(id, draft);
        const newList = [...n8nServers, server];
        const newDefault = defaultN8nServerId || id;
        await saveServers({ n8nServers: newList, defaultN8nServerId: newDefault });
        setN8nServers(newList);
        setDefaultN8nServerId(newDefault);
      }
      setEditing(null);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setServerSaving(false);
    }
  }, [sttServers, defaultSttServerId, ttsServers, defaultTtsServerId, llmServers, defaultLlmServerId, n8nServers, defaultN8nServerId, saveServers]);

  const handleEditServer = useCallback(async (type: "stt" | "tts" | "llm" | "n8n", id: string, draft: ServerDraft) => {
    setServerSaving(true);
    setServerError(null);
    try {
      if (type === "stt") {
        const newList = sttServers.map(s => s.id === id ? draftToStt(id, draft) : s);
        await saveServers({ sttServers: newList });
        setSttServers(newList);
      } else if (type === "tts") {
        const newList = ttsServers.map(s => s.id === id ? draftToTts(id, draft) : s);
        await saveServers({ ttsServers: newList });
        setTtsServers(newList);
      } else if (type === "llm") {
        const newList = llmServers.map(s => s.id === id ? draftToLlm(id, draft) : s);
        await saveServers({ llmServers: newList });
        setLlmServers(newList);
      } else {
        const newList = n8nServers.map(s => s.id === id ? draftToN8n(id, draft) : s);
        await saveServers({ n8nServers: newList });
        setN8nServers(newList);
      }
      setEditing(null);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setServerSaving(false);
    }
  }, [sttServers, ttsServers, llmServers, n8nServers, saveServers]);

  const handleDeleteServer = useCallback(async (type: "stt" | "tts" | "llm" | "n8n", id: string) => {
    setServerError(null);
    try {
      if (type === "stt") {
        const newList = sttServers.filter(s => s.id !== id);
        const newDefault = defaultSttServerId === id ? (newList[0]?.id ?? "") : defaultSttServerId;
        await saveServers({ sttServers: newList, defaultSttServerId: newDefault });
        setSttServers(newList);
        setDefaultSttServerId(newDefault);
      } else if (type === "tts") {
        const newList = ttsServers.filter(s => s.id !== id);
        const newDefault = defaultTtsServerId === id ? (newList[0]?.id ?? "") : defaultTtsServerId;
        await saveServers({ ttsServers: newList, defaultTtsServerId: newDefault });
        setTtsServers(newList);
        setDefaultTtsServerId(newDefault);
      } else if (type === "llm") {
        const newList = llmServers.filter(s => s.id !== id);
        const newDefault = defaultLlmServerId === id ? (newList[0]?.id ?? "") : defaultLlmServerId;
        await saveServers({ llmServers: newList, defaultLlmServerId: newDefault });
        setLlmServers(newList);
        setDefaultLlmServerId(newDefault);
      } else {
        const newList = n8nServers.filter(s => s.id !== id);
        const newDefault = defaultN8nServerId === id ? (newList[0]?.id ?? "") : defaultN8nServerId;
        await saveServers({ n8nServers: newList, defaultN8nServerId: newDefault });
        setN8nServers(newList);
        setDefaultN8nServerId(newDefault);
      }
      if (editing?.id === id) setEditing(null);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Delete failed");
    }
  }, [sttServers, defaultSttServerId, ttsServers, defaultTtsServerId, llmServers, defaultLlmServerId, n8nServers, defaultN8nServerId, saveServers, editing]);

  const handleSetDefault = useCallback(async (type: "stt" | "tts" | "llm" | "n8n", id: string) => {
    setServerError(null);
    try {
      if (type === "stt") { await saveServers({ defaultSttServerId: id }); setDefaultSttServerId(id); }
      else if (type === "tts") { await saveServers({ defaultTtsServerId: id }); setDefaultTtsServerId(id); }
      else if (type === "llm") { await saveServers({ defaultLlmServerId: id }); setDefaultLlmServerId(id); }
      else { await saveServers({ defaultN8nServerId: id }); setDefaultN8nServerId(id); }
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Save failed");
    }
  }, [saveServers]);

  // ── General save ─────────────────────────────────────────────────────────────

  const handleSaveGeneral = async () => {
    setGeneralSaving(true);
    setGeneralMsg(null);
    setGeneralError(null);
    try {
      const res = await request("/v1/admin/livekit/agent-settings/default", { method: "PUT", body: JSON.stringify({ agentName, voiceLanguage, systemPrompt, greetingEnabled, greetingInstruction }) });
      const json = await parseJson<ApiError>(res);
      if (json.error) throw new Error(json.error.message ?? "Save failed");
      setGeneralMsg("Saved");
      setTimeout(() => setGeneralMsg(null), 3000);
    } catch (err) {
      setGeneralError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setGeneralSaving(false);
    }
  };

  // ── Connection tests ──────────────────────────────────────────────────────────

  type TestResponse = { data?: { ok?: boolean; reason?: string } };

  const runTestLiveKit = async () => {
    setTestLiveKit(null);
    try {
      const res = await request("/v1/admin/livekit/test/livekit", { method: "POST" });
      const json = await parseJson<TestResponse>(res);
      setTestLiveKit({ ok: json.data?.ok === true, detail: json.data?.reason });
    } catch { setTestLiveKit({ ok: false, detail: "Request failed" }); }
  };

  const runTestSttHealth = async () => {
    const srv = sttServers.find(s => s.id === defaultSttServerId);
    if (!srv) { setTestStt({ ok: false, detail: "No default STT server" }); return; }
    setTestStt(null);
    try {
      const res = await request("/v1/admin/livekit/test/stt", { method: "POST", body: JSON.stringify({ baseUrl: srv.baseUrl, transcribePath: srv.transcribePath }) });
      const json = await parseJson<TestResponse>(res);
      setTestStt({ ok: json.data?.ok === true, detail: json.data?.reason });
    } catch { setTestStt({ ok: false, detail: "Request failed" }); }
  };

  const runTestTtsHealth = async () => {
    const srv = ttsServers.find(s => s.id === defaultTtsServerId);
    if (!srv) { setTestTts({ ok: false, detail: "No default TTS server" }); return; }
    setTestTts(null);
    try {
      const res = await request("/v1/admin/livekit/test/tts", { method: "POST", body: JSON.stringify({ text: "test", baseUrl: srv.baseUrl, synthPath: srv.synthPath, textFieldName: srv.textFieldName || "text", bodyParams: srv.bodyParams ?? {}, queryParams: srv.queryParams, authHeader: srv.authHeader }) });
      setTestTts({ ok: res.ok, detail: res.ok ? undefined : `HTTP ${res.status}` });
    } catch { setTestTts({ ok: false, detail: "Request failed" }); }
  };

  const runTestOllama = async () => {
    const srv = llmServers.find(s => s.id === defaultLlmServerId);
    setTestOllama(null);
    try {
      const res = await request("/v1/admin/livekit/test/ollama", { method: "POST", body: JSON.stringify({ baseUrl: srv?.baseUrl }) });
      const json = await parseJson<TestResponse>(res);
      setTestOllama({ ok: json.data?.ok === true, detail: json.data?.reason });
    } catch { setTestOllama({ ok: false, detail: "Request failed" }); }
  };

  const runTestN8n = async () => {
    const srv = n8nServers.find(s => s.id === defaultN8nServerId);
    setTestN8n(null);
    try {
      const res = await request("/v1/admin/livekit/test/n8n", { method: "POST", body: JSON.stringify({ baseUrl: srv?.baseUrl }) });
      const json = await parseJson<TestResponse>(res);
      setTestN8n({ ok: json.data?.ok === true, detail: json.data?.reason });
    } catch { setTestN8n({ ok: false, detail: "Request failed" }); }
  };

  const handleTestAll = async () => {
    setTesting(true);
    await Promise.all([runTestLiveKit(), runTestSttHealth(), runTestTtsHealth(), runTestOllama(), runTestN8n()]);
    setTesting(false);
  };

  // ── TTS audio play test ───────────────────────────────────────────────────────

  const handleTtsPlay = async (server: TtsServer) => {
    setTtsTestBusy(true);
    setTtsTestError(null);
    try {
      const res = await request("/v1/admin/livekit/test/tts", { method: "POST", body: JSON.stringify({ text: "Merhaba, nasıl yardımcı olabilirim?", baseUrl: server.baseUrl, synthPath: server.synthPath, textFieldName: server.textFieldName || "text", bodyParams: server.bodyParams ?? {}, queryParams: server.queryParams, authHeader: server.authHeader }) });
      if (!res.ok) {
        const json = await parseJson<ApiError>(res);
        throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (ttsAudioRef.current) { ttsAudioRef.current.pause(); URL.revokeObjectURL(ttsAudioRef.current.src); }
      const audio = new Audio(url);
      ttsAudioRef.current = audio;
      await audio.play();
    } catch (err) {
      setTtsTestError(err instanceof Error ? err.message : "TTS test failed");
    } finally {
      setTtsTestBusy(false);
    }
  };

  // ── STT record & transcribe ────────────────────────────────────────────────

  const startSttRecording = async (server: SttServer) => {
    setSttTranscript(null);
    setSttTestError(null);
    setSttDebugInfo(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      sttChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) sttChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void sendSttRecording(server);
      };
      recorder.start();
      sttMediaRecorderRef.current = recorder;
      setSttRecording(true);
    } catch (err) {
      setSttTestError(err instanceof Error ? err.message : "Microphone access denied");
    }
  };

  const stopSttRecording = () => {
    const recorder = sttMediaRecorderRef.current;
    if (!recorder) return;
    recorder.requestData();
    recorder.stop();
    sttMediaRecorderRef.current = null;
    setSttRecording(false);
  };

  const sendSttRecording = async (server: SttServer) => {
    const fullUrl = `${server.baseUrl.replace(/\/$/, "")}${server.transcribePath}`;
    setSttTranscribing(true);
    setSttTestError(null);
    setSttDebugInfo(null);
    try {
      const mimeType = sttChunksRef.current[0]?.type || "audio/webm";
      const blob = new Blob(sttChunksRef.current, { type: mimeType });
      if (blob.size === 0) { setSttTestError("Recording is empty — try again"); setSttTranscribing(false); return; }

      const form = new FormData();
      form.append("file", blob, "recording.webm");
      if (server.model.trim()) form.append("model", server.model.trim());
      const extraLines: string[] = [];
      for (const [key, value] of Object.entries(server.queryParams)) {
        if (key.trim()) { form.append(key.trim(), value); extraLines.push(`${key}=${value}`); }
      }

      const headers: Record<string, string> = {};
      if (server.authHeader.trim()) {
        const raw = server.authHeader.trim();
        headers["Authorization"] = /\s/.test(raw) ? raw : `Bearer ${raw}`;
      }

      const debugLines = [
        `POST ${fullUrl}`,
        `file: recording.webm  type=${mimeType}  size=${blob.size} bytes`,
        server.model.trim() ? `model: ${server.model}` : null,
        ...extraLines,
        server.authHeader.trim() ? `Authorization: ${headers["Authorization"]?.slice(0, 20)}…` : null,
      ].filter(Boolean).join("\n");
      setSttDebugInfo(debugLines);

      const res = await fetch(fullUrl, { method: "POST", headers, body: form });
      const text = await res.text();
      setSttDebugInfo(`${debugLines}\n\n→ HTTP ${res.status}\n${text.slice(0, 400)}`);

      if (!res.ok) { setSttTestError(`HTTP ${res.status}: ${text.slice(0, 200)}`); return; }

      try {
        const json = JSON.parse(text) as Record<string, unknown>;
        setSttTranscript(String(json.text ?? json.transcript ?? json.transcription ?? text));
      } catch {
        setSttTranscript(text);
      }
    } catch (err) {
      setSttTestError(err instanceof Error ? err.message : "STT request failed");
    } finally {
      setSttTranscribing(false);
    }
  };

  // ── Server list tab renderer ───────────────────────────────────────────────

  function renderServerList(
    type: "stt" | "tts" | "llm" | "n8n",
    servers: Array<SttServer | TtsServer | LlmServer | N8nServer>,
    defaultId: string,
  ) {
    const isEditingType = editing?.type === type;
    const isAdding = isEditingType && editing?.id === null;

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0, fontSize: "1em", fontWeight: 700 }}>{type.toUpperCase()} Servers</h3>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {(type === "stt" || type === "tts") && (
              <button className="ghost" type="button" style={{ fontSize: "0.85em" }} onClick={() => setCurlModalType(type as "stt" | "tts")}>
                + From cURL
              </button>
            )}
            <button className="ghost" type="button" onClick={() => { setEditing({ type, id: null }); setServerDraft(emptyDraft()); setServerError(null); }}>+ Add</button>
          </div>
        </div>

        {isEditingType && serverError && <div style={{ color: "#ef4444", fontSize: "0.85em" }}>{serverError}</div>}

        {isAdding && (
          <ServerInlineForm type={type} draft={serverDraft} onChange={setServerDraft}
            onSave={() => handleAddServer(type, serverDraft)}
            onCancel={() => setEditing(null)}
            isSaving={serverSaving} />
        )}

        {servers.length === 0 && !isAdding && (
          <div style={{ color: "var(--color-secondary-text)", fontSize: "0.88em", padding: "1rem 0" }}>
            No servers configured. Click "+ Add" to add one.
          </div>
        )}

        {servers.map(server => {
          const isDefault = server.id === defaultId;
          const isThisEditing = editing?.type === type && editing?.id === server.id;
          const displayUrl = (server as { baseUrl?: string }).baseUrl ?? "";

          return (
            <div key={server.id}>
              <div style={{
                display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.75rem 1rem",
                background: "var(--color-surface)",
                border: `1px solid ${isDefault ? "var(--color-primary, #6366f1)" : "var(--color-border)"}`,
                borderRadius: "8px",
              }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", flexShrink: 0, background: isDefault ? "#22c55e" : "var(--color-border)" }} title={isDefault ? "Default" : "Not default"} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: "0.92em" }}>{server.name}</div>
                  {displayUrl && <div style={{ fontSize: "0.78em", color: "var(--color-secondary-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayUrl}</div>}
                </div>
                <div style={{ display: "flex", gap: "0.35rem", flexShrink: 0 }}>
                  {!isDefault && (
                    <button className="ghost" type="button" style={{ fontSize: "0.78em", padding: "3px 10px" }} onClick={() => handleSetDefault(type, server.id)}>
                      Set Default
                    </button>
                  )}
                  {type === "stt" && (
                    <button className="ghost" type="button" style={{ fontSize: "0.78em", padding: "3px 10px" }}
                      onClick={() => {
                        if (sttTestingServerId === server.id) { setSttTestingServerId(null); }
                        else { setSttTestingServerId(server.id); setSttTranscript(null); setSttTestError(null); setSttDebugInfo(null); }
                      }}>
                      {sttTestingServerId === server.id ? "Close Test" : "🎤 Test"}
                    </button>
                  )}
                  {type === "tts" && (
                    <button className="ghost" type="button" style={{ fontSize: "0.78em", padding: "3px 10px" }} onClick={() => handleTtsPlay(server as TtsServer)} disabled={ttsTestBusy}>
                      {ttsTestBusy ? "…" : "▶ Test"}
                    </button>
                  )}
                  <button className="ghost" type="button" style={{ fontSize: "0.78em", padding: "3px 10px" }}
                    onClick={() => {
                      if (isThisEditing) { setEditing(null); return; }
                      const draft = type === "stt" ? sttToDraft(server as SttServer)
                        : type === "tts" ? ttsToDraft(server as TtsServer)
                        : type === "llm" ? llmToDraft(server as LlmServer)
                        : n8nToDraft(server as N8nServer);
                      setEditing({ type, id: server.id });
                      setServerDraft(draft);
                      setServerError(null);
                    }}>
                    {isThisEditing ? "Close" : "Edit"}
                  </button>
                  <button className="ghost" type="button" style={{ fontSize: "0.78em", padding: "3px 10px", color: "#ef4444" }}
                    onClick={() => { if (confirm(`Delete "${server.name}"?`)) handleDeleteServer(type, server.id); }}>
                    Delete
                  </button>
                </div>
              </div>

              {isThisEditing && (
                <ServerInlineForm type={type} draft={serverDraft} onChange={setServerDraft}
                  onSave={() => handleEditServer(type, server.id, serverDraft)}
                  onCancel={() => setEditing(null)}
                  isSaving={serverSaving} />
              )}
              {type === "stt" && sttTestingServerId === server.id && !isThisEditing && (
                <SttRecordPanel
                  server={server as SttServer}
                  recording={sttRecording}
                  transcribing={sttTranscribing}
                  transcript={sttTranscript}
                  error={sttTestError}
                  debugInfo={sttDebugInfo}
                  onStart={() => startSttRecording(server as SttServer)}
                  onStop={stopSttRecording}
                />
              )}
            </div>
          );
        })}

        {type === "tts" && ttsTestError && <div style={{ color: "#ef4444", fontSize: "0.85em" }}>{ttsTestError}</div>}
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loadError) {
    return (
      <div style={{ padding: "2rem" }}>
        <div style={{ color: "#ef4444", marginBottom: "1rem" }}>{loadError}</div>
        <button className="ghost" type="button" onClick={loadSettings}>Retry</button>
      </div>
    );
  }

  const tabs: Array<{ key: VoiceSettingsTab; label: string }> = [
    { key: "summary", label: "Summary" },
    { key: "stt", label: "STT" },
    { key: "tts", label: "TTS" },
    { key: "llm", label: "LLM" },
    { key: "n8n", label: "N8N" },
    { key: "general", label: "General" },
  ];

  const handleCurlImport = (type: "stt" | "tts", parsed: Partial<ServerDraft>) => {
    const base = emptyDraft();
    const draft: ServerDraft = {
      ...base,
      name: parsed.name ?? base.name,
      baseUrl: parsed.baseUrl ?? base.baseUrl,
      transcribePath: type === "stt" ? (parsed.transcribePath ?? base.transcribePath) : base.transcribePath,
      synthPath: type === "tts" ? (parsed.synthPath ?? base.synthPath) : base.synthPath,
      textFieldName: type === "tts" ? (parsed.textFieldName ?? base.textFieldName) : base.textFieldName,
      model: parsed.model ?? base.model,
      queryParams: parsed.queryParams ?? base.queryParams,
      bodyParams: type === "tts" ? (parsed.bodyParams ?? base.bodyParams) : base.bodyParams,
      authHeader: parsed.authHeader ?? base.authHeader,
    };
    setCurlModalType(null);
    setEditing({ type, id: null });
    setServerDraft(draft);
    setServerError(null);
  };

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "1.5rem" }}>
      <h2 style={{ margin: "0 0 1.5rem", fontSize: "1.25rem", fontWeight: 700 }}>Voice Agent Settings</h2>

      {/* Tab Bar */}
      <div style={{ display: "flex", gap: "0.25rem", borderBottom: "1px solid var(--color-border)", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        {tabs.map(tab => (
          <button key={tab.key} type="button" className="ghost"
            onClick={() => { setActiveTab(tab.key); setEditing(null); setServerError(null); }}
            style={{
              padding: "0.5rem 1rem", fontSize: "0.88em",
              fontWeight: activeTab === tab.key ? 700 : 400,
              borderBottom: activeTab === tab.key ? "2px solid var(--color-primary, #6366f1)" : "2px solid transparent",
              borderRadius: 0,
              color: activeTab === tab.key ? "var(--color-primary, #6366f1)" : "inherit",
            }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Summary */}
      {activeTab === "summary" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          <h3 style={{ margin: "0 0 0.75rem", fontSize: "1em", fontWeight: 700 }}>Connection Status</h3>
          <StatusDot status={testLiveKit} label="LiveKit" />
          <StatusDot status={testStt} label={`STT — ${sttServers.find(s => s.id === defaultSttServerId)?.baseUrl ?? "no default"}`} />
          <StatusDot status={testTts} label={`TTS — ${ttsServers.find(s => s.id === defaultTtsServerId)?.baseUrl ?? "no default"}`} />
          <StatusDot status={testOllama} label={`LLM — ${llmServers.find(s => s.id === defaultLlmServerId)?.baseUrl ?? "no default"}`} />
          <StatusDot status={testN8n} label={`N8N — ${n8nServers.find(s => s.id === defaultN8nServerId)?.baseUrl ?? "no default"}`} />
          <div style={{ marginTop: "1rem" }}>
            <button className="primary" type="button" onClick={handleTestAll} disabled={testing}>
              {testing ? "Testing…" : "Test All"}
            </button>
          </div>
        </div>
      )}

      {activeTab === "stt" && renderServerList("stt", sttServers, defaultSttServerId)}
      {activeTab === "tts" && renderServerList("tts", ttsServers, defaultTtsServerId)}
      {activeTab === "llm" && renderServerList("llm", llmServers, defaultLlmServerId)}
      {activeTab === "n8n" && renderServerList("n8n", n8nServers, defaultN8nServerId)}

      {/* General */}
      {activeTab === "general" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            <label style={{ fontSize: "0.85em", fontWeight: 600 }}>Agent Name</label>
            <input value={agentName} onChange={e => setAgentName(e.target.value)} style={{ fontSize: "0.9em", padding: "6px 10px" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            <label style={{ fontSize: "0.85em", fontWeight: 600 }}>Voice Language</label>
            <select value={voiceLanguage} onChange={e => setVoiceLanguage(e.target.value)} style={{ fontSize: "0.9em", padding: "6px 10px" }}>
              <option value="tr">Turkish (tr)</option>
              <option value="en">English (en)</option>
              <option value="ar">Arabic (ar)</option>
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            <label style={{ fontSize: "0.85em", fontWeight: 600 }}>System Prompt</label>
            <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} rows={6} style={{ fontSize: "0.88em", padding: "8px 10px", resize: "vertical", fontFamily: "monospace" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <label style={{ fontSize: "0.85em", fontWeight: 600, display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
              <input type="checkbox" checked={greetingEnabled} onChange={e => setGreetingEnabled(e.target.checked)} />
              Greeting Enabled
            </label>
            {greetingEnabled && (
              <textarea value={greetingInstruction} onChange={e => setGreetingInstruction(e.target.value)} rows={3} style={{ fontSize: "0.88em", padding: "8px 10px", resize: "vertical" }} />
            )}
          </div>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <button className="primary" type="button" onClick={handleSaveGeneral} disabled={generalSaving}>
              {generalSaving ? "Saving…" : "Save"}
            </button>
            {generalMsg && <span style={{ color: "#22c55e", fontSize: "0.85em" }}>{generalMsg}</span>}
            {generalError && <span style={{ color: "#ef4444", fontSize: "0.85em" }}>{generalError}</span>}
          </div>
        </div>
      )}

      {curlModalType && (
        <CurlImportModal
          type={curlModalType}
          onImport={(parsed) => handleCurlImport(curlModalType, parsed)}
          onClose={() => setCurlModalType(null)}
        />
      )}
    </div>
  );
}
