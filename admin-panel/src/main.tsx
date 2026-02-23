import "./styles.css";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Link,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { z } from "zod";
import en from "./i18n/en.json";
import tr from "./i18n/tr.json";

type AdminUser = {
  id: string;
  email: string;
  role: "admin" | "super_admin";
  is_active?: boolean;
  last_login_at?: string | null;
};

type Tokens = {
  accessToken: string;
  refreshToken: string;
};

type ApiError = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";
const TOKEN_KEY = "coziyoo_admin_tokens";
const ADMIN_KEY = "coziyoo_admin_me";
const LANGUAGE_KEY = "admin_language";

type Language = "tr" | "en";
type Dictionary = typeof en;

const DICTIONARIES: Record<Language, Dictionary> = {
  en,
  tr,
};

function restoreRedirectPathFromQuery() {
  const url = new URL(window.location.href);
  const redirectedPath = url.searchParams.get("__redirect");
  if (!redirectedPath) return;

  url.searchParams.delete("__redirect");
  const cleanedQuery = url.searchParams.toString();
  const cleanedPath = decodeURIComponent(redirectedPath);
  const nextUrl = `${cleanedPath}${cleanedQuery ? `?${cleanedQuery}` : ""}`;
  window.history.replaceState(null, "", nextUrl);
}

restoreRedirectPathFromQuery();

const initializeLanguage = (): Language => {
  const stored = localStorage.getItem(LANGUAGE_KEY);
  if (stored === "tr" || stored === "en") return stored;
  return "tr";
};

function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ""));
}

function adminRoleLabel(dict: Dictionary, value: "admin" | "super_admin"): string {
  return value === "admin" ? dict.users.roleAdmin : dict.users.roleSuperAdmin;
}

const initializeDarkMode = () => {
  const stored = localStorage.getItem("admin_dark_mode");
  if (stored !== null) return stored === "true";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
};

const applyDarkMode = (isDark: boolean) => {
  if (isDark) {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
  localStorage.setItem("admin_dark_mode", String(isDark));
};

const AppUserFormSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(3),
  userType: z.enum(["buyer", "seller", "both"]),
  fullName: z.string().optional(),
  countryCode: z.string().min(2).max(3).optional(),
  language: z.string().min(2).max(10).optional(),
});

const AdminUserFormSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["admin", "super_admin"]),
});

function getTokens(): Tokens | null {
  const raw = sessionStorage.getItem(TOKEN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Tokens;
  } catch {
    return null;
  }
}

function setTokens(tokens: Tokens | null) {
  if (!tokens) {
    sessionStorage.removeItem(TOKEN_KEY);
    return;
  }
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
}

function getAdmin(): AdminUser | null {
  const raw = sessionStorage.getItem(ADMIN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AdminUser;
  } catch {
    return null;
  }
}

function setAdmin(admin: AdminUser | null) {
  if (!admin) {
    sessionStorage.removeItem(ADMIN_KEY);
    return;
  }
  sessionStorage.setItem(ADMIN_KEY, JSON.stringify(admin));
}

async function request(path: string, init?: RequestInit, retry = true): Promise<Response> {
  const tokens = getTokens();
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has("content-type") && init?.body) {
    headers.set("content-type", "application/json");
  }
  if (tokens?.accessToken) {
    headers.set("authorization", `Bearer ${tokens.accessToken}`);
  }

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (response.status === 401 && retry && tokens?.refreshToken) {
    const refreshed = await refreshToken(tokens.refreshToken);
    if (refreshed) {
      return request(path, init, false);
    }
  }

  return response;
}

async function refreshToken(refreshTokenValue: string): Promise<boolean> {
  const response = await fetch(`${API_BASE}/v1/admin/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: refreshTokenValue }),
  });

  if (response.status !== 200) {
    setTokens(null);
    setAdmin(null);
    return false;
  }

  const json = (await response.json()) as { data: { tokens: { accessToken: string; refreshToken: string } } };
  setTokens({
    accessToken: json.data.tokens.accessToken,
    refreshToken: json.data.tokens.refreshToken,
  });
  return true;
}

async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

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
    <BrowserRouter>
      <Routes
        isDarkMode={isDarkMode}
        onToggleDarkMode={() => setIsDarkMode((value) => !value)}
        language={language}
        onToggleLanguage={() => setLanguage((value) => (value === "tr" ? "en" : "tr"))}
      />
    </BrowserRouter>
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
  }, [location.pathname]);

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
        <Shell
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
  const [password, setPassword] = useState("12345");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const login = await fetch(`${API_BASE}/v1/admin/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
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
      </section>
    </main>
  );
}

function Shell({
  admin,
  onLoggedOut,
  isDarkMode,
  onToggleDarkMode,
  language,
  onToggleLanguage,
}: {
  admin: AdminUser;
  onLoggedOut: () => void;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  language: Language;
  onToggleLanguage: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const dict = DICTIONARIES[language];

  async function logout() {
    const tokens = getTokens();
    await request("/v1/admin/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refreshToken: tokens?.refreshToken }),
    }).catch(() => undefined);

    setTokens(null);
    setAdmin(null);
    onLoggedOut();
    navigate("/login", { replace: true });
  }

  const isSuperAdmin = admin.role === "super_admin";

  return (
    <main className="shell">
      <header className="navbar">
        <div className="navbar-left">
          <div className="brand">
            <span className="brand-dot" />
            <div>
              <p className="brand-title">{dict.navbar.title}</p>
              <p className="brand-subtitle">{dict.navbar.subtitle}</p>
            </div>
          </div>
          <nav className="nav">
            <Link className={`nav-link ${location.pathname === "/app/dashboard" ? "is-active" : ""}`} to="/app/dashboard">
              {dict.menu.dashboard}
            </Link>
            <Link className={`nav-link ${location.pathname.startsWith("/app/users") ? "is-active" : ""}`} to="/app/users">
              {dict.menu.appUsers}
            </Link>
            <Link className={`nav-link ${location.pathname.startsWith("/app/buyers") ? "is-active" : ""}`} to="/app/buyers">
              {dict.menu.buyers}
            </Link>
            <Link className={`nav-link ${location.pathname.startsWith("/app/sellers") ? "is-active" : ""}`} to="/app/sellers">
              {dict.menu.sellers}
            </Link>
            <Link className={`nav-link ${location.pathname.startsWith("/app/admins") ? "is-active" : ""}`} to="/app/admins">
              {dict.menu.admins}
            </Link>
            <Link className={`nav-link ${location.pathname.startsWith("/app/audit") ? "is-active" : ""}`} to="/app/audit">
              {dict.menu.audit}
            </Link>
            <Link className={`nav-link ${location.pathname.startsWith("/app/entities") ? "is-active" : ""}`} to="/app/entities">
              {dict.menu.dataExplorer}
            </Link>
          </nav>
        </div>
        <div className="navbar-actions">
          <ApiHealthBadge />
          <span className="role-chip">{adminRoleLabel(dict, admin.role)}</span>
          <span className="navbar-email">{admin.email}</span>
          <button className="ghost" onClick={onToggleLanguage} type="button">
            {dict.actions.language}
          </button>
          <button className="theme-toggle" onClick={onToggleDarkMode} type="button">
            {isDarkMode ? "☀️" : "🌙"}
          </button>
          <button className="ghost" onClick={logout} type="button">{dict.actions.logout}</button>
        </div>
      </header>
      <section className="main">
        {location.pathname === "/app/dashboard" ? <DashboardPage language={language} /> : null}
        {location.pathname === "/app/users" ? <UsersPage kind="app" isSuperAdmin={isSuperAdmin} language={language} /> : null}
        {location.pathname === "/app/buyers" ? <UsersPage kind="buyers" isSuperAdmin={isSuperAdmin} language={language} /> : null}
        {location.pathname === "/app/sellers" ? <UsersPage kind="sellers" isSuperAdmin={isSuperAdmin} language={language} /> : null}
        {location.pathname === "/app/admins" ? <UsersPage kind="admin" isSuperAdmin={isSuperAdmin} language={language} /> : null}
        {location.pathname === "/app/audit" ? <AuditPage language={language} /> : null}
        {location.pathname === "/app/entities" || location.pathname.startsWith("/app/entities/") ? <EntitiesPage language={language} /> : null}
        {location.pathname.startsWith("/app/users/") ? <UserDetail kind="app" isSuperAdmin={isSuperAdmin} language={language} /> : null}
        {location.pathname.startsWith("/app/buyers/") ? <UserDetail kind="buyers" isSuperAdmin={isSuperAdmin} language={language} /> : null}
        {location.pathname.startsWith("/app/sellers/") ? <UserDetail kind="sellers" isSuperAdmin={isSuperAdmin} language={language} /> : null}
        {location.pathname.startsWith("/app/admins/") ? <UserDetail kind="admin" isSuperAdmin={isSuperAdmin} language={language} /> : null}
      </section>
      <Outlet />
    </main>
  );
}

function ApiHealthBadge() {
  const [status, setStatus] = useState<"checking" | "up" | "down">("checking");

  useEffect(() => {
    let disposed = false;

    const check = async () => {
      try {
        const response = await fetch(`${API_BASE}/v1/health`, {
          method: "GET",
          cache: "no-store",
        });
        if (disposed) return;
        setStatus(response.status === 200 ? "up" : "down");
      } catch {
        if (disposed) return;
        setStatus("down");
      }
    };

    check().catch(() => setStatus("down"));
    const timer = window.setInterval(() => {
      check().catch(() => setStatus("down"));
    }, 20000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  const text = status === "up" ? "API up" : status === "down" ? "API down" : "API check";
  return (
    <span className={`health-chip is-${status}`} title="API health">
      <span className="health-dot" />
      {text}
    </span>
  );
}

function toLabel(input: string) {
  return input
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (char) => char.toUpperCase());
}

function DashboardPage({ language }: { language: Language }) {
  const dict = DICTIONARIES[language];
  const [data, setData] = useState<Record<string, number | string> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    request("/v1/admin/dashboard/overview")
      .then(async (response) => {
        if (response.status !== 200) {
          const body = (await parseJson<ApiError>(response)) ?? {};
          setError(body.error?.message ?? dict.dashboard.loadFailed);
          return;
        }
        const body = await parseJson<{ data: Record<string, number | string> }>(response);
        setData(body.data);
      })
      .catch(() => setError(dict.dashboard.requestFailed));
  }, []);

  if (error) return <div className="alert">{error}</div>;
  if (!data) return <div className="panel">{dict.common.loading}</div>;

  const entries = Object.entries(data);

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <p className="eyebrow">{dict.dashboard.eyebrow}</p>
          <h1>{dict.dashboard.title}</h1>
          <p className="subtext">{dict.dashboard.subtitle}</p>
        </div>
        <div className="topbar-actions">
          <button className="ghost" type="button" onClick={() => window.location.reload()}>{dict.actions.refresh}</button>
          <button className="primary" type="button">{dict.actions.reviewQueue}</button>
        </div>
      </header>
      <div className="kpi-grid">
        {entries.map(([key, value]) => (
          <article className="card" key={key}>
            <p className="card-label">{toLabel(key)}</p>
            <p className="card-value">{String(value)}</p>
          </article>
        ))}
      </div>
      <section className="content-grid">
        <article className="panel">
          <div className="panel-header">
            <h2>{dict.dashboard.kpiSnapshot}</h2>
          </div>
          <div className="table">
            <div className="table-row table-head table-row-kpi">
              <span>{dict.dashboard.metric}</span>
              <span>{dict.dashboard.value}</span>
            </div>
            {entries.map(([key, value]) => (
              <div className="table-row table-row-kpi" key={`table-${key}`}>
                <span>{toLabel(key)}</span>
                <span>{String(value)}</span>
              </div>
            ))}
          </div>
        </article>
        <article className="panel">
          <div className="panel-header">
            <h2>{dict.dashboard.quickActions}</h2>
          </div>
          <div className="actions">
            <button className="primary" type="button">{dict.actions.openComplianceQueue}</button>
            <button className="ghost" type="button">{dict.actions.viewPaymentDisputes}</button>
            <button className="ghost" type="button">{dict.actions.inspectAppUsers}</button>
            <button className="ghost" type="button">{dict.actions.inspectAdminUsers}</button>
          </div>
          <div className="divider" />
          <div className="panel-note">
            <p>{dict.dashboard.subtitle}</p>
          </div>
        </article>
      </section>
    </div>
  );
}

type UserKind = "app" | "buyers" | "sellers" | "admin";

function UsersPage({ kind, isSuperAdmin, language }: { kind: UserKind; isSuperAdmin: boolean; language: Language }) {
  const dict = DICTIONARIES[language];
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pagination, setPagination] = useState<{ total: number; totalPages: number } | null>(null);
  const [filters, setFilters] = useState({
    page: 1,
    pageSize: 20,
    search: "",
    sortBy: "createdAt",
    sortDir: "desc" as "asc" | "desc",
    status: "all",
    roleFilter: "all",
  });
  const navigate = useNavigate();

  const isAppScoped = kind === "app" || kind === "buyers" || kind === "sellers";
  const endpoint = isAppScoped ? "/v1/admin/users" : "/v1/admin/admin-users";
  const tableKey = isAppScoped ? "users" : "adminUsers";
  const audience = kind === "buyers" ? "buyer" : kind === "sellers" ? "seller" : null;

  const [fields, setFields] = useState<string[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);

  const pageTitle =
    kind === "app" ? dict.users.titleApp : kind === "buyers" ? dict.users.titleBuyers : kind === "sellers" ? dict.users.titleSellers : dict.users.titleAdmins;
  const eyebrow =
    kind === "app" ? dict.users.eyebrowApp : kind === "buyers" ? dict.users.eyebrowBuyers : kind === "sellers" ? dict.users.eyebrowSellers : dict.users.eyebrowAdmins;

  useEffect(() => {
    setFilters((prev) => ({
      ...prev,
      page: 1,
      sortBy: "createdAt",
      roleFilter: "all",
    }));
  }, [kind]);

  useEffect(() => {
    request(`/v1/admin/metadata/tables/${tableKey}/fields`).then(async (response) => {
      if (response.status !== 200) return;
      const body = await parseJson<{ data: { fields: Array<{ name: string }> } }>(response);
      const names = body.data.fields.map((f) => f.name);
      setFields(names);

      const prefs = await request(`/v1/admin/table-preferences/${tableKey}`);
      if (prefs.status === 200) {
        const prefBody = await parseJson<{ data: { visibleColumns: string[] } }>(prefs);
        setVisibleColumns(prefBody.data.visibleColumns);
      } else {
        setVisibleColumns(names);
      }
    });
  }, [tableKey]);

  async function loadRows() {
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({
      page: String(filters.page),
      pageSize: String(filters.pageSize),
      sortBy: filters.sortBy,
      sortDir: filters.sortDir,
      ...(filters.search ? { search: filters.search } : {}),
      ...(filters.status !== "all" ? { status: filters.status } : {}),
      ...(audience ? { audience } : {}),
      ...(isAppScoped && filters.roleFilter !== "all" ? { userType: filters.roleFilter } : {}),
      ...(!isAppScoped && filters.roleFilter !== "all" ? { role: filters.roleFilter } : {}),
    });

    const response = await request(`${endpoint}?${query.toString()}`);
    const body = await parseJson<{ data?: any[]; pagination?: { total: number; totalPages: number } } & ApiError>(response);

    if (response.status !== 200 || !body.data) {
      setError(body.error?.message ?? dict.users.loadFailed);
      setLoading(false);
      return;
    }

    setRows(body.data);
    if (body.pagination) setPagination({ total: body.pagination.total, totalPages: body.pagination.totalPages });
    setLoading(false);
  }

  useEffect(() => {
    loadRows().catch(() => setError(dict.users.requestFailed));
  }, [filters.page, filters.pageSize, filters.sortBy, filters.sortDir, filters.status, filters.roleFilter, audience]);

  async function savePreferences() {
    const response = await request(`/v1/admin/table-preferences/${tableKey}`, {
      method: "PUT",
      body: JSON.stringify({ visibleColumns, columnOrder: visibleColumns }),
    });

    if (response.status !== 200) {
      setError(dict.users.preferencesFailed);
    }
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const formData = new FormData(event.currentTarget);

    if (isAppScoped) {
      const payload = {
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
        displayName: String(formData.get("displayName") ?? ""),
        userType:
          kind === "buyers"
            ? "buyer"
            : kind === "sellers"
              ? "seller"
              : (String(formData.get("userType") ?? "buyer") as "buyer" | "seller" | "both"),
      };
      const parsed = AppUserFormSchema.safeParse(payload);
      if (!parsed.success) {
        setFormError(parsed.error.issues[0]?.message ?? dict.users.validationFailed);
        return;
      }

      const create = await request(endpoint, {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });

      if (create.status !== 201) {
        const body = await parseJson<ApiError>(create);
        setFormError(body.error?.message ?? dict.users.createFailed);
        return;
      }
    } else {
      const payload = {
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
        role: String(formData.get("role") ?? "admin") as "admin" | "super_admin",
      };
      const parsed = AdminUserFormSchema.safeParse(payload);
      if (!parsed.success) {
        setFormError(parsed.error.issues[0]?.message ?? dict.users.validationFailed);
        return;
      }

      const create = await request(endpoint, {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });

      if (create.status !== 201) {
        const body = await parseJson<ApiError>(create);
        setFormError(body.error?.message ?? dict.users.createFailed);
        return;
      }
    }

    (event.currentTarget as HTMLFormElement).reset();
    await loadRows();
  }

  async function patchUser(rowId: string, path: string, payload: unknown) {
    const response = await request(`${endpoint}/${rowId}/${path}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });

    if (response.status !== 200) {
      const body = await parseJson<ApiError>(response);
      setError(body.error?.message ?? dict.users.updateFailed);
      return;
    }

    await loadRows();
  }

  const tableColumns = useMemo(() => {
    if (visibleColumns.length === 0) return fields;
    return visibleColumns;
  }, [fields, visibleColumns]);

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{pageTitle}</h1>
          <p className="subtext">{dict.users.subtitle}</p>
        </div>
        <div className="topbar-actions">
          <input
            placeholder={dict.users.searchPlaceholder}
            value={filters.search}
            onChange={(event) => setFilters((prev) => ({ ...prev, page: 1, search: event.target.value }))}
          />
          <button className="ghost" type="button" onClick={() => loadRows()}>{dict.actions.search}</button>
        </div>
      </header>

      <section className="panel">
        <div className="filter-grid">
          <label>
            {dict.users.sortBy}
            <select value={filters.sortBy} onChange={(event) => setFilters((prev) => ({ ...prev, page: 1, sortBy: event.target.value }))}>
              {isAppScoped ? (
                <>
                  <option value="createdAt">createdAt</option>
                  <option value="updatedAt">updatedAt</option>
                  <option value="email">email</option>
                  <option value="displayName">displayName</option>
                  <option value="userType">userType</option>
                  <option value="status">status</option>
                </>
              ) : (
                <>
                  <option value="createdAt">createdAt</option>
                  <option value="updatedAt">updatedAt</option>
                  <option value="email">email</option>
                  <option value="role">role</option>
                  <option value="status">status</option>
                </>
              )}
            </select>
          </label>
          <label>
            {dict.users.direction}
            <select
              value={filters.sortDir}
              onChange={(event) => setFilters((prev) => ({ ...prev, page: 1, sortDir: event.target.value as "asc" | "desc" }))}
            >
              <option value="desc">{dict.common.desc}</option>
              <option value="asc">{dict.common.asc}</option>
            </select>
          </label>
          <label>
            {dict.users.status}
            <select value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, page: 1, status: event.target.value }))}>
              <option value="all">{dict.common.all}</option>
              <option value="active">{dict.common.active}</option>
              <option value="disabled">{dict.common.disabled}</option>
            </select>
          </label>
          <label>
            {dict.users.roleFilter}
            <select value={filters.roleFilter} onChange={(event) => setFilters((prev) => ({ ...prev, page: 1, roleFilter: event.target.value }))}>
              <option value="all">{dict.common.all}</option>
              {isAppScoped ? (
                <>
                  <option value="buyer">{dict.users.userTypeBuyer}</option>
                  <option value="seller">{dict.users.userTypeSeller}</option>
                  <option value="both">{dict.users.userTypeBoth}</option>
                </>
              ) : (
                <>
                  <option value="admin">{dict.users.roleAdmin}</option>
                  <option value="super_admin">{dict.users.roleSuperAdmin}</option>
                </>
              )}
            </select>
          </label>
          <label>
            {dict.users.pageSize}
            <select
              value={String(filters.pageSize)}
              onChange={(event) => setFilters((prev) => ({ ...prev, page: 1, pageSize: Number(event.target.value) }))}
            >
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </label>
        </div>
      </section>

      <section className="panel columns-panel">
        <div className="panel-header">
          <h2>{dict.users.visibleColumns}</h2>
          <span className="panel-meta">{tableKey}</span>
        </div>
        <div className="checkbox-grid">
          {fields.map((field) => (
            <label key={field}>
              <input
                type="checkbox"
                checked={tableColumns.includes(field)}
                onChange={(event) => {
                  setVisibleColumns((prev) => {
                    if (event.target.checked) return [...new Set([...prev, field])];
                    return prev.filter((item) => item !== field);
                  });
                }}
              />
              {field}
            </label>
          ))}
        </div>
        <button className="primary" type="button" onClick={savePreferences}>{dict.users.savePreferences}</button>
      </section>

      {error ? <div className="alert">{error}</div> : null}

      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {tableColumns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
                <th>{dict.users.actions}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={tableColumns.length + 1}>{dict.common.loading}</td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    {tableColumns.map((column) => (
                      <td key={`${row.id}-${column}`}>{String(row[column] ?? "")}</td>
                    ))}
                    <td className="cell-actions">
                      <button
                        className="ghost"
                        type="button"
                        onClick={() =>
                          navigate(
                            kind === "app"
                              ? `/app/users/${row.id}`
                              : kind === "buyers"
                                ? `/app/buyers/${row.id}`
                                : kind === "sellers"
                                  ? `/app/sellers/${row.id}`
                                  : `/app/admins/${row.id}`
                          )
                        }
                      >
                        {dict.actions.detail}
                      </button>
                      {isSuperAdmin ? (
                        <>
                          <button
                            className="ghost"
                            type="button"
                            onClick={() =>
                              patchUser(row.id, "status", {
                                status: row.is_active || row.status === "active" ? "disabled" : "active",
                              })
                            }
                          >
                            {dict.actions.toggleStatus}
                          </button>
                          <button
                            className="ghost"
                            type="button"
                            onClick={() =>
                              patchUser(row.id, "role", {
                                role:
                                  isAppScoped
                                    ? row.role === "buyer"
                                      ? "seller"
                                      : row.role === "seller"
                                        ? "both"
                                        : "buyer"
                                    : row.role === "admin"
                                      ? "super_admin"
                                      : "admin",
                              })
                            }
                          >
                            {dict.actions.rotateRole}
                          </button>
                        </>
                      ) : (
                        <span className="panel-meta">{dict.common.readOnly}</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="pager">
          <span className="panel-meta">
            {fmt(dict.common.paginationSummary, {
              total: pagination?.total ?? 0,
              page: filters.page,
              totalPages: Math.max(pagination?.totalPages ?? 1, 1),
            })}
          </span>
          <div className="topbar-actions">
            <button
              className="ghost"
              type="button"
              disabled={filters.page <= 1}
              onClick={() => setFilters((prev) => ({ ...prev, page: prev.page - 1 }))}
            >
              {dict.actions.prev}
            </button>
            <button
              className="ghost"
              type="button"
              disabled={filters.page >= Math.max(pagination?.totalPages ?? 1, 1)}
              onClick={() => setFilters((prev) => ({ ...prev, page: prev.page + 1 }))}
            >
              {dict.actions.next}
            </button>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>
            {isAppScoped
              ? kind === "buyers"
                ? dict.users.createBuyer
                : kind === "sellers"
                  ? dict.users.createSeller
                  : dict.users.createAppUser
              : dict.users.createAdmin}
          </h2>
        </div>
        {!isSuperAdmin ? <p className="panel-meta">{dict.users.onlySuperAdmin}</p> : null}
        <form className="form-grid" onSubmit={createUser}>
          <label>
            {dict.auth.email}
            <input name="email" disabled={!isSuperAdmin} />
          </label>
          <label>
            {dict.auth.password}
            <input name="password" type="password" disabled={!isSuperAdmin} />
          </label>
          {isAppScoped ? (
            <>
              <label>
                {dict.users.displayName}
                <input name="displayName" disabled={!isSuperAdmin} />
              </label>
              {kind === "app" ? (
                <label>
                  {dict.users.userType}
                  <select name="userType" disabled={!isSuperAdmin}>
                    <option value="buyer">{dict.users.userTypeBuyer}</option>
                    <option value="seller">{dict.users.userTypeSeller}</option>
                    <option value="both">{dict.users.userTypeBoth}</option>
                  </select>
                </label>
              ) : null}
            </>
          ) : (
            <label>
              {dict.users.role}
              <select name="role" disabled={!isSuperAdmin}>
                <option value="admin">{dict.users.roleAdmin}</option>
                <option value="super_admin">{dict.users.roleSuperAdmin}</option>
              </select>
            </label>
          )}
          <button className="primary" type="submit" disabled={!isSuperAdmin}>{dict.actions.create}</button>
        </form>
        {formError ? <div className="alert">{formError}</div> : null}
      </section>
    </div>
  );
}

function EntitiesPage({ language }: { language: Language }) {
  const dict = DICTIONARIES[language];
  const location = useLocation();
  const navigate = useNavigate();
  const [entities, setEntities] = useState<Array<{ tableKey: string; tableName: string }>>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [pagination, setPagination] = useState<{ total: number; totalPages: number } | null>(null);

  const selectedTableKey = location.pathname.split("/")[3] ?? "";

  useEffect(() => {
    request("/v1/admin/metadata/entities")
      .then(async (response) => {
        if (response.status !== 200) {
          setError(dict.entities.loadEntitiesFailed);
          return;
        }
        const body = await parseJson<{ data: Array<{ tableKey: string; tableName: string }> }>(response);
        setEntities(body.data);
        if (!selectedTableKey && body.data.length > 0) {
          navigate(`/app/entities/${body.data[0].tableKey}`, { replace: true });
        }
      })
      .catch(() => setError(dict.entities.entitiesRequestFailed));
  }, [navigate, selectedTableKey, dict.entities.entitiesRequestFailed, dict.entities.loadEntitiesFailed]);

  useEffect(() => {
    if (!selectedTableKey) return;
    setLoading(true);
    setError(null);

    const query = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sortDir: "desc",
      ...(search ? { search } : {}),
    });

    request(`/v1/admin/metadata/tables/${selectedTableKey}/records?${query.toString()}`)
      .then(async (response) => {
        if (response.status !== 200) {
          const body = await parseJson<ApiError>(response);
          setError(body.error?.message ?? dict.entities.loadRecordsFailed);
          setLoading(false);
          return;
        }

        const body = await parseJson<{
          data: {
            rows: Array<Record<string, unknown>>;
            columns: string[];
          };
          pagination: {
            total: number;
            totalPages: number;
          };
        }>(response);

        setRows(body.data.rows);
        setColumns(body.data.columns);
        setPagination({ total: body.pagination.total, totalPages: body.pagination.totalPages });
        setLoading(false);
      })
      .catch(() => {
        setError(dict.entities.recordsRequestFailed);
        setLoading(false);
      });
  }, [selectedTableKey, page, pageSize, search, dict.entities.loadRecordsFailed, dict.entities.recordsRequestFailed]);

  const selectedEntity = entities.find((item) => item.tableKey === selectedTableKey);

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <p className="eyebrow">{dict.entities.eyebrow}</p>
          <h1>{selectedEntity ? selectedEntity.tableName : dict.entities.titleAll}</h1>
          <p className="subtext">{dict.entities.subtitle}</p>
        </div>
        <div className="topbar-actions">
          <input
            placeholder={dict.entities.searchPlaceholder}
            value={search}
            onChange={(event) => {
              setPage(1);
              setSearch(event.target.value);
            }}
          />
        </div>
      </header>

      <section className="explorer-layout">
        <aside className="panel explorer-side">
          <div className="panel-header">
            <h2>{dict.entities.tables}</h2>
            <span className="panel-meta">{entities.length}</span>
          </div>
          <div className="entity-list">
            {entities.map((entity) => (
              <button
                key={entity.tableKey}
                className={`entity-item ${selectedTableKey === entity.tableKey ? "is-active" : ""}`}
                onClick={() => {
                  setPage(1);
                  navigate(`/app/entities/${entity.tableKey}`);
                }}
                type="button"
              >
                <span>{entity.tableKey}</span>
                <small>{entity.tableName}</small>
              </button>
            ))}
          </div>
        </aside>
        <section className="panel">
          {error ? <div className="alert">{error}</div> : null}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={Math.max(columns.length, 1)}>{dict.common.loading}</td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={Math.max(columns.length, 1)}>{dict.common.noRecords}</td>
                  </tr>
                ) : (
                  rows.map((row, index) => (
                    <tr key={`${selectedTableKey}-${index}`}>
                      {columns.map((column) => (
                        <td key={`${index}-${column}`}>{renderCell(row[column])}</td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <span className="panel-meta">
              {fmt(dict.common.paginationSummary, {
                total: pagination?.total ?? 0,
                page,
                totalPages: Math.max(pagination?.totalPages ?? 1, 1),
              })}
            </span>
            <div className="topbar-actions">
              <button className="ghost" disabled={page <= 1} onClick={() => setPage((prev) => prev - 1)} type="button">
                {dict.actions.prev}
              </button>
              <button
                className="ghost"
                disabled={page >= Math.max(pagination?.totalPages ?? 1, 1)}
                onClick={() => setPage((prev) => prev + 1)}
                type="button"
              >
                {dict.actions.next}
              </button>
            </div>
          </div>
        </section>
      </section>
    </div>
  );
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function AuditPage({ language }: { language: Language }) {
  const dict = DICTIONARIES[language];
  const [rows, setRows] = useState<
    Array<{
      eventId: string;
      source: string;
      eventType: string;
      actorId: string | null;
      actorLabel: string | null;
      entityType: string | null;
      entityId: string | null;
      ip: string | null;
      userAgent: string | null;
      payload: unknown;
      createdAt: string;
    }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState<{ total: number; totalPages: number } | null>(null);
  const [filters, setFilters] = useState({
    page: 1,
    pageSize: 20,
    source: "all",
    eventType: "",
    actorId: "",
    entityType: "",
    search: "",
    from: "",
    to: "",
    sortBy: "createdAt",
    sortDir: "desc" as "asc" | "desc",
  });

  async function loadAudit() {
    setLoading(true);
    setError(null);

    const query = new URLSearchParams({
      page: String(filters.page),
      pageSize: String(filters.pageSize),
      sortBy: filters.sortBy,
      sortDir: filters.sortDir,
      ...(filters.source !== "all" ? { source: filters.source } : {}),
      ...(filters.eventType ? { eventType: filters.eventType } : {}),
      ...(filters.actorId ? { actorId: filters.actorId } : {}),
      ...(filters.entityType ? { entityType: filters.entityType } : {}),
      ...(filters.search ? { search: filters.search } : {}),
      ...(filters.from ? { from: new Date(filters.from).toISOString() } : {}),
      ...(filters.to ? { to: new Date(filters.to).toISOString() } : {}),
    });

    const response = await request(`/v1/admin/audit/events?${query.toString()}`);
    const body = await parseJson<{
      data?: Array<{
        eventId: string;
        source: string;
        eventType: string;
        actorId: string | null;
        actorLabel: string | null;
        entityType: string | null;
        entityId: string | null;
        ip: string | null;
        userAgent: string | null;
        payload: unknown;
        createdAt: string;
      }>;
      pagination?: { total: number; totalPages: number };
    } & ApiError>(response);

    if (response.status !== 200 || !body.data || !body.pagination) {
      setError(body.error?.message ?? dict.audit.loadFailed);
      setLoading(false);
      return;
    }

    setRows(body.data);
    setPagination(body.pagination);
    setLoading(false);
  }

  useEffect(() => {
    loadAudit().catch(() => setError(dict.audit.requestFailed));
  }, [filters.page, filters.pageSize, filters.sortBy, filters.sortDir, dict.audit.requestFailed]);

  async function exportCsv() {
    const query = new URLSearchParams({
      ...(filters.source !== "all" ? { source: filters.source } : {}),
      ...(filters.eventType ? { eventType: filters.eventType } : {}),
      ...(filters.actorId ? { actorId: filters.actorId } : {}),
      ...(filters.entityType ? { entityType: filters.entityType } : {}),
      ...(filters.search ? { search: filters.search } : {}),
      ...(filters.from ? { from: new Date(filters.from).toISOString() } : {}),
      ...(filters.to ? { to: new Date(filters.to).toISOString() } : {}),
    });
    const response = await request(`/v1/admin/audit/events/export?${query.toString()}`);
    if (response.status !== 200) {
      setError(dict.audit.exportFailed);
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `audit-events-${new Date().toISOString().slice(0, 19)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <p className="eyebrow">{dict.audit.eyebrow}</p>
          <h1>{dict.audit.title}</h1>
          <p className="subtext">{dict.audit.subtitle}</p>
        </div>
        <div className="topbar-actions">
          <button className="ghost" type="button" onClick={() => loadAudit()}>{dict.actions.applyFilters}</button>
          <button className="primary" type="button" onClick={exportCsv}>{dict.actions.exportCsv}</button>
        </div>
      </header>

      <section className="panel">
        <div className="filter-grid">
          <label>
            {dict.audit.source}
            <select value={filters.source} onChange={(event) => setFilters((prev) => ({ ...prev, page: 1, source: event.target.value }))}>
              <option value="all">{dict.common.all}</option>
              <option value="admin_audit">admin_audit</option>
              <option value="auth_audit">auth_audit</option>
              <option value="admin_auth_audit">admin_auth_audit</option>
              <option value="abuse_risk">abuse_risk</option>
              <option value="order_event">order_event</option>
              <option value="compliance_event">compliance_event</option>
              <option value="lot_event">lot_event</option>
            </select>
          </label>
          <label>
            {dict.audit.eventType}
            <input value={filters.eventType} onChange={(event) => setFilters((prev) => ({ ...prev, page: 1, eventType: event.target.value }))} />
          </label>
          <label>
            {dict.audit.actorId}
            <input value={filters.actorId} onChange={(event) => setFilters((prev) => ({ ...prev, page: 1, actorId: event.target.value }))} />
          </label>
          <label>
            {dict.audit.entityType}
            <input value={filters.entityType} onChange={(event) => setFilters((prev) => ({ ...prev, page: 1, entityType: event.target.value }))} />
          </label>
          <label>
            {dict.audit.search}
            <input value={filters.search} onChange={(event) => setFilters((prev) => ({ ...prev, page: 1, search: event.target.value }))} />
          </label>
          <label>
            {dict.audit.from}
            <input type="datetime-local" value={filters.from} onChange={(event) => setFilters((prev) => ({ ...prev, page: 1, from: event.target.value }))} />
          </label>
          <label>
            {dict.audit.to}
            <input type="datetime-local" value={filters.to} onChange={(event) => setFilters((prev) => ({ ...prev, page: 1, to: event.target.value }))} />
          </label>
          <label>
            {dict.audit.sortBy}
            <select value={filters.sortBy} onChange={(event) => setFilters((prev) => ({ ...prev, page: 1, sortBy: event.target.value }))}>
              <option value="createdAt">createdAt</option>
              <option value="source">source</option>
              <option value="eventType">eventType</option>
            </select>
          </label>
          <label>
            {dict.audit.direction}
            <select
              value={filters.sortDir}
              onChange={(event) => setFilters((prev) => ({ ...prev, page: 1, sortDir: event.target.value as "asc" | "desc" }))}
            >
              <option value="desc">{dict.common.desc}</option>
              <option value="asc">{dict.common.asc}</option>
            </select>
          </label>
          <label>
            {dict.audit.pageSize}
            <select value={String(filters.pageSize)} onChange={(event) => setFilters((prev) => ({ ...prev, page: 1, pageSize: Number(event.target.value) }))}>
              <option value="20">20</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </label>
        </div>
      </section>

      {error ? <div className="alert">{error}</div> : null}

      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{dict.audit.createdAt}</th>
                <th>{dict.audit.source}</th>
                <th>{dict.audit.eventType}</th>
                <th>{dict.audit.actorId}</th>
                <th>{dict.audit.actorLabel}</th>
                <th>{dict.audit.entityType}</th>
                <th>{dict.audit.entityId}</th>
                <th>{dict.audit.ip}</th>
                <th>{dict.audit.userAgent}</th>
                <th>{dict.audit.payload}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10}>{dict.common.loading}</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={10}>{dict.audit.noEvents}</td></tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.eventId}>
                    <td>{row.createdAt}</td>
                    <td>{row.source}</td>
                    <td>{row.eventType}</td>
                    <td>{row.actorId ?? ""}</td>
                    <td>{row.actorLabel ?? ""}</td>
                    <td>{row.entityType ?? ""}</td>
                    <td>{row.entityId ?? ""}</td>
                    <td>{row.ip ?? ""}</td>
                    <td className="audit-cell">{row.userAgent ?? ""}</td>
                    <td className="audit-cell">{row.payload ? JSON.stringify(row.payload) : ""}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="pager">
          <span className="panel-meta">
            {fmt(dict.common.paginationSummary, {
              total: pagination?.total ?? 0,
              page: filters.page,
              totalPages: Math.max(pagination?.totalPages ?? 1, 1),
            })}
          </span>
          <div className="topbar-actions">
            <button className="ghost" type="button" disabled={filters.page <= 1} onClick={() => setFilters((prev) => ({ ...prev, page: prev.page - 1 }))}>
              {dict.actions.prev}
            </button>
            <button
              className="ghost"
              type="button"
              disabled={filters.page >= Math.max(pagination?.totalPages ?? 1, 1)}
              onClick={() => setFilters((prev) => ({ ...prev, page: prev.page + 1 }))}
            >
              {dict.actions.next}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function UserDetail({ kind, isSuperAdmin, language }: { kind: UserKind; isSuperAdmin: boolean; language: Language }) {
  const dict = DICTIONARIES[language];
  const location = useLocation();
  const id = location.pathname.split("/").at(-1) ?? "";
  const endpoint =
    kind === "admin" ? `/v1/admin/admin-users/${id}` : `/v1/admin/users/${id}`;

  const [row, setRow] = useState<any | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    request(endpoint)
      .then(async (response) => {
        if (response.status !== 200) {
          setMessage(dict.detail.loadFailed);
          return;
        }
        const body = await parseJson<{ data: any }>(response);
        setRow(body.data);
      })
      .catch(() => setMessage(dict.detail.requestFailed));
  }, [endpoint, dict.detail.loadFailed, dict.detail.requestFailed]);

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isSuperAdmin) return;

    const formData = new FormData(event.currentTarget);
    const payload: Record<string, string> = {
      email: String(formData.get("email") ?? ""),
    };
    const password = String(formData.get("password") ?? "").trim();
    if (password) payload.password = password;

    const update = await request(endpoint, {
      method: "PUT",
      body: JSON.stringify(payload),
    });

    if (update.status !== 200) {
      const body = await parseJson<ApiError>(update);
      setMessage(body.error?.message ?? dict.detail.updateFailed);
      return;
    }

    const updated = await parseJson<{ data: any }>(update);
    setRow(updated.data);
    setMessage(dict.common.saved);
  }

  if (!row) return <div className="panel">{dict.common.loading}</div>;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>
          {kind === "admin"
            ? dict.detail.adminUser
            : kind === "buyers"
              ? dict.detail.buyer
              : kind === "sellers"
                ? dict.detail.seller
                : dict.detail.appUser}
        </h2>
      </div>
      <pre className="json-box">{JSON.stringify(row, null, 2)}</pre>
      <form className="form-grid" onSubmit={onSave}>
        <label>
          {dict.auth.email}
          <input name="email" defaultValue={row.email} disabled={!isSuperAdmin} />
        </label>
        <label>
          {dict.detail.passwordOptional}
          <input name="password" type="password" disabled={!isSuperAdmin} />
        </label>
        <button className="primary" disabled={!isSuperAdmin} type="submit">{dict.actions.save}</button>
      </form>
      {!isSuperAdmin ? <p className="panel-meta">{dict.detail.readOnly}</p> : null}
      {message ? <div className="panel-note">{message}</div> : null}
    </section>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
