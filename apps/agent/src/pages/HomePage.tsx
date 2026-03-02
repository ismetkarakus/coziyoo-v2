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

export default function HomePage() {
  const navigate = useNavigate();
  const roomRef = useRef<Room | null>(null);
  const [roomName, setRoomName] = useState("coziyoo-room");
  const [result, setResult] = useState<SessionStartResponse["data"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [remoteCount, setRemoteCount] = useState(0);

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
      setResult(body.data);

      if (roomRef.current) {
        await disconnectRoom();
      }

      const room = new Room();
      roomRef.current = room;
      room.on(RoomEvent.ParticipantConnected, () => setRemoteCount(room.remoteParticipants.size));
      room.on(RoomEvent.ParticipantDisconnected, () => setRemoteCount(room.remoteParticipants.size));
      room.on(RoomEvent.Disconnected, () => {
        setConnected(false);
        setRemoteCount(0);
      });

      await room.connect(normalizeWsUrl(body.data.wsUrl), body.data.user.token);
      setConnected(true);
      setRemoteCount(room.remoteParticipants.size);
      await room.localParticipant.setMicrophoneEnabled(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Session start failed");
    } finally {
      setLoading(false);
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
        {error ? <p className="error">{error}</p> : null}
        {result ? <pre className="json-box">{JSON.stringify(result, null, 2)}</pre> : null}
      </section>
    </main>
  );
}
