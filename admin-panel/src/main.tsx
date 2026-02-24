import "./styles.css";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
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
import { Room, RoomEvent, Track } from "livekit-client";
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
  return true;
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

function AppShell({
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
          <TopNavTabs pathname={location.pathname} dict={dict} />
        </div>
        <div className="navbar-actions">
          <ApiHealthBadge />
          <span className="role-chip">{adminRoleLabel(dict, admin.role)}</span>
          <span className="navbar-email">{admin.email}</span>
          <button className="ghost" onClick={onToggleLanguage} type="button">
            {dict.actions.language}
          </button>
          <button className="theme-toggle" onClick={onToggleDarkMode} type="button">
            {isDarkMode ? "☀" : "☾"}
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
        {location.pathname === "/app/livekit" ? <LiveKitPage language={language} /> : null}
        {location.pathname === "/app/livekit-demo" ? <LiveKitDemoPage language={language} /> : null}
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

function TopNavTabs({ pathname, dict }: { pathname: string; dict: Dictionary }) {
  const items = [
    { to: "/app/dashboard", active: pathname === "/app/dashboard", label: dict.menu.dashboard },
    { to: "/app/users", active: pathname.startsWith("/app/users"), label: dict.menu.appUsers },
    { to: "/app/buyers", active: pathname.startsWith("/app/buyers"), label: dict.menu.buyers },
    { to: "/app/sellers", active: pathname.startsWith("/app/sellers"), label: dict.menu.sellers },
    { to: "/app/admins", active: pathname.startsWith("/app/admins"), label: dict.menu.admins },
    { to: "/app/audit", active: pathname.startsWith("/app/audit"), label: dict.menu.audit },
    { to: "/app/livekit", active: pathname === "/app/livekit", label: dict.menu.livekit },
    { to: "/app/livekit-demo", active: pathname === "/app/livekit-demo", label: dict.menu.livekitDemo },
    { to: "/app/entities", active: pathname.startsWith("/app/entities"), label: dict.menu.dataExplorer },
  ];

  return (
    <nav className="nav">
      {items.map((item) => (
        <Link key={item.to} className={`nav-link ${item.active ? "is-active" : ""}`} to={item.to}>
          {item.label}
        </Link>
      ))}
    </nav>
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
  const metrics = [
    { key: "totalUsers", label: "TOTAL USERS", value: Number(data.totalUsers ?? 2) },
    { key: "activeUsers", label: "ACTIVE USERS", value: Number(data.activeUsers ?? 1) },
    { key: "disabledUsers", label: "DISABLED USERS", value: Number(data.disabledUsers ?? 1) },
    { key: "activeOrders", label: "ACTIVE ORDERS", value: Number(data.activeOrders ?? 0) },
    { key: "paymentPendingOrders", label: "PAYMENT PENDING ORDERS", value: Number(data.paymentPendingOrders ?? 0) },
    { key: "complianceQueueCount", label: "COMPLIANCE QUEUE COUNT", value: Number(data.complianceQueueCount ?? 0) },
    { key: "openDisputeCount", label: "OPEN DISPUTE COUNT", value: Number(data.openDisputeCount ?? 0) },
    { key: "updatedAt", label: "UPDATED AT", value: String(data.updatedAt ?? "2026-02-24T14:30:18.106Z") },
  ];

  const tableRows = [
    { label: "Total Users", value: String(metrics[0].value) },
    { label: "Active Users", value: String(metrics[1].value) },
    { label: "Disabled Users", value: String(metrics[2].value) },
    { label: "Active Orders", value: String(metrics[3].value) },
    { label: "Payment Pending Orders", value: String(metrics[4].value) },
    { label: "Compliance Queue Count", value: String(metrics[5].value) },
    { label: "Open Dispute Count", value: String(metrics[6].value) },
    { label: "Updated At", value: String(metrics[7].value) },
  ];

  return (
    <div className="app dashboard-view">
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
        {metrics.map((item) => (
          <StatCard key={item.key} label={item.label} value={item.value} />
        ))}
      </div>
      <section className="content-grid">
        <DataTableCard title={dict.dashboard.kpiSnapshot} metricLabel={dict.dashboard.metric} valueLabel={dict.dashboard.value} rows={tableRows} />
        <ActionCard title={dict.dashboard.quickActions} helperText={dict.dashboard.subtitle} dict={dict} />
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="card">
      <p className="card-label">{label}</p>
      <p className={`card-value ${/updated|date|time/i.test(label) ? "card-value-long" : ""}`}>{String(value)}</p>
    </article>
  );
}

function DataTableCard({
  title,
  metricLabel,
  valueLabel,
  rows,
}: {
  title: string;
  metricLabel: string;
  valueLabel: string;
  rows: Array<{ label: string; value: string }>;
}) {
  return (
    <article className="panel">
      <div className="panel-header">
        <h2>{title}</h2>
      </div>
      <div className="kpi-table">
        <div className="kpi-table-row kpi-table-head">
          <span>{metricLabel}</span>
          <span>{valueLabel}</span>
        </div>
        {rows.map((row) => (
          <div className="kpi-table-row" key={row.label}>
            <span>{row.label}</span>
            <span>{row.value}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

function ActionCard({ title, helperText, dict }: { title: string; helperText: string; dict: Dictionary }) {
  return (
    <article className="panel">
      <div className="panel-header">
        <h2>{title}</h2>
      </div>
      <div className="actions">
        <button className="primary" type="button">{dict.actions.openComplianceQueue}</button>
        <button className="ghost" type="button">{dict.actions.viewPaymentDisputes}</button>
        <button className="ghost" type="button">{dict.actions.inspectAppUsers}</button>
        <button className="ghost" type="button">{dict.actions.inspectAdminUsers}</button>
      </div>
      <div className="divider" />
      <p className="panel-note">{helperText}</p>
    </article>
  );
}

type UserKind = "app" | "buyers" | "sellers" | "admin";

function UsersPage({ kind, isSuperAdmin, language }: { kind: UserKind; isSuperAdmin: boolean; language: Language }) {
  const dict = DICTIONARIES[language];
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [drawerMode, setDrawerMode] = useState<"create" | "edit" | null>(null);
  const [editingRow, setEditingRow] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [isColumnsModalOpen, setIsColumnsModalOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
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
  const isDrawerOpen = drawerMode !== null;
  const createTitle =
    isAppScoped
      ? kind === "buyers"
        ? dict.users.createBuyer
        : kind === "sellers"
          ? dict.users.createSeller
          : dict.users.createAppUser
      : dict.users.createAdmin;

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
      ...(searchTerm ? { search: searchTerm } : {}),
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
  }, [filters.page, filters.pageSize, filters.sortBy, filters.sortDir, filters.status, filters.roleFilter, audience, searchTerm]);

  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed.length === 0) {
      setSearchTerm("");
      setFilters((prev) => ({ ...prev, page: 1 }));
      return;
    }
    if (trimmed.length < 3) return;

    const timer = window.setTimeout(() => {
      setSearchTerm(trimmed);
      setFilters((prev) => ({ ...prev, page: 1 }));
    }, 300);

    return () => window.clearTimeout(timer);
  }, [searchInput]);

  async function savePreferences() {
    const response = await request(`/v1/admin/table-preferences/${tableKey}`, {
      method: "PUT",
      body: JSON.stringify({ visibleColumns, columnOrder: visibleColumns }),
    });

    if (response.status !== 200) {
      setError(dict.users.preferencesFailed);
      return;
    }
    setIsColumnsModalOpen(false);
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSaving(true);
    const formData = new FormData(event.currentTarget);

    try {
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

      await loadRows();
      setDrawerMode(null);
      setEditingRow(null);
      setFormError(null);
      (event.currentTarget as HTMLFormElement).reset();
    } finally {
      setSaving(false);
    }
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

  function openCreateDrawer() {
    setFormError(null);
    setEditingRow(null);
    setDrawerMode("create");
  }

  function openEditDrawer(row: any) {
    setFormError(null);
    setEditingRow(row);
    setDrawerMode("edit");
  }

  function closeDrawer() {
    if (saving) return;
    setDrawerMode(null);
    setEditingRow(null);
    setFormError(null);
  }

  async function updateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingRow) return;
    setFormError(null);
    setSaving(true);

    try {
      const formData = new FormData(event.currentTarget);
      const payload: Record<string, string> = {
        email: String(formData.get("email") ?? "").trim(),
      };
      const password = String(formData.get("password") ?? "").trim();
      if (password) payload.password = password;

      if (!payload.email) {
        setFormError(dict.users.validationFailed);
        return;
      }

      const update = await request(`${endpoint}/${editingRow.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });

      if (update.status !== 200) {
        const body = await parseJson<ApiError>(update);
        setFormError(body.error?.message ?? dict.users.updateFailed);
        return;
      }

      await loadRows();
      closeDrawer();
    } finally {
      setSaving(false);
    }
  }

  const tableColumns = useMemo(() => {
    if (visibleColumns.length === 0) return fields;
    return visibleColumns;
  }, [fields, visibleColumns]);

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>{pageTitle}</h1>
        </div>
        <div className="topbar-actions">
          <input
            placeholder={dict.users.searchPlaceholder}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
          <button className="ghost" type="button" onClick={() => setIsColumnsModalOpen(true)}>
            {dict.users.visibleColumns}
          </button>
          <button className="primary" type="button" onClick={openCreateDrawer} disabled={!isSuperAdmin}>
            {dict.actions.create}
          </button>
        </div>
      </header>

      {error ? <div className="alert">{error}</div> : null}

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
                        className="ghost icon-btn"
                        type="button"
                        title={dict.actions.detail}
                        aria-label={dict.actions.detail}
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
                        <span aria-hidden="true">👁</span>
                        <span className="sr-only">{dict.actions.detail}</span>
                      </button>
                      {isSuperAdmin ? (
                        <>
                          <button
                            className="ghost icon-btn"
                            type="button"
                            title="Edit"
                            aria-label="Edit"
                            onClick={() => openEditDrawer(row)}
                          >
                            <span aria-hidden="true">✏️</span>
                            <span className="sr-only">Edit</span>
                          </button>
                          <button
                            className="ghost icon-btn"
                            type="button"
                            title={dict.actions.toggleStatus}
                            aria-label={dict.actions.toggleStatus}
                            onClick={() =>
                              patchUser(row.id, "status", {
                                status: row.is_active || row.status === "active" ? "disabled" : "active",
                              })
                            }
                          >
                            <span aria-hidden="true">⏻</span>
                            <span className="sr-only">{dict.actions.toggleStatus}</span>
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

      <div className={`drawer-overlay ${isDrawerOpen ? "is-open" : ""}`} onClick={closeDrawer}>
        <aside className={`form-drawer ${isDrawerOpen ? "is-open" : ""}`} onClick={(event) => event.stopPropagation()}>
          <div className="form-drawer-header">
            <h2>{drawerMode === "edit" ? "Edit User" : createTitle}</h2>
            <button className="ghost" type="button" onClick={closeDrawer} disabled={saving}>
              Close
            </button>
          </div>

          {!isSuperAdmin ? <p className="panel-meta">{dict.users.onlySuperAdmin}</p> : null}

          {drawerMode === "create" ? (
            <form className="drawer-form" onSubmit={createUser}>
              <label>
                {dict.auth.email}
                <input name="email" disabled={!isSuperAdmin || saving} />
              </label>
              <label>
                {dict.auth.password}
                <input name="password" type="password" disabled={!isSuperAdmin || saving} />
              </label>
              {isAppScoped ? (
                <>
                  <label>
                    {dict.users.displayName}
                    <input name="displayName" disabled={!isSuperAdmin || saving} />
                  </label>
                  {kind === "app" ? (
                    <label>
                      {dict.users.userType}
                      <select name="userType" disabled={!isSuperAdmin || saving}>
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
                  <select name="role" disabled={!isSuperAdmin || saving}>
                    <option value="admin">{dict.users.roleAdmin}</option>
                    <option value="super_admin">{dict.users.roleSuperAdmin}</option>
                  </select>
                </label>
              )}
              <button className="primary" type="submit" disabled={!isSuperAdmin || saving}>
                {saving ? "Saving..." : dict.actions.create}
              </button>
            </form>
          ) : null}

          {drawerMode === "edit" && editingRow ? (
            <form className="drawer-form" onSubmit={updateUser}>
              <label>
                {dict.auth.email}
                <input name="email" defaultValue={String(editingRow.email ?? "")} disabled={!isSuperAdmin || saving} />
              </label>
              <label>
                {dict.detail.passwordOptional}
                <input name="password" type="password" disabled={!isSuperAdmin || saving} />
              </label>
              <button className="primary" type="submit" disabled={!isSuperAdmin || saving}>
                {saving ? "Saving..." : dict.actions.save}
              </button>
            </form>
          ) : null}

          {formError ? <div className="alert">{formError}</div> : null}
        </aside>
      </div>

      <div className={`drawer-overlay ${isColumnsModalOpen ? "is-open" : ""}`} onClick={() => setIsColumnsModalOpen(false)}>
        <section className={`settings-modal ${isColumnsModalOpen ? "is-open" : ""}`} onClick={(event) => event.stopPropagation()}>
          <div className="form-drawer-header">
            <h2>{dict.users.visibleColumns}</h2>
            <button className="ghost" type="button" onClick={() => setIsColumnsModalOpen(false)}>
              Close
            </button>
          </div>
          <p className="panel-meta">{tableKey}</p>
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
          <button className="primary" type="button" onClick={savePreferences}>
            {dict.users.savePreferences}
          </button>
        </section>
      </div>
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

type LiveKitTokenResponse = {
  data?: {
    roomName: string;
    participantIdentity: string;
    wsUrl: string;
    token: string;
    preview: {
      iat: string | null;
      exp: string | null;
      claims: Record<string, unknown>;
    } | null;
  };
} & ApiError;

type LiveKitSessionStartResponse = {
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
      dispatch: {
        endpoint: string;
        ok: boolean;
        status: number;
        body: unknown;
      } | null;
      preview?: {
        iat: string | null;
        exp: string | null;
        claims: Record<string, unknown>;
      } | null;
    };
  };
} & ApiError;

function LiveKitPage({ language }: { language: Language }) {
  const dict = DICTIONARIES[language];
  const [status, setStatus] = useState<{
    configured: boolean;
    wsUrl: string | null;
    aiServerUrl: string | null;
    aiServerJoinPath: string;
    hasApiKey: boolean;
    hasApiSecret: boolean;
    hasAiSharedSecret: boolean;
    defaultTtlSeconds: number;
    agentIdentityDefault: string;
  } | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<LiveKitTokenResponse["data"] | null>(null);
  const [history, setHistory] = useState<Array<{ kind: "user" | "agent" | "dispatch-agent"; at: string; room: string; identity: string }>>([]);

  const [roomName, setRoomName] = useState("coziyoo-room");
  const [participantIdentity, setParticipantIdentity] = useState("");
  const [participantName, setParticipantName] = useState("");
  const [metadata, setMetadata] = useState("");
  const [ttlSeconds, setTtlSeconds] = useState("3600");
  const [canPublish, setCanPublish] = useState(true);
  const [canSubscribe, setCanSubscribe] = useState(true);
  const [canPublishData, setCanPublishData] = useState(true);

  async function loadStatus() {
    setStatusError(null);
    const response = await request("/v1/admin/livekit/status");
    const body = await parseJson<{ data?: LiveKitPageStatus } & ApiError>(response);
    if (response.status !== 200 || !body.data) {
      setStatusError(body.error?.message ?? dict.livekit.statusLoadFailed);
      return;
    }
    setStatus(body.data);
  }

  type LiveKitPageStatus = {
    configured: boolean;
    wsUrl: string | null;
    aiServerUrl: string | null;
    aiServerJoinPath: string;
    hasApiKey: boolean;
    hasApiSecret: boolean;
    hasAiSharedSecret: boolean;
    defaultTtlSeconds: number;
    agentIdentityDefault: string;
  };

  useEffect(() => {
    loadStatus().catch(() => setStatusError(dict.livekit.statusRequestFailed));
  }, [dict.livekit.statusRequestFailed]);

  async function createToken(kind: "user" | "agent" | "dispatch-agent") {
    if (!roomName.trim()) {
      setFormError(dict.livekit.roomRequired);
      return;
    }

    setSaving(true);
    setFormError(null);

    const endpoint =
      kind === "user"
        ? "/v1/admin/livekit/token/user"
        : kind === "agent"
          ? "/v1/admin/livekit/token/agent"
          : "/v1/admin/livekit/dispatch/agent";
    const payload: Record<string, unknown> = {
      roomName: roomName.trim(),
      ...(participantIdentity.trim() ? { participantIdentity: participantIdentity.trim() } : {}),
      ...(participantName.trim() ? { participantName: participantName.trim() } : {}),
      ...(metadata.trim() ? { metadata: metadata.trim() } : {}),
      ...(ttlSeconds.trim() ? { ttlSeconds: Number(ttlSeconds) } : {}),
    };

    if (kind === "user") {
      payload.canPublish = canPublish;
      payload.canSubscribe = canSubscribe;
      payload.canPublishData = canPublishData;
    }

    try {
      const response = await request(endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const body = await parseJson<LiveKitTokenResponse>(response);
      if (response.status !== 201 || !body.data) {
        setFormError(body.error?.message ?? dict.livekit.tokenCreateFailed);
        return;
      }

      setResult(body.data);
      setHistory((prev) => [
        { kind, at: new Date().toISOString(), room: body.data!.roomName, identity: body.data!.participantIdentity },
        ...prev.slice(0, 9),
      ]);
    } catch {
      setFormError(dict.livekit.tokenRequestFailed);
    } finally {
      setSaving(false);
    }
  }

  async function copyToken() {
    if (!result?.token) return;
    await navigator.clipboard.writeText(result.token);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <p className="eyebrow">{dict.livekit.eyebrow}</p>
          <h1>{dict.livekit.title}</h1>
          <p className="subtext">{dict.livekit.subtitle}</p>
        </div>
        <div className="topbar-actions">
          <button className="ghost" type="button" onClick={() => loadStatus()}>{dict.actions.refresh}</button>
        </div>
      </header>

      {statusError ? <div className="alert">{statusError}</div> : null}

      <section className="panel">
        <div className="panel-header">
          <h2>{dict.livekit.statusTitle}</h2>
        </div>
        <div className="table">
          <div className="table-row table-row-kpi"><span>{dict.livekit.configured}</span><span>{status?.configured ? dict.common.yes : dict.common.no}</span></div>
          <div className="table-row table-row-kpi"><span>{dict.livekit.wsUrl}</span><span>{status?.wsUrl ?? "-"}</span></div>
          <div className="table-row table-row-kpi"><span>{dict.livekit.aiServerUrl}</span><span>{status?.aiServerUrl ?? "-"}</span></div>
          <div className="table-row table-row-kpi"><span>{dict.livekit.aiServerJoinPath}</span><span>{status?.aiServerJoinPath ?? "-"}</span></div>
          <div className="table-row table-row-kpi"><span>LIVEKIT_API_KEY</span><span>{status?.hasApiKey ? dict.common.yes : dict.common.no}</span></div>
          <div className="table-row table-row-kpi"><span>LIVEKIT_API_SECRET</span><span>{status?.hasApiSecret ? dict.common.yes : dict.common.no}</span></div>
          <div className="table-row table-row-kpi"><span>AI_SERVER_SHARED_SECRET</span><span>{status?.hasAiSharedSecret ? dict.common.yes : dict.common.no}</span></div>
          <div className="table-row table-row-kpi"><span>{dict.livekit.defaultTtl}</span><span>{String(status?.defaultTtlSeconds ?? "-")}</span></div>
          <div className="table-row table-row-kpi"><span>{dict.livekit.defaultAgentIdentity}</span><span>{status?.agentIdentityDefault ?? "-"}</span></div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>{dict.livekit.tokenBuilder}</h2>
        </div>
        <div className="form-grid">
          <label>
            {dict.livekit.roomName}
            <input value={roomName} onChange={(event) => setRoomName(event.target.value)} />
          </label>
          <label>
            {dict.livekit.participantIdentity}
            <input value={participantIdentity} onChange={(event) => setParticipantIdentity(event.target.value)} />
          </label>
          <label>
            {dict.livekit.participantName}
            <input value={participantName} onChange={(event) => setParticipantName(event.target.value)} />
          </label>
          <label>
            {dict.livekit.ttlSeconds}
            <input value={ttlSeconds} onChange={(event) => setTtlSeconds(event.target.value)} />
          </label>
        </div>
        <label>
          {dict.livekit.metadata}
          <textarea rows={3} value={metadata} onChange={(event) => setMetadata(event.target.value)} />
        </label>
        <div className="checkbox-grid">
          <label>
            <input type="checkbox" checked={canPublish} onChange={(event) => setCanPublish(event.target.checked)} />
            canPublish
          </label>
          <label>
            <input type="checkbox" checked={canSubscribe} onChange={(event) => setCanSubscribe(event.target.checked)} />
            canSubscribe
          </label>
          <label>
            <input type="checkbox" checked={canPublishData} onChange={(event) => setCanPublishData(event.target.checked)} />
            canPublishData
          </label>
        </div>
        {formError ? <div className="alert">{formError}</div> : null}
        <div className="topbar-actions">
          <button className="primary" type="button" disabled={saving} onClick={() => createToken("user")}>
            {dict.livekit.createUserToken}
          </button>
          <button className="ghost" type="button" disabled={saving} onClick={() => createToken("agent")}>
            {dict.livekit.createAgentToken}
          </button>
          <button className="ghost" type="button" disabled={saving} onClick={() => createToken("dispatch-agent")}>
            {dict.livekit.dispatchAgentToken}
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>{dict.livekit.lastResult}</h2>
          <button className="ghost" type="button" onClick={() => copyToken()} disabled={!result?.token}>
            {dict.livekit.copyToken}
          </button>
        </div>
        <pre className="json-box">{result ? JSON.stringify(result, null, 2) : dict.livekit.noResult}</pre>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>{dict.livekit.history}</h2>
        </div>
        {history.length === 0 ? (
          <p className="panel-meta">{dict.livekit.noHistory}</p>
        ) : (
          <div className="table">
            <div className="table-row table-head table-row-kpi">
              <span>{dict.livekit.tokenType}</span>
              <span>{dict.livekit.historyDetail}</span>
            </div>
            {history.map((item, index) => (
              <div className="table-row table-row-kpi" key={`${item.at}-${index}`}>
                <span>{item.kind}</span>
                <span>{`${item.at} | room=${item.room} | identity=${item.identity}`}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function normalizeLiveKitWsUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("wss://") || trimmed.startsWith("ws://")) return trimmed;
  if (trimmed.startsWith("https://")) return `wss://${trimmed.slice("https://".length).replace(/\/+$/, "")}`;
  if (trimmed.startsWith("http://")) return `ws://${trimmed.slice("http://".length).replace(/\/+$/, "")}`;
  return trimmed;
}

function LiveKitDemoPage({ language }: { language: Language }) {
  const dict = DICTIONARIES[language];
  const roomRef = useRef<Room | null>(null);
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteMediaRef = useRef<HTMLDivElement | null>(null);
  const [roomName, setRoomName] = useState("coziyoo-room");
  const [participantIdentity, setParticipantIdentity] = useState("");
  const [participantName, setParticipantName] = useState("");
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<LiveKitSessionStartResponse["data"] | null>(null);
  const [remoteCount, setRemoteCount] = useState(0);
  const [chatMessage, setChatMessage] = useState("");
  const [chatMessages, setChatMessages] = useState<Array<{ at: string; from: string; text: string }>>([]);

  function clearRemoteMedia() {
    const holder = remoteMediaRef.current;
    if (!holder) return;
    holder.innerHTML = "";
    setRemoteCount(0);
  }

  function detachLocalVideo() {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
  }

  async function disconnectRoom() {
    const room = roomRef.current;
    if (!room) return;

    room.disconnect();
    roomRef.current = null;
    detachLocalVideo();
    clearRemoteMedia();
    setConnected(false);
    setChatMessages([]);
  }

  useEffect(() => {
    return () => {
      disconnectRoom().catch(() => undefined);
    };
  }, []);

  async function connectRoom() {
    if (!roomName.trim()) {
      setError(dict.livekit.roomRequired);
      return;
    }

    setError(null);
    setConnecting(true);

    try {
      if (roomRef.current) {
        await disconnectRoom();
      }

      const response = await request("/v1/admin/livekit/session/start", {
        method: "POST",
        body: JSON.stringify({
          roomName: roomName.trim(),
          ...(participantIdentity.trim() ? { participantIdentity: participantIdentity.trim() } : {}),
          ...(participantName.trim() ? { participantName: participantName.trim() } : {}),
        }),
      });

      const body = await parseJson<LiveKitSessionStartResponse>(response);
      if (response.status !== 201 || !body.data) {
        setError(body.error?.message ?? dict.livekit.tokenCreateFailed);
        return;
      }
      setLastResult(body.data);

      const room = new Room();
      roomRef.current = room;

      room.on(RoomEvent.ParticipantConnected, () => {
        setRemoteCount(room.remoteParticipants.size);
      });
      room.on(RoomEvent.ParticipantDisconnected, () => {
        setRemoteCount(room.remoteParticipants.size);
      });

      room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        const holder = remoteMediaRef.current;
        if (!holder) return;
        const key = `${participant.sid}:${publication.trackSid}`;

        const card = document.createElement("article");
        card.className = "livekit-remote-card";
        card.dataset.trackKey = key;

        const label = document.createElement("p");
        label.className = "panel-meta";
        label.textContent = `${participant.identity} (${track.kind})`;
        card.appendChild(label);

        if (track.kind === Track.Kind.Video) {
          const video = document.createElement("video");
          video.autoplay = true;
          video.playsInline = true;
          video.className = "livekit-video";
          track.attach(video);
          card.appendChild(video);
        } else if (track.kind === Track.Kind.Audio) {
          const audio = document.createElement("audio");
          audio.autoplay = true;
          track.attach(audio);
          card.appendChild(audio);
        }

        holder.appendChild(card);
      });

      room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
        const holder = remoteMediaRef.current;
        if (!holder) return;
        const key = `${participant.sid}:${publication.trackSid}`;
        const card = holder.querySelector(`[data-track-key="${key}"]`);
        if (card) card.remove();
        track.detach();
      });

      room.on(RoomEvent.Disconnected, () => {
        setConnected(false);
      });
      room.on(RoomEvent.DataReceived, (payload, participant) => {
        try {
          const raw = new TextDecoder().decode(payload);
          const parsed = JSON.parse(raw) as { text?: string; ts?: string };
          const text = String(parsed.text ?? "").trim();
          if (!text) return;
          setChatMessages((prev) => [
            ...prev,
            {
              at: parsed.ts ?? new Date().toISOString(),
              from: participant?.identity ?? "unknown",
              text,
            },
          ]);
        } catch {
          const fallback = new TextDecoder().decode(payload);
          if (!fallback.trim()) return;
          setChatMessages((prev) => [
            ...prev,
            {
              at: new Date().toISOString(),
              from: participant?.identity ?? "unknown",
              text: fallback,
            },
          ]);
        }
      });

      const wsUrl = normalizeLiveKitWsUrl(body.data.wsUrl);
      await room.connect(wsUrl, body.data.user.token);

      setConnected(true);
      setRemoteCount(room.remoteParticipants.size);

      await room.localParticipant.setCameraEnabled(cameraEnabled);
      await room.localParticipant.setMicrophoneEnabled(micEnabled);

      const localVideoPublication = [...room.localParticipant.videoTrackPublications.values()].find((pub) => Boolean(pub.track));
      if (localVideoPublication?.track && localVideoRef.current) {
        localVideoPublication.track.attach(localVideoRef.current);
      }

      chatInputRef.current?.focus();
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : dict.livekit.demoConnectFailed);
    } finally {
      setConnecting(false);
    }
  }

  async function sendChatMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const room = roomRef.current;
    if (!room || !connected) return;

    const text = chatMessage.trim();
    if (!text) return;

    const payload = {
      text,
      ts: new Date().toISOString(),
    };
    const encoded = new TextEncoder().encode(JSON.stringify(payload));
    await room.localParticipant.publishData(encoded, { reliable: true });

    setChatMessages((prev) => [
      ...prev,
      {
        at: payload.ts,
        from: room.localParticipant.identity,
        text,
      },
    ]);
    setChatMessage("");
    chatInputRef.current?.focus();
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <p className="eyebrow">{dict.livekit.demoEyebrow}</p>
          <h1>{dict.livekit.demoTitle}</h1>
          <p className="subtext">{dict.livekit.demoSubtitle}</p>
        </div>
        <div className="topbar-actions">
          <span className="panel-meta">{connected ? dict.livekit.connected : dict.livekit.notConnected}</span>
          <span className="panel-meta">{`${dict.livekit.remoteParticipants}: ${remoteCount}`}</span>
        </div>
      </header>

      <section className="panel">
        <div className="form-grid">
          <label>
            {dict.livekit.roomName}
            <input value={roomName} onChange={(event) => setRoomName(event.target.value)} />
          </label>
          <label>
            {dict.livekit.participantIdentity}
            <input value={participantIdentity} onChange={(event) => setParticipantIdentity(event.target.value)} />
          </label>
          <label>
            {dict.livekit.participantName}
            <input value={participantName} onChange={(event) => setParticipantName(event.target.value)} />
          </label>
        </div>

        <div className="checkbox-grid">
          <label>
            <input type="checkbox" checked={cameraEnabled} onChange={(event) => setCameraEnabled(event.target.checked)} />
            {dict.livekit.camera}
          </label>
          <label>
            <input type="checkbox" checked={micEnabled} onChange={(event) => setMicEnabled(event.target.checked)} />
            {dict.livekit.microphone}
          </label>
        </div>

        {error ? <div className="alert">{error}</div> : null}
        <div className="topbar-actions">
          <button className="primary" type="button" onClick={() => connectRoom()} disabled={connecting || connected}>
            {connecting ? dict.livekit.connecting : dict.livekit.connectDemo}
          </button>
          <button className="ghost" type="button" onClick={() => disconnectRoom()} disabled={!connected && !connecting}>
            {dict.livekit.disconnectDemo}
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>{dict.livekit.localPreview}</h2>
        </div>
        <video ref={localVideoRef} className="livekit-video" autoPlay playsInline muted />
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>{dict.livekit.remoteParticipants}</h2>
        </div>
        <div ref={remoteMediaRef} className="livekit-remote-grid" />
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>{dict.livekit.chatTitle}</h2>
          <span className="panel-meta">{connected ? dict.livekit.chatConnected : dict.livekit.chatDisconnected}</span>
        </div>
        <div className="livekit-chat-log">
          {chatMessages.length === 0 ? (
            <p className="panel-meta">{dict.livekit.chatEmpty}</p>
          ) : (
            chatMessages.map((message, index) => (
              <article key={`${message.at}-${index}`} className="livekit-chat-item">
                <p className="panel-meta">{`${message.from} • ${message.at}`}</p>
                <p>{message.text}</p>
              </article>
            ))
          )}
        </div>
        <form className="livekit-chat-form" onSubmit={sendChatMessage}>
          <input
            ref={chatInputRef}
            value={chatMessage}
            onChange={(e) => setChatMessage(e.target.value)}
            placeholder={dict.livekit.chatPlaceholder}
            disabled={!connected}
          />
          <button className="primary" type="submit" disabled={!connected || !chatMessage.trim()}>
            {dict.livekit.chatSend}
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>{dict.livekit.lastResult}</h2>
        </div>
        <pre className="json-box">{lastResult ? JSON.stringify(lastResult, null, 2) : dict.livekit.noResult}</pre>
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
