import { useState } from "react";
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
  const [roomName, setRoomName] = useState("coziyoo-room");
  const [result, setResult] = useState<SessionStartResponse["data"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Session start failed");
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    setTokens(null);
    navigate("/login", { replace: true });
  }

  return (
    <main className="page-center">
      <section className="card wide">
        <h1>Voice Session Home</h1>
        <p>Start a LiveKit voice assistant session with per-session token minting.</p>
        <label>
          Room Name
          <input value={roomName} onChange={(e) => setRoomName(e.target.value)} />
        </label>
        <div className="row">
          <button type="button" onClick={startSession} disabled={loading}>{loading ? "Starting..." : "Start Session"}</button>
          <button type="button" className="ghost" onClick={() => navigate("/settings")}>Settings</button>
          <button type="button" className="ghost" onClick={logout}>Logout</button>
        </div>
        {error ? <p className="error">{error}</p> : null}
        {result ? <pre className="json-box">{JSON.stringify(result, null, 2)}</pre> : null}
      </section>
    </main>
  );
}
