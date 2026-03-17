import { type FormEvent, useState, useEffect } from "react";
import { HashRouter, Navigate, useLocation, useNavigate } from "react-router-dom";
import { request, parseJson, postJsonWith415Fallback } from "./lib/api";
import { getTokens, setTokens, getAdmin, setAdmin, BUILD_COMMIT } from "./lib/auth";
import { LANGUAGE_KEY, DICTIONARIES, initializeLanguage } from "./lib/i18n";
import { initializeDarkMode, applyDarkMode } from "./lib/dark-mode";
import AppShell from "./AppShell";
import type { AdminUser, Language, Tokens } from "./types/core";

function App() {
  const [isDarkMode, setIsDarkMode] = useState(initializeDarkMode);
  const [language, setLanguage] = useState<Language>(initializeLanguage);

  useEffect(() => {
    applyDarkMode(isDarkMode);
  }, [isDarkMode]);

  useEffect(() => {
    localStorage.setItem(LANGUAGE_KEY, language);
  }, [language]);

  return (
    <HashRouter>
      <Routes
        isDarkMode={isDarkMode}
        onToggleDarkMode={() => setIsDarkMode((value) => !value)}
        language={language}
        onToggleLanguage={() => setLanguage((value) => (value === "tr" ? "en" : "tr"))}
      />
    </HashRouter>
  );
}

function Routes({
  isDarkMode,
  onToggleDarkMode,
  language,
  onToggleLanguage,
}: {
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  language: Language;
  onToggleLanguage: () => void;
}) {
  const location = useLocation();
  const [admin, setAdminState] = useState<AdminUser | null>(() => getAdmin());

  useEffect(() => {
    if (!getTokens()) {
      setAdminState(null);
      return;
    }

    request("/v1/admin/auth/me")
      .then(async (response) => {
        if (response.status !== 200) {
          setAdminState(null);
          return;
        }
        const me = await parseJson<{ data: AdminUser }>(response);
        setAdmin(me.data);
        setAdminState(me.data);
      })
      .catch(() => {
        setAdminState(null);
      });
  }, []);

  const isLoggedIn = Boolean(getTokens() && admin);

  if (!isLoggedIn && location.pathname !== "/login") {
    return <Navigate to="/login" replace />;
  }

  if (isLoggedIn && location.pathname === "/login") {
    return <Navigate to="/app/dashboard" replace />;
  }

  if (isLoggedIn && !location.pathname.startsWith("/app/")) {
    return <Navigate to="/app/dashboard" replace />;
  }

  return (
    <>
      {location.pathname === "/login" ? <LoginScreen onLoggedIn={setAdminState} language={language} /> : null}
      {location.pathname !== "/login" ? (
        <AppShell
          admin={admin!}
          onLoggedOut={() => setAdminState(null)}
          isDarkMode={isDarkMode}
          onToggleDarkMode={onToggleDarkMode}
          language={language}
          onToggleLanguage={onToggleLanguage}
        />
      ) : null}
    </>
  );
}

function LoginScreen({ onLoggedIn, language }: { onLoggedIn: (admin: AdminUser) => void; language: Language }) {
  const dict = DICTIONARIES[language];
  const [email, setEmail] = useState("admin@coziyoo.com");
  const [password, setPassword] = useState("Admin12345");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const login = await postJsonWith415Fallback("/v1/admin/auth/login", { email, password });
      const body = await parseJson<{ data?: { tokens?: Tokens }; error?: { message?: string } }>(login);

      if (login.status !== 200 || !body.data?.tokens) {
        setError(body.error?.message ?? dict.auth.loginFailed);
        return;
      }

      setTokens(body.data.tokens);
      const meResp = await request("/v1/admin/auth/me");
      if (meResp.status !== 200) {
        setError(dict.auth.profileLoadFailed);
        return;
      }

      const me = await parseJson<{ data: AdminUser }>(meResp);
      setAdmin(me.data);
      onLoggedIn(me.data);
      navigate("/app/dashboard", { replace: true });
    } catch {
      setError(dict.auth.networkError);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-wrap">
      <section className="login-card">
        <h1>{dict.auth.title}</h1>
        <p>{dict.auth.subtitle}</p>
        <form onSubmit={onSubmit}>
          <label>
            {dict.auth.email}
            <input value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            {dict.auth.password}
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {error ? <div className="error-box">{error}</div> : null}
          <button disabled={loading} type="submit">{loading ? dict.auth.signingIn : dict.auth.signIn}</button>
        </form>
        <p className="panel-meta" style={{ marginTop: 10 }}>
          {language === "tr" ? "Sürüm" : "Version"}: <code>{BUILD_COMMIT}</code>
        </p>
      </section>
    </main>
  );
}


export default App;
