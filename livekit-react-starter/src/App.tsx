import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Room, RoomEvent } from "livekit-client";

type Tokens = { accessToken: string; refreshToken: string };

type SessionStartResponse = {
  data?: {
    roomName: string;
    wsUrl: string;
    user: { participantIdentity: string; token: string };
    agent: {
      participantIdentity: string;
      dispatched: boolean;
      alreadyRunning?: boolean;
      dispatch: { endpoint: string; ok: boolean; status: number; body: unknown } | null;
    };
  };
  error?: { code?: string; message?: string };
};

type AgentChatResponse = {
  data?: {
    roomName: string;
    agentIdentity: string;
    message: { type: string; from: string; text: string; ts: string; model?: string };
  };
  error?: { code?: string; message?: string };
};

type ChatItem = { from: string; text: string; ts: string };

const API_BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "https://api.coziyoo.com").trim();
const AUTH_API_BASE = ((import.meta.env.VITE_AUTH_API_BASE_URL as string | undefined) ?? API_BASE).trim();

function normalizeWs(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("wss://") || trimmed.startsWith("ws://")) return trimmed;
  if (trimmed.startsWith("https://")) return `wss://${trimmed.slice("https://".length).replace(/\/+$/, "")}`;
  if (trimmed.startsWith("http://")) return `ws://${trimmed.slice("http://".length).replace(/\/+$/, "")}`;
  return trimmed;
}

async function asJson<T>(response: Response): Promise<T> {
  const raw = await response.text();
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return { error: { message: raw } } as T;
  }
}

export function App() {
  const roomRef = useRef<Room | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const autoStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const vadTimerRef = useRef<number | null>(null);
  const agentRequestAbortRef = useRef<AbortController | null>(null);
  const autoListenEnabledRef = useRef(false);
  const [tokens, setTokens] = useState<Tokens | null>(null);
  const [roomName, setRoomName] = useState("coziyoo-room");
  const [email, setEmail] = useState("admin@coziyoo.com");
  const [password, setPassword] = useState("12345");
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<string>("idle");
  const [session, setSession] = useState<SessionStartResponse["data"] | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [recording, setRecording] = useState(false);
  const [autoListen, setAutoListen] = useState(false);

  const canStart = useMemo(() => Boolean(tokens && roomName.trim() && !connecting && !connected), [tokens, roomName, connecting, connected]);

  useEffect(() => {
    return () => {
      roomRef.current?.disconnect();
      stopAutoListening();
    };
  }, []);

  async function login(event: FormEvent) {
    event.preventDefault();
    setStatus("logging in...");

    const response = await fetch(`${AUTH_API_BASE}/v1/admin/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await asJson<{ data?: { tokens?: Tokens }; error?: { message?: string } }>(response);

    if (response.status !== 200 || !body.data?.tokens) {
      setStatus(body.error?.message ?? "login failed");
      return;
    }

    setTokens(body.data.tokens);
    setStatus("login ok");
  }

  async function authorized(path: string, init?: RequestInit) {
    if (!tokens) throw new Error("not logged in");
    return fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${tokens.accessToken}`,
        ...(init?.headers ?? {}),
      },
    });
  }

  async function startSessionAndJoin() {
    if (!tokens) return;
    setConnecting(true);
    setStatus("starting session...");

    try {
      const start = await authorized("/v1/admin/livekit/session/start", {
        method: "POST",
        body: JSON.stringify({ roomName: roomName.trim() }),
      });
      const body = await asJson<SessionStartResponse>(start);
      if (start.status !== 201 || !body.data) {
        throw new Error(body.error?.message ?? "session start failed");
      }

      setSession(body.data);
      setStatus(`session ready | agent dispatched=${body.data.agent.dispatched} alreadyRunning=${String(body.data.agent.alreadyRunning ?? false)}`);

      const room = new Room();
      roomRef.current = room;
      room.on(RoomEvent.DataReceived, (payload, participant) => {
        try {
          const raw = new TextDecoder().decode(payload);
          const parsed = JSON.parse(raw) as { text?: string; ts?: string; from?: string };
          const text = parsed.text;
          if (!text) return;
          const from = parsed.from ?? participant?.identity ?? "agent";
          setChat((prev) => [...prev, { from, text, ts: parsed.ts ?? new Date().toISOString() }]);
          if (from.includes("agent") && "speechSynthesis" in window) {
            const utterance = new SpeechSynthesisUtterance(text);
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(utterance);
          }
        } catch {
          // ignore non-chat payloads
        }
      });

      await room.connect(normalizeWs(body.data.wsUrl), body.data.user.token);
      setConnected(true);
      setStatus("connected to room");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "join failed");
    } finally {
      setConnecting(false);
    }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!chatInput.trim() || !connected) return;

    const text = chatInput.trim();
    setChat((prev) => [...prev, { from: "you", text, ts: new Date().toISOString() }]);
    setChatInput("");
    await sendTextToAgent(text);
  }

  function cancelAgentOutputForBargeIn() {
    if (agentRequestAbortRef.current) {
      agentRequestAbortRef.current.abort();
      agentRequestAbortRef.current = null;
    }
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }

  async function sendTextToAgent(text: string) {
    cancelAgentOutputForBargeIn();
    const controller = new AbortController();
    agentRequestAbortRef.current = controller;
    setStatus("agent thinking...");
    try {
      const response = await authorized("/v1/admin/livekit/agent/chat", {
        method: "POST",
        body: JSON.stringify({ roomName: session?.roomName ?? roomName, text }),
        signal: controller.signal,
      });

      if (agentRequestAbortRef.current === controller) {
        agentRequestAbortRef.current = null;
      }

      const body = await asJson<AgentChatResponse>(response);
      if (response.status !== 201 || !body.data) {
        setStatus(body.error?.message ?? "agent chat failed");
        return;
      }
      setStatus("agent replied");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setStatus("agent interrupted");
        return;
      }
      setStatus(error instanceof Error ? error.message : "agent chat failed");
    }
  }

  async function blobToBase64(blob: Blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < uint8.length; i += chunk) {
      binary += String.fromCharCode(...uint8.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  async function transcribeBlob(blob: Blob, appendToInput = true) {
    setStatus("transcribing...");
    const audioBase64 = await blobToBase64(blob);
    const response = await authorized("/v1/admin/livekit/stt/transcribe", {
      method: "POST",
      body: JSON.stringify({
        audioBase64,
        mimeType: "audio/webm",
      }),
    });
    const body = await asJson<{ data?: { text?: string }; error?: { message?: string } }>(response);
    if (response.status !== 201 || !body.data?.text) {
      setStatus(body.error?.message ?? "stt failed");
      return null;
    }
    if (appendToInput) {
      setChatInput(body.data.text);
    }
    setStatus("transcribed");
    return body.data.text;
  }

  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    mediaRecorderRef.current = recorder;
    mediaChunksRef.current = [];
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) {
        mediaChunksRef.current.push(event.data);
      }
    };
    recorder.onstop = async () => {
      setRecording(false);
      if (recordTimerRef.current) {
        window.clearTimeout(recordTimerRef.current);
        recordTimerRef.current = null;
      }
      const blob = new Blob(mediaChunksRef.current, { type: "audio/webm" });
      mediaChunksRef.current = [];
      stream.getTracks().forEach((track) => track.stop());

      if (blob.size === 0) {
        setStatus("recording is empty");
        return;
      }

      await transcribeBlob(blob, true);
    };
    recorder.start();
    recordTimerRef.current = window.setTimeout(() => {
      stopRecording();
    }, 12_000);
    setRecording(true);
    setStatus("recording... max 12s");
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    if (recordTimerRef.current) {
      window.clearTimeout(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    recorder.stop();
  }

  function stopAutoListening() {
    autoListenEnabledRef.current = false;
    if (vadTimerRef.current) {
      window.clearInterval(vadTimerRef.current);
      vadTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    setRecording(false);
    if (autoStreamRef.current) {
      autoStreamRef.current.getTracks().forEach((track) => track.stop());
      autoStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAutoListen(false);
  }

  async function startAutoListening() {
    if (!connected) return;
    if (autoListenEnabledRef.current && mediaRecorderRef.current?.state === "recording") return;
    autoListenEnabledRef.current = true;
    setAutoListen(true);
    setStatus("auto listening...");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    autoStreamRef.current = stream;

    const context = new AudioContext();
    audioContextRef.current = context;
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    analyserRef.current = analyser;

    mediaChunksRef.current = [];
    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    mediaRecorderRef.current = recorder;

    let hasSpeech = false;
    let lastVoiceTs = Date.now();
    const startTs = Date.now();
    const SILENCE_MS = 1100;
    const MAX_MS = 12_000;
    const THRESHOLD = 0.018;

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) mediaChunksRef.current.push(event.data);
    };

    const data = new Uint8Array(analyser.frequencyBinCount);
    recorder.start(250);
    setRecording(true);
    vadTimerRef.current = window.setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const now = Date.now();
      if (rms > THRESHOLD) {
        hasSpeech = true;
        lastVoiceTs = now;
        cancelAgentOutputForBargeIn();
      }

      if (hasSpeech && now - lastVoiceTs >= SILENCE_MS) {
        if (vadTimerRef.current) {
          window.clearInterval(vadTimerRef.current);
          vadTimerRef.current = null;
        }
        recorder.stop();
        return;
      }

      if (now - startTs >= MAX_MS) {
        if (vadTimerRef.current) {
          window.clearInterval(vadTimerRef.current);
          vadTimerRef.current = null;
        }
        recorder.stop();
      }
    }, 120);

    recorder.onstop = async () => {
      setRecording(false);
      if (vadTimerRef.current) {
        window.clearInterval(vadTimerRef.current);
        vadTimerRef.current = null;
      }
      const blob = new Blob(mediaChunksRef.current, { type: "audio/webm" });
      mediaChunksRef.current = [];

      stream.getTracks().forEach((track) => track.stop());
      if (audioContextRef.current) {
        await audioContextRef.current.close().catch(() => undefined);
        audioContextRef.current = null;
      }
      analyserRef.current = null;
      autoStreamRef.current = null;

      if (!autoListenEnabledRef.current) return;
      if (blob.size > 0 && hasSpeech) {
        const text = await transcribeBlob(blob, false);
        if (text?.trim()) {
          const userText = text.trim();
          setChat((prev) => [...prev, { from: "you", text: userText, ts: new Date().toISOString() }]);
          await sendTextToAgent(userText);
        }
      }
      if (autoListenEnabledRef.current) {
        startAutoListening().catch((error: unknown) => {
          setStatus(error instanceof Error ? error.message : "auto listen restart failed");
          stopAutoListening();
        });
      }
    };
  }

  function disconnect() {
    stopAutoListening();
    roomRef.current?.disconnect();
    roomRef.current = null;
    setConnected(false);
    setStatus("disconnected");
  }

  return (
    <main className="container">
      <section className="card">
        <h1>Coziyoo LiveKit React Starter</h1>
        <p className="muted">Admin login + session start + single room agent + Ollama chat test app.</p>

        <form className="grid" onSubmit={login}>
          <label>
            Email
            <input value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button type="submit">Login</button>
        </form>

        <div className="grid">
          <label>
            Room Name
            <input value={roomName} onChange={(e) => setRoomName(e.target.value)} />
          </label>
          <div className="actions">
            <button onClick={startSessionAndJoin} disabled={!canStart} type="button">
              Start Session + Join
            </button>
            <button onClick={disconnect} disabled={!connected} type="button" className="ghost">
              Disconnect
            </button>
          </div>
        </div>

        <p className="status">Status: {status}</p>
        {session ? <pre>{JSON.stringify(session, null, 2)}</pre> : null}
      </section>

      <section className="card">
        <h2>Agent Chat</h2>
        <div className="chat-log">
          {chat.length === 0 ? <p className="muted">No messages yet.</p> : null}
          {chat.map((item, index) => (
            <article key={`${item.ts}-${index}`} className="chat-item">
              <p className="muted">{item.from} • {item.ts}</p>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
        <form onSubmit={sendMessage} className="chat-form">
          <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Type a message" disabled={!connected} />
          <button type="submit" disabled={!connected || !chatInput.trim()}>Send</button>
        </form>
        <div className="actions">
          <button type="button" onClick={startRecording} disabled={!connected || recording}>
            Start Voice Input
          </button>
          <button type="button" className="ghost" onClick={stopRecording} disabled={!recording}>
            Stop + Transcribe
          </button>
          <button type="button" onClick={startAutoListening} disabled={!connected || autoListen}>
            Auto Listen
          </button>
          <button type="button" className="ghost" onClick={stopAutoListening} disabled={!autoListen}>
            Stop Auto
          </button>
        </div>
      </section>
    </main>
  );
}
