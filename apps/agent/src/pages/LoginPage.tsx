import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { setTokens } from "../lib/auth";
import { request, readJson } from "../lib/api";

type LoginResponse = {
  data?: {
    tokens?: {
      accessToken: string;
      refreshToken: string;
    };
  };
  error?: { message?: string };
};

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await request("/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }, false);
      const body = await readJson<LoginResponse>(res);
      const tokens = body.data?.tokens;
      if (!res.ok || !tokens?.accessToken || !tokens.refreshToken) {
        setError(body.error?.message ?? "Login failed");
        return;
      }

      setTokens({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
      navigate("/home", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-center">
      <section className="card">
        <h1>Coziyoo Agent</h1>
        <p>Sign in to start voice selling sessions.</p>
        <form onSubmit={onSubmit} className="stack">
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button type="submit" disabled={loading}>{loading ? "Signing in..." : "Sign in"}</button>
        </form>
        <div className="row-split">
          <span>Need to adjust STT/TTS/LLM first?</span>
          <Link to="/settings">Open Settings</Link>
        </div>
      </section>
    </main>
  );
}
