import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent } from "livekit-client";
import { useNavigate } from "react-router-dom";
import { request, readJson } from "../lib/api";
import { setTokens } from "../lib/auth";

type SessionStartResponse = {
  data?: {
    roomName: string;
    wsUrl: string;
    user: {
      participantIdentity: string;
      token: string;
    };
    agent: {
      participantIdentity: string;
      dispatched: boolean;
      alreadyRunning: boolean;
    };
  };
  error?: {
    message?: string;
  };
};

type AgentChatResponse = {
  data?: {
    message?: {
      text?: string;
      ts?: string;
      from?: string;
    };
  };
  error?: {
    message?: string;
  };
};

type UiEvent = {
  at: string;
  source: string;
  text: string;
};

export default function HomePage() {
  const navigate = useNavigate();
  const roomRef = useRef<Room | null>(null);
  const [roomName, setRoomName] = useState("coziyoo-room");
  const [result, setResult] = useState<SessionStartResponse["data"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [remoteCount, setRemoteCount] = useState(0);
  const [events, setEvents] = useState<UiEvent[]>([]);
  const [chatText, setChatText] = useState("");
  const [sending, setSending] = useState(false);

  function normalizeWsUrl(raw: string) {
    if (raw.startsWith("ws://") || raw.startsWith("wss://")) return raw;
    if (raw.startsWith("http://")) return `ws://${raw.slice("http://".length)}`;
    if (raw.startsWith("https://")) return `wss://${raw.slice("https://".length)}`;
    return raw;
  }

  async function disconnectRoom() {
    const room = roomRef.current;
    if (!room) return;
    room.disconnect();
    roomRef.current = null;
    setConnected(false);
    setRemoteCount(0);
    setEvents((prev) => [
      { at: new Date().toISOString(), source: "system", text: "Disconnected from room" },
      ...prev,
    ]);
  }

  useEffect(() => {
    return () => {
      void disconnectRoom();
    };
  }, []);

  async function startSession() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await request("/v1/livekit/session/start", {
        method: "POST",
        body: JSON.stringify({ roomName }),
      });
      const body = await readJson<SessionStartResponse>(res);
      if (!res.ok || !body.data) {
        setError(body.error?.message ?? "Session start failed");
        return;
      }
      const sessionData = body.data;
      setResult(sessionData);

      if (roomRef.current) {
        await disconnectRoom();
      }

      const room = new Room();
      roomRef.current = room;
      room.on(RoomEvent.ParticipantConnected, () => setRemoteCount(room.remoteParticipants.size));
      room.on(RoomEvent.ParticipantDisconnected, () => setRemoteCount(room.remoteParticipants.size));
      room.on(RoomEvent.DataReceived, (payload, participant) => {
        try {
          const text = new TextDecoder().decode(payload);
          let parsedText = text;
          try {
            const json = JSON.parse(text) as { text?: string };
            parsedText = json.text ?? text;
          } catch {
            parsedText = text;
          }
          setEvents((prev) => [
            { at: new Date().toISOString(), source: participant?.identity ?? "room", text: parsedText },
            ...prev,
          ]);
        } catch {
          setEvents((prev) => [
            { at: new Date().toISOString(), source: participant?.identity ?? "room", text: "Received binary data" },
            ...prev,
          ]);
        }
      });
      room.on(RoomEvent.Disconnected, () => {
        setConnected(false);
        setRemoteCount(0);
        setEvents((prev) => [
          { at: new Date().toISOString(), source: "system", text: "Room disconnected" },
          ...prev,
        ]);
      });

      await room.connect(normalizeWsUrl(sessionData.wsUrl), sessionData.user.token);
      setConnected(true);
      setRemoteCount(room.remoteParticipants.size);
      await room.localParticipant.setMicrophoneEnabled(true);
      setEvents((prev) => [
        { at: new Date().toISOString(), source: "system", text: `Connected to ${sessionData.roomName}` },
        ...prev,
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Session start failed");
    } finally {
      setLoading(false);
    }
  }

  async function sendAgentMessage() {
    if (!result?.roomName) {
      setError("Start a session first");
      return;
    }
    const text = chatText.trim();
    if (!text) return;
    setSending(true);
    setError(null);
    try {
      const res = await request("/v1/livekit/agent/chat", {
        method: "POST",
        body: JSON.stringify({ roomName: result.roomName, text }),
      });
      const body = await readJson<AgentChatResponse>(res);
      if (!res.ok) {
        setError(body.error?.message ?? "Failed to send message");
        return;
      }
      setEvents((prev) => [
        { at: body.data?.message?.ts ?? new Date().toISOString(), source: "you", text },
        ...prev,
      ]);
      setChatText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  }

  function logout() {
    void disconnectRoom();
    setTokens(null);
    navigate("/login", { replace: true });
  }

  return (
    <main className="page-center">
      <section className="card wide">
        <h1>Voice Session Home</h1>
        <p>Start a LiveKit voice assistant session with per-session token minting.</p>
        <p className="hint">Connection: {connected ? "connected" : "not connected"} | Remote participants: {remoteCount}</p>
        <label>
          Room Name
          <input value={roomName} onChange={(e) => setRoomName(e.target.value)} />
        </label>
        <div className="row">
          <button type="button" onClick={startSession} disabled={loading}>{loading ? "Starting..." : "Start Session"}</button>
          <button type="button" className="ghost" onClick={() => void disconnectRoom()} disabled={!connected}>Disconnect</button>
          <button type="button" className="ghost" onClick={() => navigate("/settings")}>Settings</button>
          <button type="button" className="ghost" onClick={logout}>Logout</button>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <input
            style={{ flex: 1, minWidth: 220 }}
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
            placeholder="Send text to agent/chat pipeline"
          />
          <button type="button" onClick={sendAgentMessage} disabled={sending || !result?.roomName}>
            {sending ? "Sending..." : "Send"}
          </button>
        </div>
        {error ? <p className="error">{error}</p> : null}
        {result ? <pre className="json-box">{JSON.stringify(result, null, 2)}</pre> : null}
        <div className="json-box" style={{ marginTop: 10 }}>
          <strong>Session Events</strong>
          {events.length === 0 ? <p className="hint">No events yet.</p> : null}
          {events.map((event, idx) => (
            <p key={`${event.at}-${idx}`} className="hint">
              [{new Date(event.at).toLocaleTimeString()}] {event.source}: {event.text}
            </p>
          ))}
        </div>
      </section>
    </main>
  );
}
