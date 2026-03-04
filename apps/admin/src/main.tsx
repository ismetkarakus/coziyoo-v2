import "./styles.css";
import { FormEvent, Fragment, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  HashRouter,
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
import type {
  BuyerCancellationRow,
  BuyerContactInfo,
  BuyerDetail,
  BuyerLoginLocation,
  BuyerOrderRow,
  BuyerPagination,
  BuyerReviewRow,
  BuyerSummaryMetrics,
} from "./types/buyer";

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
const BUILD_COMMIT = (import.meta.env.VITE_GIT_COMMIT as string | undefined) ?? "unknown";
const TOKEN_KEY = "coziyoo_admin_tokens";
const ADMIN_KEY = "coziyoo_admin_me";
const LANGUAGE_KEY = "admin_language";

type Language = "tr" | "en";
type Dictionary = typeof en;
type SellerDetailTab = "general" | "foods" | "orders" | "wallet" | "identity" | "legal" | "retention" | "security" | "raw";
type BuyerDetailTab = "orders" | "payments" | "complaints" | "reviews" | "activity" | "notes" | "raw";
type BuyerSmartFilterKey =
  | "daily_buyer"
  | "top_revenue"
  | "suspicious_login"
  | "same_ip_multi_account"
  | "risky_seller_complaints"
  | "complainers";
type SellerSmartFilterKey =
  | "login_anomaly"
  | "pending_approvals"
  | "missing_documents"
  | "suspicious_logins"
  | "top_selling_foods"
  | "top_revenue"
  | "performance_drop"
  | "urgent_action"
  | "complainer_sellers";

type SellerFoodRow = {
  id: string;
  name: string;
  code: string;
  cardSummary: string | null;
  description: string | null;
  recipe: string | null;
  ingredients: string | null;
  price: number;
  imageUrl: string | null;
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
};

type AdminLotLifecycleStatus = "on_sale" | "planned" | "expired" | "depleted" | "recalled" | "discarded" | "open";
type AdminLotStatus = "open" | "locked" | "depleted" | "recalled" | "discarded" | "expired";

type AdminLotRow = {
  id: string;
  seller_id: string;
  food_id: string;
  lot_number: string;
  produced_at: string;
  sale_starts_at: string;
  sale_ends_at: string;
  use_by: string | null;
  best_before: string | null;
  recipe_snapshot: string | null;
  ingredients_snapshot_json: unknown;
  allergens_snapshot_json: unknown;
  quantity_produced: number;
  quantity_available: number;
  status: AdminLotStatus;
  lifecycle_status: AdminLotLifecycleStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type AdminLotOrderRow = {
  order_id: string;
  status: string;
  created_at: string;
  buyer_id: string;
  seller_id: string;
  quantity_allocated: number;
};

type FoodLotDiff = {
  recipeChanged: boolean;
  ingredientsChanged: boolean;
  allergensChanged: boolean;
  hasMissingSnapshot: boolean;
};

const BUYER_SMART_FILTER_ITEMS: Array<{ key: BuyerSmartFilterKey; label: string; icon: string }> = [
  { key: "daily_buyer", label: "Gunun Alicisi", icon: "☀" },
  { key: "top_revenue", label: "En Fazla Ciro", icon: "₺" },
  { key: "suspicious_login", label: "Supheli Giris", icon: "◉" },
  { key: "same_ip_multi_account", label: "Ayni IP'de Iki Giris", icon: "⌁" },
  { key: "risky_seller_complaints", label: "Riskli Satici Sikayet", icon: "⚠" },
  { key: "complainers", label: "Sikayetciler", icon: "✉" },
];
const SELLER_SMART_FILTER_ITEMS: Array<{ key: SellerSmartFilterKey; label: string; icon: string }> = [
  { key: "login_anomaly", label: "Tüm Kayıtlar", icon: "☰" },
  { key: "pending_approvals", label: "Onay Bekleyenler", icon: "☑" },
  { key: "missing_documents", label: "Eksik Belgesi Olanlar", icon: "⚠" },
  { key: "suspicious_logins", label: "Şüpheli Girişler", icon: "◉" },
  { key: "top_selling_foods", label: "En Çok Satan Yemekler", icon: "🍽" },
  { key: "top_revenue", label: "En Çok Ciro Yapan", icon: "₺" },
  { key: "performance_drop", label: "Düşen Performans", icon: "◔" },
  { key: "urgent_action", label: "Acil Müdahale", icon: "⚑" },
  { key: "complainer_sellers", label: "Şikayetli Satıcılar", icon: "✉" },
];

const DICTIONARIES: Record<Language, Dictionary> = {
  en,
  tr,
};

function resolveSellerDetailTab(value: string | null | undefined): SellerDetailTab {
  if (value === "general") return "general";
  if (value === "foods") return "foods";
  if (value === "orders") return "orders";
  if (value === "wallet") return "wallet";
  if (value === "legal") return "legal";
  if (value === "retention") return "retention";
  if (value === "security") return "security";
  if (value === "raw") return "raw";
  return "identity";
}

function resolveBuyerDetailTab(value: string | null | undefined): BuyerDetailTab {
  if (value === "payments") return "payments";
  if (value === "complaints") return "complaints";
  if (value === "reviews") return "reviews";
  if (value === "activity") return "activity";
  if (value === "notes") return "notes";
  if (value === "raw") return "raw";
  return "orders";
}

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

function formatTableHeader(column: string): string {
  if (column.toLowerCase() === "image_url") return "image";
  return column.replace(/_/g, " ");
}

function toDisplayId(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (!text) return "-";
  return text.length > 10 ? `${text.slice(0, 10)}…` : text;
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

let refreshInFlight: Promise<boolean> | null = null;

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
    const refreshed = await refreshTokenSerialized(tokens.refreshToken);
    if (refreshed) {
      return request(path, init, false);
    }
  }

  return response;
}

async function refreshTokenSerialized(refreshTokenValue: string): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = refreshToken(refreshTokenValue).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
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

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim().toLowerCase();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((key) => `${key}:${stableStringify(obj[key])}`).join(",")}}`;
  }
  return String(value);
}

function lotSnapshotMissing(lot: AdminLotRow): boolean {
  return !lot.recipe_snapshot || lot.ingredients_snapshot_json == null || lot.allergens_snapshot_json == null;
}

function computeFoodLotDiff(params: {
  foodRecipe: string | null | undefined;
  foodIngredients: unknown;
  foodAllergens: unknown;
  lot: AdminLotRow;
}): FoodLotDiff {
  const recipeChanged =
    stableStringify(params.foodRecipe) !== stableStringify(params.lot.recipe_snapshot);
  const ingredientsChanged = params.foodIngredients === undefined
    ? false
    : stableStringify(params.foodIngredients) !== stableStringify(params.lot.ingredients_snapshot_json);
  const allergensChanged = params.foodAllergens === undefined
    ? false
    : stableStringify(params.foodAllergens) !== stableStringify(params.lot.allergens_snapshot_json);
  return {
    recipeChanged,
    ingredientsChanged,
    allergensChanged,
    hasMissingSnapshot: lotSnapshotMissing(params.lot),
  };
}

function lotLifecycleLabel(status: AdminLotLifecycleStatus, language: Language): string {
  if (language === "tr") {
    if (status === "on_sale") return "Satışta";
    if (status === "planned") return "Planlı";
    if (status === "expired") return "Süresi Geçti";
    if (status === "depleted") return "Tükendi";
    if (status === "recalled") return "Geri Çağrıldı";
    if (status === "discarded") return "İmha Edildi";
    return "Açık";
  }
  if (status === "on_sale") return "On Sale";
  if (status === "planned") return "Planned";
  if (status === "expired") return "Expired";
  if (status === "depleted") return "Depleted";
  if (status === "recalled") return "Recalled";
  if (status === "discarded") return "Discarded";
  return "Open";
}

function lotLifecycleClass(status: AdminLotLifecycleStatus): string {
  if (status === "on_sale") return "is-success";
  if (status === "planned") return "is-warning";
  if (status === "expired" || status === "depleted") return "is-disabled";
  if (status === "recalled" || status === "discarded") return "is-danger";
  return "is-neutral";
}

async function fetchAllAdminLots(filters: { sellerId?: string; foodId?: string }): Promise<AdminLotRow[]> {
  const rows: AdminLotRow[] = [];
  let page = 1;
  while (true) {
    const query = new URLSearchParams({
      page: String(page),
      pageSize: "100",
      ...(filters.sellerId ? { sellerId: filters.sellerId } : {}),
      ...(filters.foodId ? { foodId: filters.foodId } : {}),
    });
    const response = await request(`/v1/admin/lots?${query.toString()}`);
    if (response.status !== 200) {
      const body = await parseJson<ApiError>(response);
      throw new Error(body.error?.message ?? "LOTS_FETCH_FAILED");
    }
    const body = await parseJson<{
      data: AdminLotRow[];
      pagination?: { totalPages?: number };
    }>(response);
    rows.push(...(body.data ?? []));
    const totalPages = Number(body.pagination?.totalPages ?? 1);
    if (page >= totalPages) break;
    page += 1;
  }
  return rows;
}

async function postJsonWith415Fallback(path: string, payload: unknown): Promise<Response> {
  const asJson = JSON.stringify(payload);

  const primary = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: asJson,
  });
  if (primary.status !== 415) return primary;

  // Some proxy/client chains can mutate JSON content-type unexpectedly.
  // API accepts text/plain JSON too, so retry with a fallback media type.
  return fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "text/plain; charset=utf-8", accept: "application/json" },
    body: asJson,
  });
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
            </div>
          </div>
          <TopNavTabs pathname={location.pathname} dict={dict} isSuperAdmin={isSuperAdmin} language={language} />
        </div>
        <div className="navbar-actions">
          <ApiHealthBadge />
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
        {location.pathname === "/app/orders" ? <RecordsPage language={language} tableKey="orders" /> : null}
        {location.pathname === "/app/foods" ? <FoodsLotsPage language={language} /> : null}
        {location.pathname === "/app/admins" ? <UsersPage kind="admin" isSuperAdmin={isSuperAdmin} language={language} /> : null}
        {location.pathname === "/app/investigation" ? <InvestigationPage language={language} /> : null}
        {location.pathname === "/app/audit" ? <AuditPage language={language} /> : null}
        {location.pathname === "/app/api-tokens" ? <ApiTokensPage language={language} isSuperAdmin={isSuperAdmin} /> : null}
        {location.pathname === "/app/compliance-documents" ? <ComplianceDocumentsPage language={language} isSuperAdmin={isSuperAdmin} /> : null}
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

function TopNavTabs({
  pathname,
  dict,
  isSuperAdmin,
  language,
}: {
  pathname: string;
  dict: Dictionary;
  isSuperAdmin: boolean;
  language: Language;
}) {
  const items = [
    { to: "/app/dashboard", active: pathname === "/app/dashboard", label: dict.menu.dashboard },
    { to: "/app/buyers", active: pathname.startsWith("/app/buyers"), label: dict.menu.buyers },
    { to: "/app/sellers", active: pathname.startsWith("/app/sellers"), label: dict.menu.sellers },
    { to: "/app/orders", active: pathname.startsWith("/app/orders"), label: dict.menu.orders },
    { to: "/app/foods", active: pathname.startsWith("/app/foods"), label: dict.menu.foods },
    { to: "/app/investigation", active: pathname.startsWith("/app/investigation"), label: dict.menu.investigation },
  ];
  const managementItems = [
    { to: "/app/users", active: pathname.startsWith("/app/users"), label: dict.menu.appUsers },
    { to: "/app/admins", active: pathname.startsWith("/app/admins"), label: dict.menu.admins },
    { to: "/app/compliance-documents", active: pathname.startsWith("/app/compliance-documents"), label: dict.menu.complianceDocuments },
    { to: "/app/api-tokens", active: pathname.startsWith("/app/api-tokens"), label: dict.menu.apiTokens },
    { to: "/app/livekit", active: pathname === "/app/livekit", label: dict.menu.livekit },
    { to: "/app/livekit-demo", active: pathname === "/app/livekit-demo", label: dict.menu.livekitDemo },
    { to: "/app/audit", active: pathname.startsWith("/app/audit"), label: dict.menu.audit },
    { to: "/app/entities", active: pathname.startsWith("/app/entities"), label: dict.menu.dataExplorer },
  ];
  const isManagementActive = managementItems.some((item) => item.active);
  const [isManagementOpen, setIsManagementOpen] = useState(isManagementActive);
  const [isCompactNavOpen, setIsCompactNavOpen] = useState(false);
  const [isResettingDb, setIsResettingDb] = useState(false);
  const [isSeedingDemoData, setIsSeedingDemoData] = useState(false);
  const [gitCommit, setGitCommit] = useState<string>("unknown");
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setIsManagementOpen(isManagementActive);
  }, [isManagementActive]);

  useEffect(() => {
    setIsCompactNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    request("/v1/admin/system/version")
      .then(async (response) => {
        if (response.status !== 200) return;
        const body = await parseJson<{ data?: { commit?: string } }>(response);
        const commit = body.data?.commit?.trim();
        if (commit) setGitCommit(commit);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) {
        setIsManagementOpen(false);
        setIsCompactNavOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsManagementOpen(false);
        setIsCompactNavOpen(false);
      }
    };

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  async function resetDatabaseFromAdminMenu() {
    if (!isSuperAdmin || isResettingDb) return;

    const firstConfirm = window.confirm(
      language === "tr"
        ? "Bu işlem veritabanındaki tüm kayıtları siler ve şemayı baştan kurar. Devam edilsin mi?"
        : "This action deletes all records and reinitializes the schema. Continue?"
    );
    if (!firstConfirm) return;

    const promptText = window.prompt(
      language === "tr" ? 'Onaylamak için "RESET DATABASE" yazın:' : 'Type "RESET DATABASE" to confirm:'
    );
    if (promptText !== "RESET DATABASE") {
      window.alert(language === "tr" ? "Doğrulama metni eşleşmedi. İşlem iptal edildi." : "Confirmation text mismatch. Operation cancelled.");
      return;
    }

    try {
      setIsResettingDb(true);
      const response = await request("/v1/admin/system/reset-database", {
        method: "POST",
        body: JSON.stringify({ confirmText: "RESET DATABASE" }),
      });
      const body = await parseJson<ApiError & { data?: { message?: string } }>(response);
      if (response.status !== 200) {
        window.alert(body.error?.message ?? (language === "tr" ? "Veritabanı sıfırlama başarısız." : "Database reset failed."));
        return;
      }
      window.alert(body.data?.message ?? (language === "tr" ? "Veritabanı sıfırlandı." : "Database reset complete."));
      window.location.reload();
    } catch {
      window.alert(language === "tr" ? "Veritabanı sıfırlama isteği başarısız." : "Database reset request failed.");
    } finally {
      setIsResettingDb(false);
      setIsManagementOpen(false);
    }
  }

  async function seedDemoDataFromAdminMenu() {
    if (!isSuperAdmin || isSeedingDemoData) return;

    const firstConfirm = window.confirm(
      language === "tr"
        ? "Bu işlem demo alıcı, satıcı, yemek ve sipariş verisi ekler. Devam edilsin mi?"
        : "This action seeds demo buyer, seller, food, and order data. Continue?"
    );
    if (!firstConfirm) return;

    const promptText = window.prompt(
      language === "tr" ? 'Onaylamak için "SEED DEMO DATA" yazın:' : 'Type "SEED DEMO DATA" to confirm:'
    );
    if (promptText !== "SEED DEMO DATA") {
      window.alert(language === "tr" ? "Doğrulama metni eşleşmedi. İşlem iptal edildi." : "Confirmation text mismatch. Operation cancelled.");
      return;
    }

    try {
      setIsSeedingDemoData(true);
      const response = await request("/v1/admin/system/seed-demo-data", {
        method: "POST",
        body: JSON.stringify({ confirmText: "SEED DEMO DATA" }),
      });
      const body = await parseJson<ApiError & { data?: { message?: string; sellerEmail?: string; buyerEmail?: string; defaultPassword?: string } }>(response);
      if (response.status !== 200) {
        window.alert(body.error?.message ?? (language === "tr" ? "Demo veri ekleme başarısız." : "Demo data seed failed."));
        return;
      }

      const sellerEmail = body.data?.sellerEmail ?? "demo.seller@coziyoo.local";
      const buyerEmail = body.data?.buyerEmail ?? "demo.buyer@coziyoo.local";
      const password = body.data?.defaultPassword ?? "Demo12345!";
      window.alert(
        language === "tr"
          ? `Demo veriler eklendi.\nSatici: ${sellerEmail}\nAlici: ${buyerEmail}\nSifre: ${password}`
          : `Demo data seeded.\nSeller: ${sellerEmail}\nBuyer: ${buyerEmail}\nPassword: ${password}`
      );
      window.location.reload();
    } catch {
      window.alert(language === "tr" ? "Demo veri isteği başarısız." : "Demo seed request failed.");
    } finally {
      setIsSeedingDemoData(false);
      setIsManagementOpen(false);
    }
  }

  return (
    <div className="nav-wrap" ref={menuRef}>
      <button
        className={`nav-hamburger ${isCompactNavOpen ? "is-active" : ""}`}
        type="button"
        aria-label={language === "tr" ? "Menüyü aç/kapat" : "Toggle menu"}
        aria-expanded={isCompactNavOpen}
        onClick={() => setIsCompactNavOpen((open) => !open)}
      >
        <span aria-hidden="true">{isCompactNavOpen ? "✕" : "☰"}</span>
      </button>
      <nav className={`nav ${isCompactNavOpen ? "is-open" : ""}`}>
        {items.map((item) => (
          <Link
            key={item.to}
            className={`nav-link ${item.active ? "is-active" : ""}`}
            to={item.to}
            onClick={() => {
              setIsManagementOpen(false);
              setIsCompactNavOpen(false);
            }}
          >
            {item.label}
          </Link>
        ))}
        <button
          className={`nav-link nav-link-button ${isManagementActive ? "is-active" : ""}`}
          onClick={() => {
            setIsManagementOpen((open) => !open);
            setIsCompactNavOpen(true);
          }}
          type="button"
        >
          {dict.menu.management}
        </button>
      </nav>
      {isManagementOpen ? (
        <div className="nav-submenu">
          {managementItems.map((item) => (
            <Link
              key={item.to}
              className={`nav-link ${item.active ? "is-active" : ""}`}
              to={item.to}
              onClick={() => setIsManagementOpen(false)}
            >
              {item.label}
            </Link>
          ))}
          {isSuperAdmin ? (
            <button className="nav-link nav-link-button" type="button" onClick={() => seedDemoDataFromAdminMenu()}>
              {isSeedingDemoData ? (language === "tr" ? "Ekleniyor..." : "Seeding...") : (language === "tr" ? "Demo Veri Ekle" : "Seed Demo Data")}
            </button>
          ) : null}
          {isSuperAdmin ? (
            <button className="nav-link nav-link-button nav-link-danger" type="button" onClick={() => resetDatabaseFromAdminMenu()}>
              {isResettingDb ? (language === "tr" ? "Sıfırlanıyor..." : "Resetting...") : dict.actions.resetDatabase}
            </button>
          ) : null}
          <div className="nav-submenu-meta" title={language === "tr" ? "Mevcut commit" : "Current commit"}>
            {`Commit: ${gitCommit}`}
          </div>
        </div>
      ) : null}
    </div>
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

  const label = status === "up" ? "API up" : status === "down" ? "API down" : "API check";
  return (
    <span className={`health-chip health-chip-icon is-${status}`} title={label} aria-label={label}>
      <span className="wifi-icon" aria-hidden="true">📶</span>
    </span>
  );
}

function DashboardPage({ language }: { language: Language }) {
  const dict = DICTIONARIES[language];
  const [data, setData] = useState<Record<string, number | string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const counterpartNotFound = dict.common.counterpartNotFound;

  const metricValueOrMissing = (value: unknown): number | string => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return counterpartNotFound;
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) return parsed;
    }
    return counterpartNotFound;
  };

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
  const updatedAtRaw = typeof data.updatedAt === "string" ? data.updatedAt : null;
  const updatedAtDisplay = updatedAtRaw ? updatedAtRaw.replace("T", " ").replace("Z", "").slice(0, 19) : counterpartNotFound;
  const metrics: Array<{
    key: string;
    label: string;
    icon: "users" | "lock" | "orders" | "mail" | "clock";
    value: string | number;
    trailingIcon?: "refresh";
  }> = [
    { key: "totalUsers", label: "Total Users", icon: "users", value: metricValueOrMissing(data.totalUsers) },
    { key: "activeUsers", label: "Active Users", icon: "users", value: metricValueOrMissing(data.activeUsers) },
    { key: "disabledUsers", label: "Disabled Users", icon: "lock", value: metricValueOrMissing(data.disabledUsers) },
    { key: "activeOrders", label: "Active Orders", icon: "orders", value: metricValueOrMissing(data.activeOrders) },
    { key: "paymentPendingOrders", label: "Pending Payments", icon: "mail", value: metricValueOrMissing(data.paymentPendingOrders) },
    { key: "updatedAt", label: "Son Güncelleme", icon: "clock", value: updatedAtDisplay, trailingIcon: "refresh" },
  ];

  const tableRows = [
    { label: "Total Users", value: String(metrics[0].value) },
    { label: "Active Users", value: String(metrics[1].value) },
    { label: "Disabled Users", value: String(metrics[2].value) },
    { label: "Active Orders", value: String(metrics[3].value) },
    { label: "Payment Pending Orders", value: String(metrics[4].value) },
    { label: "Compliance Queue Count", value: String(metricValueOrMissing(data.complianceQueueCount)) },
    { label: "Open Dispute Count", value: String(metricValueOrMissing(data.openDisputeCount)) },
    { label: "Updated At", value: updatedAtRaw ?? counterpartNotFound },
  ];

  return (
    <div className="app dashboard-view">
      <header className="topbar">
        <div>
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
          <StatCard key={item.key} label={item.label} value={item.value} icon={item.icon} trailingIcon={item.trailingIcon} />
        ))}
      </div>
      <section className="content-grid">
        <DataTableCard
          title={dict.dashboard.kpiSnapshot}
          metricLabel={dict.dashboard.metric}
          valueLabel={dict.dashboard.value}
          rows={tableRows}
          updatedAt={updatedAtDisplay}
        />
        <ActionCard
          title={dict.dashboard.quickActions}
          dict={dict}
          updatedAt={updatedAtDisplay}
          queueSummary={{ waiting: 24, processing: 7, failed: 3 }}
        />
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  trailingIcon,
}: {
  label: string;
  value: string | number;
  icon?: "users" | "lock" | "orders" | "mail" | "clock";
  trailingIcon?: "refresh";
}) {
  return (
    <article className={`card ${/updated|güncelleme/i.test(label) ? "card-updated" : ""}`}>
      <div className="card-head">
        <p className="card-label">
          <i className={`metric-icon metric-icon-${icon ?? "users"}`} />
          {label}
        </p>
        {trailingIcon ? <i className={`metric-icon metric-icon-${trailingIcon} metric-icon-trailing`} /> : null}
      </div>
      <p className={`card-value ${/updated|date|time|güncelleme/i.test(label) ? "card-value-long" : ""}`}>{String(value)}</p>
    </article>
  );
}

function DataTableCard({
  title,
  metricLabel,
  valueLabel,
  rows,
  updatedAt,
}: {
  title: string;
  metricLabel: string;
  valueLabel: string;
  rows: Array<{ label: string; value: string }>;
  updatedAt: string;
}) {
  const axisLabels = ["16:30", "19:30", "22:30", "01:30", "04:30", "07:30", "10:30"];
  const queuePoints = [6, 4.5, 6, 5, 4, 4.1, 6.5];
  const sparkPoints = [6.2, 6.1, 5.8, 6.3, 6.2, 6, 5.9, 5.7];
  const queueRows = [
    { name: "Yazdırma", count: 14, tone: "dot-blue" },
    { name: "İndirme", count: 26, tone: "dot-cyan" },
    { name: "Mesaj / İş", count: 36, tone: "dot-teal" },
    { name: "Medya", count: 24, tone: "dot-red" },
  ];

  return (
    <article className="panel">
      <div className="panel-header">
        <h2>{title}</h2>
      </div>
      <div className="kpi-detail-grid">
        <div className="kpi-left">
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
          <p className="kpi-updated">Son Güncelleme: {updatedAt}</p>
        </div>
        <div className="kpi-right">
          <h3>Job Queue Test</h3>
          <LineChart labels={axisLabels} points={queuePoints} max={10} />
          <div className="chart-legend">
            <span><i className="dot dot-blue" /> Bekliyor</span>
            <span><i className="dot dot-teal" /> İşleniyor</span>
            <span><i className="dot dot-red" /> Hata Verdi</span>
          </div>
          <div className="queue-list">
            {queueRows.map((row) => (
              <div className="queue-row" key={row.name}>
                <span className="queue-name"><i className={`dot ${row.tone}`} />{row.name}</span>
                <span className="queue-status">{row.count} Dosya</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="line-chart-wrap">
        <SparklineChart labels={["16:30", "19:30", "22:30", "01:30", "04:30", "07:30", "10:30", "13:30"]} points={sparkPoints} />
        <div className="chart-legend compact">
          <span><i className="dot dot-blue" /> Bekliyor</span>
          <span><i className="dot dot-cyan" /> İşleniyor</span>
          <span><i className="dot dot-red" /> Hata Verdi</span>
        </div>
      </div>
    </article>
  );
}

function ActionCard({
  title,
  dict,
  updatedAt,
  queueSummary,
}: {
  title: string;
  dict: Dictionary;
  updatedAt: string;
  queueSummary: { waiting: number; processing: number; failed: number };
}) {
  const total = Math.max(queueSummary.waiting + queueSummary.processing + queueSummary.failed, 1);
  const radius = 64;
  const circumference = 2 * Math.PI * radius;
  const waitingLength = (queueSummary.waiting / total) * circumference;
  const processingLength = (queueSummary.processing / total) * circumference;
  const failedLength = (queueSummary.failed / total) * circumference;

  return (
    <article className="panel">
      <div className="panel-header">
        <h2>{title}</h2>
      </div>
      <div className="actions">
        <button className="primary" type="button">{dict.actions.openComplianceQueue}</button>
        <button className="ghost has-arrow" type="button">{dict.actions.viewPaymentDisputes}</button>
        <button className="ghost has-arrow" type="button">{dict.actions.inspectAppUsers}</button>
        <button className="ghost has-arrow" type="button">{dict.actions.inspectAdminUsers}</button>
      </div>
      <div className="queue-state-card">
        <div className="queue-state-header">
          <h3>Kuyruk Durumu</h3>
          <span>{updatedAt}</span>
        </div>
        <div className="queue-state-content">
          <div className="queue-state-labels">
            <p>Yazdırma Kuyruğu</p>
            <p>İndirme Kuyruğu</p>
            <p>Mesaj / İş Kuyruğu</p>
            <p>Medya Kuyruğu</p>
          </div>
          <div className="donut-wrap">
            <svg className="donut-chart" viewBox="0 0 160 160" role="presentation" aria-hidden="true">
              <circle className="donut-bg" cx="80" cy="80" r={radius} />
              <circle
                className="donut-segment donut-segment-blue"
                cx="80"
                cy="80"
                r={radius}
                strokeDasharray={`${waitingLength} ${circumference}`}
                strokeDashoffset="0"
              />
              <circle
                className="donut-segment donut-segment-cyan"
                cx="80"
                cy="80"
                r={radius}
                strokeDasharray={`${processingLength} ${circumference}`}
                strokeDashoffset={`${-waitingLength}`}
              />
              <circle
                className="donut-segment donut-segment-red"
                cx="80"
                cy="80"
                r={radius}
                strokeDasharray={`${failedLength} ${circumference}`}
                strokeDashoffset={`${-(waitingLength + processingLength)}`}
              />
            </svg>
            <div className="donut-center">24/7</div>
          </div>
        </div>
        <div className="chart-legend compact">
          <span><i className="dot dot-blue" /> Bekliyor</span>
          <span><i className="dot dot-cyan" /> İşleniyor</span>
          <span><i className="dot dot-red" /> Hata Verdi</span>
        </div>
        <p className="queue-foot">Son Güncelleme: {updatedAt}</p>
      </div>
    </article>
  );
}

function LineChart({ labels, points, max }: { labels: string[]; points: number[]; max: number }) {
  const width = 640;
  const height = 260;
  const paddingX = 34;
  const paddingTop = 14;
  const paddingBottom = 36;
  const innerWidth = width - paddingX * 2;
  const innerHeight = height - paddingTop - paddingBottom;
  const safePoints = points.length > 1 ? points : [0, 0];
  const path = safePoints.map((value, index) => {
    const x = paddingX + (index / (safePoints.length - 1)) * innerWidth;
    const y = paddingTop + innerHeight - (Math.max(0, Math.min(max, value)) / max) * innerHeight;
    return `${index === 0 ? "M" : "L"}${x},${y}`;
  }).join(" ");
  const yTicks = [0, 2, 4, 6, 8, 10];

  return (
    <>
      <svg className="queue-chart" viewBox={`0 0 ${width} ${height}`} role="presentation" aria-hidden="true">
        {yTicks.map((tick) => {
          const y = paddingTop + innerHeight - (tick / max) * innerHeight;
          return (
            <g key={tick}>
              <line className="chart-grid-line" x1={paddingX} x2={width - paddingX} y1={y} y2={y} />
              <text className="chart-y-label" x={paddingX - 22} y={y + 5}>{tick}</text>
            </g>
          );
        })}
        <path className="chart-line" d={path} />
        {safePoints.map((value, index) => {
          const x = paddingX + (index / (safePoints.length - 1)) * innerWidth;
          const y = paddingTop + innerHeight - (Math.max(0, Math.min(max, value)) / max) * innerHeight;
          return <circle key={labels[index] ?? String(index)} className="chart-point" cx={x} cy={y} r={4.5} />;
        })}
      </svg>
      <div className="chart-x-labels">
        {labels.map((label) => <span key={label}>{label}</span>)}
      </div>
    </>
  );
}

function SparklineChart({ labels, points }: { labels: string[]; points: number[] }) {
  const width = 720;
  const height = 120;
  const paddingX = 10;
  const paddingY = 12;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = Math.max(max - min, 1);
  const innerWidth = width - paddingX * 2;
  const innerHeight = height - paddingY * 2;
  const safePoints = points.length > 1 ? points : [0, 0];
  const linePath = safePoints.map((value, index) => {
    const x = paddingX + (index / (safePoints.length - 1)) * innerWidth;
    const y = paddingY + innerHeight - ((value - min) / range) * innerHeight;
    return `${index === 0 ? "M" : "L"}${x},${y}`;
  }).join(" ");
  const areaPath = `${linePath} L ${width - paddingX},${height - paddingY} L ${paddingX},${height - paddingY} Z`;

  return (
    <>
      <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} role="presentation" aria-hidden="true">
        <defs>
          <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(96, 157, 255, 0.4)" />
            <stop offset="100%" stopColor="rgba(96, 157, 255, 0.05)" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#spark-fill)" />
        <path className="chart-line" d={linePath} />
      </svg>
      <div className="chart-x-labels spark-x-labels">
        {labels.map((label) => <span key={label}>{label}</span>)}
      </div>
    </>
  );
}

type UserKind = "app" | "buyers" | "sellers" | "admin";
type ColumnMeta = {
  name: string;
  displayable: boolean;
  sensitivity: "public" | "internal" | "secret";
};
type DensityMode = "compact" | "normal" | "comfortable";

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
  const [last7DaysOnly, setLast7DaysOnly] = useState(false);
  const [sellerStatusFilter, setSellerStatusFilter] = useState<"all" | "active" | "disabled">("all");
  const [activeSellerKpiFilter, setActiveSellerKpiFilter] = useState<"all" | "active" | "disabled" | "new_today" | null>(null);
  const [sellerDailySales, setSellerDailySales] = useState<number | null>(null);
  const [isSellerTableOpen, setIsSellerTableOpen] = useState(false);
  const [buyerFilters, setBuyerFilters] = useState<{
    status: "all" | "active" | "disabled";
    complaint: "all" | "has_unresolved" | "resolved_only" | "no_complaint";
    orderTrend: "all" | "up" | "down";
    spendTrend: "all" | "up" | "down";
  }>({
    status: "all",
    complaint: "all",
    orderTrend: "all",
    spendTrend: "all",
  });
  const [buyerFilterDraft, setBuyerFilterDraft] = useState<{
    status: "all" | "active" | "disabled";
    complaint: "all" | "has_unresolved" | "resolved_only" | "no_complaint";
    orderTrend: "all" | "up" | "down";
    spendTrend: "all" | "up" | "down";
  }>({
    status: "all",
    complaint: "all",
    orderTrend: "all",
    spendTrend: "all",
  });
  const [buyerQuickFilter, setBuyerQuickFilter] = useState<"all" | "risky" | "open_complaint" | "down_spend">("all");
  const [activeSmartFilter, setActiveSmartFilter] = useState<BuyerSmartFilterKey | null>(null);
  const [activeSellerSmartFilter, setActiveSellerSmartFilter] = useState<SellerSmartFilterKey | null>(null);
  const [smartFilterCounts, setSmartFilterCounts] = useState<Record<BuyerSmartFilterKey, number>>({
    daily_buyer: 0,
    top_revenue: 0,
    suspicious_login: 0,
    same_ip_multi_account: 0,
    risky_seller_complaints: 0,
    complainers: 0,
  });
  const [buyerSelectedIds, setBuyerSelectedIds] = useState<string[]>([]);
  const [buyerFilterMenuOpen, setBuyerFilterMenuOpen] = useState(false);
  const [buyerActionMenuId, setBuyerActionMenuId] = useState<string | null>(null);
  const buyerFilterWrapRef = useRef<HTMLDivElement | null>(null);
  const buyerBoardRef = useRef<HTMLDivElement | null>(null);
  const [customerIdPreview, setCustomerIdPreview] = useState<string | null>(null);
  const [pagination, setPagination] = useState<{ total: number; totalPages: number } | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [pendingStatusChange, setPendingStatusChange] = useState<{ id: string; next: "active" | "disabled" } | null>(null);
  const [density, setDensity] = useState<DensityMode>(() => {
    const stored = localStorage.getItem(`coziyoo_users_density_${kind}`) as DensityMode | null;
    if (stored === "compact" || stored === "normal" || stored === "comfortable") return stored;
    return "normal";
  });
  const [filters, setFilters] = useState({
    page: 1,
    pageSize: 20,
    sortBy: "createdAt",
    sortDir: "desc" as "asc" | "desc",
    status: "all",
    roleFilter: "all",
  });
  const navigate = useNavigate();

  const isAppScoped = kind === "app" || kind === "buyers" || kind === "sellers";
  const isSellerPage = kind === "sellers";
  const isBuyerPage = kind === "buyers";
  const endpoint = isAppScoped ? "/v1/admin/users" : "/v1/admin/admin-users";
  const tableKey = isAppScoped ? "users" : "adminUsers";
  const audience = kind === "buyers" ? "buyer" : kind === "sellers" ? "seller" : null;
  const [fields, setFields] = useState<ColumnMeta[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);

  const columnMappings = useMemo(() => {
    if (isAppScoped) {
      return {
        id: "id",
        email: "email",
        phone: "phone",
        display_name: "displayName",
        full_name: "fullName",
        total_foods: "totalFoods",
        user_type: "role",
        is_active: "status",
        country_code: "countryCode",
        language: "language",
        created_at: "createdAt",
        updated_at: "updatedAt",
      } as Record<string, string>;
    }

    return {
      id: "id",
      email: "email",
      role: "role",
      is_active: "status",
      created_at: "createdAt",
      updated_at: "updatedAt",
      last_login_at: "lastLoginAt",
    } as Record<string, string>;
  }, [isAppScoped]);

  const coreColumns = useMemo(() => {
    return isAppScoped
      ? ["id", "display_name", "email", "phone", "is_active", "country_code", "language", "created_at", "updated_at"]
      : ["id", "email", "role", "is_active", "created_at", "updated_at", "last_login_at"];
  }, [isAppScoped]);
  const sellerDefaultColumns = useMemo(
    () => ["display_name", "email", "phone", "id", "total_foods", "status", "language", "created_at", "updated_at"],
    []
  );

  const pageTitle =
    kind === "app" ? dict.users.titleApp : kind === "buyers" ? dict.users.titleBuyers : kind === "sellers" ? dict.users.titleSellers : dict.users.titleAdmins;
  const pageTitleView = isSellerPage ? (language === "tr" ? "Satıcı Yönetimi" : "Seller Management") : pageTitle;
  const unifiedSearchPlaceholder =
    isSellerPage
      ? language === "tr"
        ? "Satıcı ID, e-posta, yemek no ile ara..."
        : "Search seller ID, email, food no..."
      : language === "tr"
        ? "Alıcı/Satıcı ID, e-posta, yemek no ile ara..."
        : "Search buyer/seller ID, email, food no...";
  const renderUnifiedSearch = (compact = false) => (
    <div className={`users-search-wrap ${compact ? "users-search-wrap--compact" : ""}`.trim()}>
      <span className="users-search-icon" aria-hidden="true">
        <svg className="users-search-icon-svg" viewBox="0 0 24 24" fill="none" role="presentation">
          <circle cx="11" cy="11" r="7.2" stroke="currentColor" strokeWidth="2" />
          <path d="M16.7 16.7L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
      <input
        className={`users-search-input ${compact ? "users-search-input--compact" : ""}`.trim()}
        placeholder={unifiedSearchPlaceholder}
        value={searchInput}
        onChange={(event) => setSearchInput(event.target.value)}
      />
      {searchInput.trim().length > 0 ? (
        <button
          className="users-search-clear"
          type="button"
          aria-label={language === "tr" ? "Aramayı temizle" : "Clear search"}
          onClick={() => setSearchInput("")}
        >
          ×
        </button>
      ) : null}
    </div>
  );
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
      sortBy: kind === "sellers" ? "updatedAt" : "createdAt",
      roleFilter: "all",
      status: "all",
    }));
    setSellerStatusFilter("all");
    setBuyerFilters({
      status: "all",
      complaint: "all",
      orderTrend: "all",
      spendTrend: "all",
    });
    setBuyerFilterDraft({
      status: "all",
      complaint: "all",
      orderTrend: "all",
      spendTrend: "all",
    });
    setBuyerQuickFilter("all");
    setActiveSmartFilter(null);
    setActiveSellerSmartFilter(null);
    setBuyerActionMenuId(null);
    setCustomerIdPreview(null);
  }, [kind]);

  useEffect(() => {
    localStorage.setItem(`coziyoo_users_density_${kind}`, density);
  }, [density, kind]);

  useEffect(() => {
    request(`/v1/admin/metadata/tables/${tableKey}/fields`).then(async (response) => {
      if (response.status !== 200) return;
      const body = await parseJson<{ data: { fields: Array<{ name: string; displayable?: boolean; sensitivity?: ColumnMeta["sensitivity"] }> } }>(
        response
      );
      const metas = body.data.fields
        .map((f) => ({
          name: f.name,
          displayable: f.displayable !== false && f.sensitivity !== "secret",
          sensitivity: f.sensitivity ?? "public",
        }))
        .filter((f) => f.displayable && columnMappings[f.name]);
      setFields(metas);
      const defaultColumns = (isSellerPage ? sellerDefaultColumns : coreColumns).filter((column) => metas.some((meta) => meta.name === column));

      const prefs = await request(`/v1/admin/table-preferences/${tableKey}`);
      if (prefs.status === 200) {
        const prefBody = await parseJson<{ data: { visibleColumns: string[] } }>(prefs);
        const normalized = prefBody.data.visibleColumns.filter((column) => metas.some((meta) => meta.name === column));
        setVisibleColumns(normalized.length > 0 ? normalized : defaultColumns);
      } else {
        setVisibleColumns(defaultColumns);
      }
    });
  }, [columnMappings, coreColumns, isSellerPage, sellerDefaultColumns, tableKey]);

  async function loadRows() {
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({
      page: String(filters.page),
      pageSize: String(filters.pageSize),
      sortBy: filters.sortBy,
      sortDir: filters.sortDir,
      ...(searchTerm ? { search: searchTerm } : {}),
      ...(audience ? { audience } : {}),
      ...(isBuyerPage && activeSmartFilter ? { smartFilter: activeSmartFilter } : {}),
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
    setLastUpdatedAt(new Date().toISOString());
    setLoading(false);
  }

  useEffect(() => {
    loadRows().catch(() => setError(dict.users.requestFailed));
  }, [filters.page, filters.pageSize, filters.sortBy, filters.sortDir, filters.roleFilter, audience, searchTerm, activeSmartFilter, isBuyerPage]);

  useEffect(() => {
    if (!isBuyerPage) return;
    request("/v1/admin/buyers/smart-filter-counts")
      .then(async (response) => {
        if (response.status !== 200) return;
        const body = await parseJson<{ data?: Partial<Record<BuyerSmartFilterKey, number>> }>(response);
        if (!body.data) return;
        setSmartFilterCounts({
          daily_buyer: Number(body.data.daily_buyer ?? 0),
          top_revenue: Number(body.data.top_revenue ?? 0),
          suspicious_login: Number(body.data.suspicious_login ?? 0),
          same_ip_multi_account: Number(body.data.same_ip_multi_account ?? 0),
          risky_seller_complaints: Number(body.data.risky_seller_complaints ?? 0),
          complainers: Number(body.data.complainers ?? 0),
        });
      })
      .catch(() => undefined);
  }, [isBuyerPage, activeSmartFilter, buyerQuickFilter, buyerFilters.status, buyerFilters.complaint, buyerFilters.orderTrend, buyerFilters.spendTrend]);

  useEffect(() => {
    if (!isSellerPage) return;
    request("/v1/admin/users/sellers/daily-sales")
      .then(async (response) => {
        if (response.status !== 200) return;
        const body = await parseJson<{ data?: { dailySales?: number } }>(response);
        setSellerDailySales(Number(body.data?.dailySales ?? 0));
      })
      .catch(() => setSellerDailySales(null));
  }, [isSellerPage]);

  useEffect(() => {
    if (!isSellerPage) return;
    setIsSellerTableOpen(false);
  }, [isSellerPage]);

  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed.length === 0) {
      setSearchTerm("");
      setFilters((prev) => ({ ...prev, page: 1 }));
      return;
    }
    const minSearchLength = isSellerPage ? 1 : 3;
    if (trimmed.length < minSearchLength) return;

    const timer = window.setTimeout(() => {
      setSearchTerm(trimmed);
      setFilters((prev) => ({ ...prev, page: 1 }));
    }, 300);

    return () => window.clearTimeout(timer);
  }, [isSellerPage, searchInput]);

  async function savePreferences() {
    const defaultColumns = (isSellerPage ? sellerDefaultColumns : coreColumns).filter((column) => fields.some((f) => f.name === column));
    const payload = visibleColumns.length > 0 ? visibleColumns : defaultColumns;
    const response = await request(`/v1/admin/table-preferences/${tableKey}`, {
      method: "PUT",
      body: JSON.stringify({ visibleColumns: payload, columnOrder: payload }),
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

  function toggleStatusAction(row: any) {
    const currentStatus: "active" | "disabled" = row.status === "disabled" || row.is_active === false ? "disabled" : "active";
    setPendingStatusChange({
      id: row.id,
      next: currentStatus === "active" ? "disabled" : "active",
    });
  }

  async function confirmStatusChange() {
    if (!pendingStatusChange) return;
    await patchUser(pendingStatusChange.id, "status", { status: pendingStatusChange.next });
    setPendingStatusChange(null);
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

  const availableColumns = useMemo(() => fields.map((f) => f.name), [fields]);
  const tableColumns = useMemo(() => {
    const picked = visibleColumns.filter((column) => availableColumns.includes(column));
    if (isSellerPage) {
      if (picked.length > 0) return picked;
      return sellerDefaultColumns.filter((column) => availableColumns.includes(column));
    }
    if (picked.length > 0) return picked;
    return coreColumns.filter((column) => availableColumns.includes(column));
  }, [availableColumns, coreColumns, isSellerPage, sellerDefaultColumns, visibleColumns]);

  const activeRows = rows.filter((row) => row.status === "active");
  const passiveRows = rows.filter((row) => row.status === "disabled");
  const trRows = rows.filter((row) => String(row.countryCode ?? "").toUpperCase() === "TR");
  const todayKey = new Date().toISOString().slice(0, 10);
  const newToday = trRows.filter((row) => String(row.createdAt ?? "").slice(0, 10) === todayKey).length;
  const trendDirection = (current: number, previous: number): "up" | "down" | "flat" => {
    if (current > previous) return "up";
    if (current < previous) return "down";
    return "flat";
  };
  const computeBuyerRisk = (row: any): { level: "low" | "medium" | "high"; score: number } => {
    const unresolved = Number(row.complaintUnresolved ?? 0);
    const totalComplaints = Number(row.complaintTotal ?? 0);
    const orderTrend = trendDirection(Number(row.monthlyOrderCountCurrent ?? 0), Number(row.monthlyOrderCountPrevious ?? 0));
    const spendTrend = trendDirection(Number(row.monthlySpentCurrent ?? 0), Number(row.monthlySpentPrevious ?? 0));
    let score = 0;
    score += Math.min(unresolved, 2) * 30;
    if (totalComplaints >= 2) score += 15;
    if (orderTrend === "down") score += 12;
    if (spendTrend === "down") score += 12;
    if (row.status === "disabled") score += 10;
    if (score >= 70) return { level: "high", score };
    if (score >= 35) return { level: "medium", score };
    return { level: "low", score };
  };
  const buyersWithOpenComplaints = rows.filter((row) => Number(row.complaintUnresolved ?? 0) > 0).length;
  const riskyBuyersCount = rows.filter((row) => computeBuyerRisk(row).level !== "low").length;
  const totalBuyersCount = pagination?.total ?? rows.length;
  const totalRevenue30d = rows.reduce((acc, row) => acc + Number(row.monthlySpentCurrent ?? 0), 0);
  const activeRatio = totalBuyersCount > 0 ? Math.round((activeRows.length / totalBuyersCount) * 100) : 0;
  const sellerRevenue = (row: any): number => Number(row.monthlyRevenue ?? row.monthlySpentCurrent ?? row.totalRevenue ?? row.revenue ?? 0);
  const sellerOrderCurrent = (row: any): number => Number(row.monthlyOrderCountCurrent ?? row.orderCount30d ?? row.totalOrders ?? 0);
  const sellerOrderPrevious = (row: any): number => Number(row.monthlyOrderCountPrevious ?? row.orderCountPrev30d ?? 0);
  const sellerTotalFoods = (row: any): number => Number(row.totalFoods ?? 0);
  const sellerComplaintTotal = (row: any): number => Number(row.complaintTotal ?? row.openComplaintCount ?? 0);
  const sellerComplaintUnresolved = (row: any): number => Number(row.complaintUnresolved ?? row.openComplaintCount ?? 0);
  const sellerMissingDoc = (row: any): number => Number(row.missingDocCount ?? row.missingDocuments ?? 0);
  const sellerSuspiciousLogin = (row: any): number =>
    Number(row.suspiciousLoginCount ?? row.loginAnomalyCount ?? row.sameIpAccountCount ?? row.sameIpEntryCount ?? 0);
  const sellerApprovalText = (row: any): string => String(row.approvalStatus ?? row.complianceStatus ?? "").toLowerCase();
  const sellerRating = (row: any): number => Number(row.avgRating ?? row.ratingAverage ?? row.rating ?? 0);
  const sellerTopRevenueThreshold = useMemo(() => {
    const revenues = trRows.map((row) => sellerRevenue(row)).filter((value) => value > 0).sort((a, b) => b - a);
    if (revenues.length === 0) return Number.POSITIVE_INFINITY;
    const topIndex = Math.max(0, Math.ceil(revenues.length * 0.2) - 1);
    return revenues[topIndex] ?? Number.POSITIVE_INFINITY;
  }, [trRows]);
  const sellerTopSellingFoodsOrderThreshold = useMemo(() => {
    const orderCounts = trRows
      .filter((row) => sellerTotalFoods(row) > 0)
      .map((row) => sellerOrderCurrent(row))
      .filter((value) => value > 0)
      .sort((a, b) => b - a);
    if (orderCounts.length === 0) return Number.POSITIVE_INFINITY;
    const topIndex = Math.max(0, Math.ceil(orderCounts.length * 0.2) - 1);
    return orderCounts[topIndex] ?? Number.POSITIVE_INFINITY;
  }, [trRows]);
  const sellerRiskMeta = (row: any): { level: "low" | "medium" | "high"; score: number } => {
    let score = 0;
    score += Math.min(sellerComplaintUnresolved(row), 3) * 24;
    score += Math.min(sellerSuspiciousLogin(row), 2) * 22;
    score += Math.min(sellerMissingDoc(row), 2) * 18;
    if (sellerOrderCurrent(row) < sellerOrderPrevious(row)) score += 14;
    if (row.status === "disabled") score += 18;
    if (score >= 70) return { level: "high", score };
    if (score >= 35) return { level: "medium", score };
    return { level: "low", score };
  };
  const matchSellerSmartFilter = (row: any, key: SellerSmartFilterKey): boolean => {
    if (key === "login_anomaly") return true;
    if (key === "pending_approvals") return /(pending|review|in_progress|submitted)/.test(sellerApprovalText(row));
    if (key === "missing_documents") return sellerMissingDoc(row) > 0;
    if (key === "suspicious_logins") return sellerSuspiciousLogin(row) > 0;
    if (key === "top_selling_foods") {
      return sellerTotalFoods(row) > 0 && sellerOrderCurrent(row) >= sellerTopSellingFoodsOrderThreshold && sellerOrderCurrent(row) > 0;
    }
    if (key === "top_revenue") return sellerRevenue(row) >= sellerTopRevenueThreshold && sellerRevenue(row) > 0;
    if (key === "performance_drop") return sellerOrderCurrent(row) < sellerOrderPrevious(row);
    if (key === "urgent_action") return sellerRiskMeta(row).level === "high";
    return sellerComplaintTotal(row) > 0;
  };
  const sellerSmartFilterCounts = useMemo(
    () =>
      SELLER_SMART_FILTER_ITEMS.reduce(
        (acc, item) => {
          acc[item.key] = trRows.filter((row) => matchSellerSmartFilter(row, item.key)).length;
          return acc;
        },
        {
          login_anomaly: 0,
          pending_approvals: 0,
          missing_documents: 0,
          suspicious_logins: 0,
          top_selling_foods: 0,
          top_revenue: 0,
          performance_drop: 0,
          urgent_action: 0,
          complainer_sellers: 0,
        } as Record<SellerSmartFilterKey, number>
      ),
    [trRows, sellerTopRevenueThreshold, sellerTopSellingFoodsOrderThreshold]
  );
  const buyerQuickFilterCounts = useMemo(() => {
    if (!isBuyerPage) {
      return {
        all: 0,
        risky: 0,
        open_complaint: 0,
        down_spend: 0,
      };
    }

    let baseRows = rows;
    if (buyerFilters.status !== "all") {
      baseRows = baseRows.filter((row) => row.status === buyerFilters.status);
    }
    if (buyerFilters.complaint === "has_unresolved") {
      baseRows = baseRows.filter((row) => Number(row.complaintUnresolved ?? 0) > 0);
    } else if (buyerFilters.complaint === "resolved_only") {
      baseRows = baseRows.filter((row) => Number(row.complaintTotal ?? 0) > 0 && Number(row.complaintUnresolved ?? 0) === 0);
    } else if (buyerFilters.complaint === "no_complaint") {
      baseRows = baseRows.filter((row) => Number(row.complaintTotal ?? 0) === 0);
    }
    if (buyerFilters.orderTrend !== "all") {
      baseRows = baseRows.filter(
        (row) => trendDirection(Number(row.monthlyOrderCountCurrent ?? 0), Number(row.monthlyOrderCountPrevious ?? 0)) === buyerFilters.orderTrend
      );
    }
    if (buyerFilters.spendTrend !== "all") {
      baseRows = baseRows.filter(
        (row) => trendDirection(Number(row.monthlySpentCurrent ?? 0), Number(row.monthlySpentPrevious ?? 0)) === buyerFilters.spendTrend
      );
    }

    return {
      all: baseRows.length,
      risky: baseRows.filter((row) => computeBuyerRisk(row).level !== "low").length,
      open_complaint: baseRows.filter((row) => Number(row.complaintUnresolved ?? 0) > 0).length,
      down_spend: baseRows.filter(
        (row) => trendDirection(Number(row.monthlySpentCurrent ?? 0), Number(row.monthlySpentPrevious ?? 0)) === "down"
      ).length,
    };
  }, [buyerFilters, isBuyerPage, rows]);
  const filteredRows = useMemo(() => {
    let scopedRows = rows;
    if (isSellerPage) {
      scopedRows = scopedRows.filter((row) => String(row.countryCode ?? "").toUpperCase() === "TR");
      if (activeSellerKpiFilter === "new_today") {
        scopedRows = scopedRows.filter((row) => String(row.createdAt ?? "").slice(0, 10) === todayKey);
      }
      if (sellerStatusFilter !== "all") {
        scopedRows = scopedRows.filter((row) => row.status === sellerStatusFilter);
      }
      if (activeSellerSmartFilter) {
        scopedRows = scopedRows.filter((row) => matchSellerSmartFilter(row, activeSellerSmartFilter));
      }

      const sellerQuery = searchInput.trim().toLocaleLowerCase("tr-TR");
      if (sellerQuery.length > 0) {
        const queryCompact = sellerQuery.replace(/\s+/g, "");
        const rankText = (raw: unknown): number => {
          const text = String(raw ?? "").trim().toLocaleLowerCase("tr-TR");
          if (!text) return 0;
          const compact = text.replace(/\s+/g, "");
          if (text === sellerQuery || compact === queryCompact) return 120;
          if (text.startsWith(sellerQuery) || compact.startsWith(queryCompact)) return 95;
          const index = text.indexOf(sellerQuery);
          if (index >= 0) return Math.max(55 - index * 2, 12);
          const compactIndex = compact.indexOf(queryCompact);
          if (compactIndex >= 0) return Math.max(38 - compactIndex, 10);
          return 0;
        };
        const rankSeller = (row: any): number => {
          const nameScore = rankText(row.displayName);
          const emailScore = rankText(row.email);
          const idScore = rankText(row.id);
          const phoneScore = rankText(row.phone ?? row.phoneNumber ?? row.contactPhone);
          return Math.max(nameScore, emailScore, idScore, phoneScore);
        };
        scopedRows = [...scopedRows]
          .map((row, index) => ({ row, score: rankSeller(row), index }))
          .sort((a, b) => (b.score - a.score) || (a.index - b.index))
          .map((item) => item.row);
      }
    }

    if (isBuyerPage) {
      if (buyerFilters.status !== "all") {
        scopedRows = scopedRows.filter((row) => row.status === buyerFilters.status);
      }
      if (buyerFilters.complaint === "has_unresolved") {
        scopedRows = scopedRows.filter((row) => Number(row.complaintUnresolved ?? 0) > 0);
      } else if (buyerFilters.complaint === "resolved_only") {
        scopedRows = scopedRows.filter((row) => Number(row.complaintTotal ?? 0) > 0 && Number(row.complaintUnresolved ?? 0) === 0);
      } else if (buyerFilters.complaint === "no_complaint") {
        scopedRows = scopedRows.filter((row) => Number(row.complaintTotal ?? 0) === 0);
      }
      if (buyerFilters.orderTrend !== "all") {
        scopedRows = scopedRows.filter(
          (row) => trendDirection(Number(row.monthlyOrderCountCurrent ?? 0), Number(row.monthlyOrderCountPrevious ?? 0)) === buyerFilters.orderTrend
        );
      }
      if (buyerFilters.spendTrend !== "all") {
        scopedRows = scopedRows.filter(
          (row) => trendDirection(Number(row.monthlySpentCurrent ?? 0), Number(row.monthlySpentPrevious ?? 0)) === buyerFilters.spendTrend
        );
      }
      if (buyerQuickFilter === "risky") {
        scopedRows = scopedRows.filter((row) => computeBuyerRisk(row).level !== "low");
      } else if (buyerQuickFilter === "open_complaint") {
        scopedRows = scopedRows.filter((row) => Number(row.complaintUnresolved ?? 0) > 0);
      } else if (buyerQuickFilter === "down_spend") {
        scopedRows = scopedRows.filter(
          (row) => trendDirection(Number(row.monthlySpentCurrent ?? 0), Number(row.monthlySpentPrevious ?? 0)) === "down"
        );
      }
    }

    if (!last7DaysOnly) return scopedRows;
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    return scopedRows.filter((row) => {
      const created = Date.parse(String(row.createdAt ?? ""));
      return !Number.isNaN(created) && now - created <= sevenDays;
    });
  }, [activeSellerKpiFilter, activeSellerSmartFilter, buyerFilters, buyerQuickFilter, isBuyerPage, isSellerPage, last7DaysOnly, rows, searchInput, sellerStatusFilter, todayKey]);

  function resolveColumnLabel(columnName: string): string {
    const mapped = columnMappings[columnName] ?? columnName;
    if (mapped === "id") return "ID";
    if (mapped === "displayName") return isSellerPage ? (language === "tr" ? "Satıcı Adı" : "Seller Name") : language === "tr" ? "Ad Soyad" : "Full Name";
    if (mapped === "email") return language === "tr" ? "E-Posta" : "Email";
    if (mapped === "phone") return language === "tr" ? "Telefon" : "Phone";
    if (mapped === "status") return dict.users.status;
    if (mapped === "totalFoods") return language === "tr" ? "Yemek" : "Foods";
    if (mapped === "role") return dict.users.role;
    if (mapped === "countryCode") return language === "tr" ? "Ülke" : "Country";
    if (mapped === "language") return language === "tr" ? "Dil" : "Language";
    if (mapped === "createdAt") return language === "tr" ? "Kayıt Tarihi" : "Created At";
    if (mapped === "updatedAt") return language === "tr" ? "Son Güncelleme" : "Updated At";
    if (mapped === "lastLoginAt") return language === "tr" ? "Son Giriş" : "Last Login";
    return mapped;
  }

  function compactUuidLabel(id: string): string {
    return toDisplayId(id);
  }

  function openCustomerIdPreview(rawId: unknown) {
    const fullId = String(rawId ?? "").trim();
    if (!fullId) return;
    setCustomerIdPreview(fullId);
  }

  function renderCell(row: any, columnName: string) {
    const mapped = columnMappings[columnName] ?? columnName;
    const value = row[mapped];
    if (mapped === "id") {
      if (isBuyerPage) {
        return compactUuidLabel(String(value ?? ""));
      }
      if (kind === "sellers") {
        return (
          <button
            className="inline-copy"
            type="button"
            title={String(value ?? "")}
            onClick={() => {
              openCustomerIdPreview(value);
              navigator.clipboard.writeText(String(value ?? "")).catch(() => undefined);
            }}
          >
            {compactUuidLabel(String(value ?? ""))}
          </button>
        );
      }
      return (
        <button
          className="inline-copy"
          type="button"
          title={String(value ?? "")}
          onClick={() => {
            openCustomerIdPreview(value);
            navigator.clipboard.writeText(String(value ?? "")).catch(() => undefined);
          }}
        >
          {compactUuidLabel(String(value ?? ""))}
        </button>
      );
    }
    if (mapped === "status") {
      const status = value === "disabled" ? "disabled" : "active";
      return <span className={`status-pill ${status === "active" ? "is-active" : "is-disabled"}`}>{status === "active" ? "Aktif" : "Pasif"}</span>;
    }
    if (mapped === "totalFoods") {
      const count = Number(value ?? 0);
      const safeCount = Number.isFinite(count) ? count : 0;
      if (kind === "sellers") {
        return (
          <button className="inline-copy" type="button" onClick={() => navigate(`/app/sellers/${row.id}?tab=foods`)}>
            {safeCount}
          </button>
        );
      }
      return safeCount;
    }
    if (mapped === "displayName") {
      const text = String(value ?? "");
      if (isBuyerPage) {
        return text;
      }
      if (kind === "sellers") {
        return (
          <button className="inline-copy" type="button" onClick={() => navigate(`/app/sellers/${row.id}?tab=foods`)}>
            {text}
          </button>
        );
      }
      return text;
    }
    if (mapped === "email" && kind === "sellers") {
      return (
        <button className="inline-copy" type="button" onClick={() => navigate(`/app/sellers/${row.id}?tab=foods`)}>
          {String(value ?? "")}
        </button>
      );
    }
    if (mapped === "email" && isBuyerPage) {
      return String(value ?? "");
    }
    if (mapped === "phone") {
      const phoneValue = String(value ?? "").trim();
      return phoneValue || "-";
    }
    if (mapped === "countryCode") {
      const cc = String(value ?? "").toUpperCase();
      if (isSellerPage) return cc || "TR";
      if (cc === "TR") return "Türkiye";
      if (cc === "US") return "United States";
      if (cc === "IT") return "Italy";
      if (cc === "JP") return "Japan";
      if (cc === "FR") return "France";
      return cc || "-";
    }
    if (mapped === "language" && isSellerPage) {
      const lang = String(value ?? "").trim().toLowerCase();
      if (lang) return lang.toUpperCase();
      const cc = String(row.countryCode ?? "").toUpperCase();
      return cc || "TR";
    }
    if (mapped === "createdAt" || mapped === "updatedAt" || mapped === "lastLoginAt") {
      const text = String(value ?? "");
      return text ? text.slice(0, 10) : "-";
    }
    if (mapped === "role") {
      if (value === "buyer") return <span className="user-type-pill is-buyer">{dict.users.userTypeBuyer}</span>;
      if (value === "seller") return <span className="user-type-pill is-seller">{dict.users.userTypeSeller}</span>;
      if (value === "both") return <span className="user-type-pill is-both">{dict.users.userTypeBoth}</span>;
      if (value === "admin") return dict.users.roleAdmin;
      if (value === "super_admin") return dict.users.roleSuperAdmin;
    }
    return String(value ?? "");
  }

  function trendArrow(current: number, previous: number): { symbol: string; className: string } {
    if (current > previous) return { symbol: "↑", className: "is-up" };
    if (current < previous) return { symbol: "↓", className: "is-down" };
    return { symbol: "•", className: "is-flat" };
  }

  function formatTry(value: number): string {
    return new Intl.NumberFormat(language === "tr" ? "tr-TR" : "en-US", {
      style: "currency",
      currency: "TRY",
      maximumFractionDigits: 2,
    }).format(value);
  }

  function exportCellValue(row: any, columnName: string): string {
    const mapped = columnMappings[columnName] ?? columnName;
    const value = row[mapped];
    if (mapped === "id") return String(value ?? "");
    if (mapped === "status") return value === "disabled" ? (language === "tr" ? "Pasif" : "Disabled") : language === "tr" ? "Aktif" : "Active";
    if (mapped === "countryCode") {
      const cc = String(value ?? "").toUpperCase();
      if (cc === "TR") return "Türkiye";
      if (cc === "US") return "United States";
      if (cc === "IT") return "Italy";
      if (cc === "JP") return "Japan";
      if (cc === "FR") return "France";
      return cc || "-";
    }
    if (mapped === "language" && isSellerPage) {
      const lang = String(value ?? "").trim().toLowerCase();
      if (lang) return lang.toUpperCase();
      const cc = String(row.countryCode ?? "").toUpperCase();
      return cc || "TR";
    }
    if (mapped === "createdAt" || mapped === "updatedAt" || mapped === "lastLoginAt") {
      const text = String(value ?? "");
      return text ? text.slice(0, 10) : "-";
    }
    if (mapped === "role") {
      if (value === "buyer") return dict.users.userTypeBuyer;
      if (value === "seller") return dict.users.userTypeSeller;
      if (value === "both") return dict.users.userTypeBoth;
      if (value === "admin") return dict.users.roleAdmin;
      if (value === "super_admin") return dict.users.roleSuperAdmin;
    }
    return String(value ?? "");
  }

  function downloadBuyersAsExcel() {
    if (!isBuyerPage) return;
    const headers = [
      ...tableColumns.map((column) => resolveColumnLabel(column)),
      language === "tr" ? "Toplam Şikayet" : "Total Complaints",
      language === "tr" ? "Çözülen Şikayet" : "Resolved Complaints",
      language === "tr" ? "Çözülmeyen Şikayet" : "Unresolved Complaints",
      language === "tr" ? "Sipariş Trendi (30g/önceki 30g)" : "Order Trend (30d/prev 30d)",
      language === "tr" ? "Harcama Trendi (30g/önceki 30g)" : "Spend Trend (30d/prev 30d)",
    ];

    const rowsForExport = filteredRows.map((row) => [
      ...tableColumns.map((column) => exportCellValue(row, column)),
      String(Number(row.complaintTotal ?? 0)),
      String(Number(row.complaintResolved ?? 0)),
      String(Number(row.complaintUnresolved ?? 0)),
      `${trendArrow(Number(row.monthlyOrderCountCurrent ?? 0), Number(row.monthlyOrderCountPrevious ?? 0)).symbol} ${Number(row.monthlyOrderCountCurrent ?? 0)} / ${Number(row.monthlyOrderCountPrevious ?? 0)}`,
      `${trendArrow(Number(row.monthlySpentCurrent ?? 0), Number(row.monthlySpentPrevious ?? 0)).symbol} ${formatTry(Number(row.monthlySpentCurrent ?? 0))} / ${formatTry(Number(row.monthlySpentPrevious ?? 0))}`,
    ]);

    const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const csv = [headers, ...rowsForExport].map((line) => line.map((cell) => escapeCsv(String(cell))).join(",")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `buyers-export-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadSellersAsExcel() {
    if (!isSellerPage) return;
    const headers = ["Satici Adi", "E-Posta", "Satici ID", "Durum", "Yemek Sayisi", "Aylik Siparis", "Aylik Ciro"];
    const rowsForExport = filteredRows.map((row) => [
      String(row.displayName ?? row.email ?? ""),
      String(row.email ?? ""),
      String(row.id ?? ""),
      row.status === "disabled" ? "Pasif" : "Aktif",
      String(sellerTotalFoods(row)),
      String(sellerOrderCurrent(row)),
      formatTry(sellerRevenue(row)),
    ]);
    const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const csv = [headers, ...rowsForExport].map((line) => line.map((cell) => escapeCsv(String(cell))).join(",")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `sellers-export-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const showState = loading ? "loading" : error ? "error" : filteredRows.length === 0 ? "empty" : "none";
  const allVisibleBuyerRowsSelected = isBuyerPage && filteredRows.length > 0 && filteredRows.every((row) => buyerSelectedIds.includes(row.id));

  useEffect(() => {
    if (!isBuyerPage) return;
    setBuyerSelectedIds((prev) => prev.filter((id) => filteredRows.some((row) => row.id === id)));
  }, [filteredRows, isBuyerPage]);

  useEffect(() => {
    if (!isBuyerPage) return;
    const onDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      if (buyerFilterMenuOpen && buyerFilterWrapRef.current && !buyerFilterWrapRef.current.contains(target)) {
        setBuyerFilterMenuOpen(false);
      }

      if (buyerActionMenuId && buyerBoardRef.current) {
        const actionRoot = (target as HTMLElement).closest(".buyer-v2-row-actions");
        if (!actionRoot) {
          setBuyerActionMenuId(null);
        }
      }
    };

    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => document.removeEventListener("mousedown", onDocumentMouseDown);
  }, [buyerActionMenuId, buyerFilterMenuOpen, isBuyerPage]);

  if (isSellerPage) {
    const totalTrSellers = trRows.length;
    const activeTrSellers = trRows.filter((row) => row.status === "active").length;
    const passiveTrSellers = trRows.filter((row) => row.status === "disabled").length;
    const todayTrSellers = trRows.filter((row) => String(row.createdAt ?? "").slice(0, 10) === todayKey).length;
    const primarySmartItems: SellerSmartFilterKey[] = [
      "pending_approvals",
      "missing_documents",
      "suspicious_logins",
      "top_selling_foods",
      "top_revenue",
      "performance_drop",
      "urgent_action",
      "complainer_sellers",
    ];

    const applySellerKpiFilter = (mode: "all" | "active" | "disabled" | "new_today") => {
      setFilters((prev) => ({ ...prev, page: 1 }));
      setIsSellerTableOpen(true);
      if (mode === "all") {
        setSellerStatusFilter("all");
        setActiveSellerSmartFilter(null);
        setActiveSellerKpiFilter("all");
        return;
      }
      setActiveSellerSmartFilter(null);
      if (mode === "active") {
        setSellerStatusFilter("active");
        setActiveSellerKpiFilter("active");
        return;
      }
      if (mode === "disabled") {
        setSellerStatusFilter("disabled");
        setActiveSellerKpiFilter("disabled");
        return;
      }
      setSellerStatusFilter("all");
      setActiveSellerKpiFilter("new_today");
    };

    return (
      <div className="app buyer-v2-page seller-v2-page">
        <header className="topbar topbar-with-centered-search">
          <div>
            <h1>{pageTitleView}</h1>
            <p className="subtext">Satıcı, ürün ve operasyon metriklerini tek aramayla takip edin.</p>
          </div>
          <div className="topbar-search-center">{renderUnifiedSearch(true)}</div>
          <div className="topbar-actions">
            <div className="seller-daily-sales-inline" aria-label="Günlük satış tutarı">
              <span className="seller-daily-sales-icon" aria-hidden="true">₺</span>
              <strong>{sellerDailySales == null ? "-" : formatTry(sellerDailySales).replace("₺", "").trim()}</strong>
            </div>
          </div>
        </header>

        <section className="buyer-v2-kpis seller-v2-kpis">
          <button
            type="button"
            className={`buyer-v2-kpi seller-v2-kpi is-clickable ${activeSellerKpiFilter === "all" ? "is-selected" : ""}`}
            onClick={() => applySellerKpiFilter("all")}
          >
            <div className="buyer-v2-kpi-icon">👥</div>
            <div>
              <p>Toplam Satıcı</p>
              <strong>{new Intl.NumberFormat("tr-TR").format(totalTrSellers)}</strong>
              <div className="seller-v2-kpi-dots">
                <span className="seller-v2-dot is-red" />
                <span className="seller-v2-dot is-blue" />
                <span className="seller-v2-dot is-blue" />
                <span className="seller-v2-dot" />
                <span className="seller-v2-dot" />
              </div>
            </div>
          </button>
          <button
            type="button"
            className={`buyer-v2-kpi seller-v2-kpi is-green is-clickable ${activeSellerKpiFilter === "active" ? "is-selected" : ""}`}
            onClick={() => applySellerKpiFilter("active")}
          >
            <div className="buyer-v2-kpi-icon is-good">✓</div>
            <div>
              <p>Aktif Satıcı</p>
              <strong>{new Intl.NumberFormat("tr-TR").format(activeTrSellers)}</strong>
              <div className="seller-v2-kpi-dots">
                <span className="seller-v2-dot is-green" />
                <span className="seller-v2-dot is-green" />
                <span className="seller-v2-dot is-green" />
                <span className="seller-v2-dot is-green" />
              </div>
            </div>
          </button>
          <button
            type="button"
            className={`buyer-v2-kpi seller-v2-kpi is-orange is-clickable ${activeSellerKpiFilter === "disabled" ? "is-selected" : ""}`}
            onClick={() => applySellerKpiFilter("disabled")}
          >
            <div className="buyer-v2-kpi-icon is-warn">◔</div>
            <div>
              <p>Pasif Satıcı</p>
              <strong>{new Intl.NumberFormat("tr-TR").format(passiveTrSellers)}</strong>
              <div className="seller-v2-kpi-dots">
                <span className="seller-v2-dot is-orange" />
                <span className="seller-v2-dot is-orange" />
                <span className="seller-v2-dot is-orange" />
                <span className="seller-v2-dot is-orange" />
              </div>
            </div>
          </button>
          <button
            type="button"
            className={`buyer-v2-kpi seller-v2-kpi is-clickable ${activeSellerKpiFilter === "new_today" ? "is-selected" : ""}`}
            onClick={() => applySellerKpiFilter("new_today")}
          >
            <div className="buyer-v2-kpi-icon is-good">☀</div>
            <div>
              <p>Bugün Yeni Satıcı</p>
              <strong>{new Intl.NumberFormat("tr-TR").format(todayTrSellers)}</strong>
            </div>
          </button>
        </section>

        <section className="buyer-v2-main-layout">
          <aside className="panel buyer-v2-smart-panel seller-v2-smart-panel" aria-label="Akıllı filtreler">
            <div className="buyer-v2-smart-list seller-v2-smart-primary">
              {primarySmartItems.map((key) => {
                const item = SELLER_SMART_FILTER_ITEMS.find((entry) => entry.key === key);
                if (!item) return null;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`buyer-v2-smart-item ${activeSellerSmartFilter === item.key ? "is-active" : ""}`}
                    aria-pressed={activeSellerSmartFilter === item.key}
                    onClick={() => {
                      setSellerStatusFilter("all");
                      setActiveSellerKpiFilter(null);
                      setActiveSellerSmartFilter((prev) => {
                        const next = prev === item.key ? null : item.key;
                        setIsSellerTableOpen(next !== null);
                        return next;
                      });
                      setFilters((prev) => ({ ...prev, page: 1 }));
                    }}
                  >
                    <span className="buyer-v2-smart-item-icon" aria-hidden="true">{item.icon}</span>
                    <span className="buyer-v2-smart-item-label">{item.label}</span>
                    <span className="buyer-v2-smart-item-count">{sellerSmartFilterCounts[item.key] ?? 0}</span>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="panel buyer-v2-board seller-v2-board">
            {isSellerTableOpen ? (
              <div className="seller-v2-toolbar-row">
                <div className="seller-v2-toolbar-left">
                  <button
                    className="ghost users-sort-pill"
                    type="button"
                    onClick={() =>
                      setFilters((prev) => ({
                        ...prev,
                        sortBy: "updatedAt",
                        sortDir: prev.sortDir === "desc" ? "asc" : "desc",
                        page: 1,
                      }))
                    }
                  >
                    Güncelleme: Yeni → Eski {filters.sortDir === "desc" ? "Azalan" : "Artan"} ▼
                  </button>
                </div>
                <div className="seller-v2-toolbar-right">
                  <button className="primary buyer-v2-export" type="button" onClick={downloadSellersAsExcel}>Excel'e Aktar</button>
                </div>
              </div>
            ) : null}

            {isSellerTableOpen ? (
              <div className="table-wrap users-table-wrap buyer-v2-table-wrap seller-v2-table-wrap density-normal">
                <table>
                  <colgroup>
                    <col style={{ width: "42px" }} />
                    <col style={{ width: "110px" }} />
                    <col style={{ width: "30%" }} />
                    <col style={{ width: "12%" }} />
                    <col style={{ width: "10%" }} />
                    <col style={{ width: "13%" }} />
                    <col style={{ width: "10%" }} />
                    <col style={{ width: "9%" }} />
                    <col style={{ width: "9%" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="buyer-v2-check-col"><input type="checkbox" /></th>
                      <th>{language === "tr" ? "Display ID" : "Display ID"}</th>
                      <th>Mağaza Adı</th>
                      <th>Durum</th>
                      <th>Uyarılar</th>
                      <th>Sipariş Sağlığı</th>
                      <th>Rating Trend</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      Array.from({ length: 6 }).map((_, index) => (
                        <tr key={`skeleton-seller-${index}`}>
                          <td colSpan={8} className="table-skeleton"><span /></td>
                        </tr>
                      ))
                    ) : filteredRows.length === 0 ? (
                      <tr>
                        <td colSpan={8}>{dict.common.noRecords}</td>
                      </tr>
                    ) : (
                      filteredRows.map((row) => {
                        const orderCurrent = sellerOrderCurrent(row);
                        const orderPrevious = sellerOrderPrevious(row);
                        const orderMeta = trendArrow(orderCurrent, orderPrevious);
                        const ratingValue = sellerRating(row);
                        const ratingTrend = Number(row.ratingTrend ?? row.ratingDelta ?? 0);
                        const revenueTag = `N.${Math.max(1, Math.round(sellerRevenue(row) / 1000))}T`;
                        const sellerName = String(row.displayName ?? row.email ?? "Satıcı");
                        const warningA = sellerSuspiciousLogin(row) > 0 ? "A" : "•";
                        const warningInfo = sellerComplaintUnresolved(row);

                        return (
                          <tr
                            key={row.id}
                            className="is-clickable"
                            onClick={() => navigate(`/app/sellers/${row.id}`)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                navigate(`/app/sellers/${row.id}`);
                              }
                            }}
                            tabIndex={0}
                          >
                            <td className="buyer-v2-check-col"><input type="checkbox" onClick={(event) => event.stopPropagation()} /></td>
                            <td>{toDisplayId(row.id)}</td>
                            <td>
                              <div className="seller-v2-shop-cell">
                                <strong>{sellerName}</strong>
                              </div>
                            </td>
                            <td>
                              <span className={`seller-v2-like-pill ${row.status === "active" ? "is-good" : ""}`}>
                                👍 {row.status === "active" ? 1 : 0}
                              </span>
                            </td>
                            <td>
                              <div className="seller-v2-warning-cell">
                                <span className={`seller-v2-tag ${warningA === "A" ? "is-red" : ""}`}>{warningA}</span>
                                <span>{warningInfo}</span>
                                <span>◔ {sellerMissingDoc(row)}</span>
                              </div>
                            </td>
                            <td>
                              <div className="seller-v2-health-cell">
                                <span className="seller-v2-health-pill">{revenueTag}</span>
                                <span className={`buyer-trend ${orderMeta.className}`}>{orderMeta.symbol}</span>
                              </div>
                            </td>
                            <td>
                              <span className="seller-v2-rating">
                                {ratingValue > 0 ? ratingValue.toFixed(1) : "-"} ★ ({ratingTrend >= 0 ? "+" : ""}{ratingTrend.toFixed(1)})
                              </span>
                            </td>
                            <td className="cell-actions">
                              <button
                                className="ghost action-btn seller-v2-detail-btn"
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  navigate(`/app/sellers/${row.id}`);
                                }}
                              >
                                <span aria-hidden="true">{row.status === "active" ? "◉ Detay ▾" : "◉ Aktif Yap"}</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="seller-table-placeholder">
                KPI veya soldaki filtrelerden birine tıklayınca tablo açılır.
              </div>
            )}

            {isSellerTableOpen ? (
              <div className="buyer-v2-footer seller-v2-footer">
                <div className="buyer-v2-pager-left">
                  <button className="ghost buyer-v2-page-btn" type="button">10 / sayfa ▼</button>
                  <button className="ghost buyer-v2-page-btn" type="button" disabled={filters.page <= 1} onClick={() => setFilters((prev) => ({ ...prev, page: prev.page - 1 }))}>
                    Önceki
                  </button>
                  <button className="ghost buyer-v2-page-btn is-active" type="button">{String(filters.page)}</button>
                  <button className="ghost buyer-v2-page-btn" type="button" disabled>{String(Math.min(filters.page + 1, Math.max(pagination?.totalPages ?? 1, 1)))}</button>
                  <button className="ghost buyer-v2-page-btn" type="button" disabled>{String(Math.min(filters.page + 2, Math.max(pagination?.totalPages ?? 1, 1)))}</button>
                  <button className="ghost buyer-v2-page-btn" type="button" disabled={filters.page >= Math.max(pagination?.totalPages ?? 1, 1)} onClick={() => setFilters((prev) => ({ ...prev, page: prev.page + 1 }))}>
                    Sonraki
                  </button>
                </div>
                <div className="buyer-v2-pager-right">
                  <span className="panel-meta">{`${Math.min((filters.page - 1) * filters.pageSize + 1, pagination?.total ?? 0)}-${Math.min(filters.page * filters.pageSize, pagination?.total ?? 0)} / ${pagination?.total ?? 0} kayıt`}</span>
                  <button
                    className="ghost buyer-v2-page-btn"
                    type="button"
                    disabled={filters.page <= 1}
                    onClick={() => setFilters((prev) => ({ ...prev, page: prev.page - 1 }))}
                  >
                    ‹
                  </button>
                  <button
                    className="ghost buyer-v2-page-btn"
                    type="button"
                    disabled={filters.page >= Math.max(pagination?.totalPages ?? 1, 1)}
                    onClick={() => setFilters((prev) => ({ ...prev, page: prev.page + 1 }))}
                  >
                    ›
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        </section>
      </div>
    );
  }
  if (isBuyerPage) {
    return (
      <div className="app buyer-v2-page">
        <header className="topbar topbar-with-centered-search">
          <div>
            <h1>{language === "tr" ? "Alıcı Yönetimi" : "Buyer Management"}</h1>
            <p className="subtext">Kullanıcı, sipariş, uygunluk ve itiraz metriklerini gerçek zamanlı izleyin.</p>
          </div>
          <div className="topbar-search-center">{renderUnifiedSearch(true)}</div>
          <div className="topbar-actions">
            <div className="buyer-v2-head-revenue" aria-label="Toplam Ciro">
              <span>Toplam Ciro</span>
              <strong>{formatTry(totalRevenue30d)}</strong>
            </div>
            <button className="ghost" type="button" onClick={() => loadRows().catch(() => setError(dict.users.requestFailed))}>Yenile</button>
            <button className="primary" type="button" onClick={downloadBuyersAsExcel}>Bekleyen İşler</button>
          </div>
        </header>

        <section className="buyer-v2-kpis">
          <article className="buyer-v2-kpi">
            <div className="buyer-v2-kpi-icon">👥</div>
            <div>
              <p>Toplam Alıcı</p>
              <strong>{new Intl.NumberFormat("tr-TR").format(totalBuyersCount)}</strong>
              <small>%{activeRatio} Son 30n Aktif Oranı</small>
            </div>
          </article>
          <article className="buyer-v2-kpi">
            <div className="buyer-v2-kpi-icon is-good">✓</div>
            <div>
              <p>Aktif Oranı</p>
              <strong>%{activeRatio}</strong>
              <div className="buyer-v2-kpi-progress"><span style={{ width: `${activeRatio}%` }} /></div>
            </div>
          </article>
          <article className="buyer-v2-kpi">
            <div className="buyer-v2-kpi-icon is-warn">⚠</div>
            <div>
              <p>Şikayetli Alıcı</p>
              <strong>{buyersWithOpenComplaints}</strong>
              <small>{`%${buyersWithOpenComplaints} Son 30 Gün Aktif Oranı`}</small>
            </div>
          </article>
          <article className="buyer-v2-kpi">
            <div className="buyer-v2-kpi-icon is-danger">🛡</div>
            <div>
              <p>Riskli Alıcı</p>
              <strong>{riskyBuyersCount}</strong>
              <small>{`%${riskyBuyersCount} Son 30 Gün`}</small>
            </div>
          </article>
        </section>

        <section className="buyer-v2-main-layout">
          <aside className="panel buyer-v2-smart-panel" aria-label="Akilli filtreler">
            <h2>Akilli Filtreler</h2>
            <div className="buyer-v2-smart-list">
              {BUYER_SMART_FILTER_ITEMS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`buyer-v2-smart-item ${activeSmartFilter === item.key ? "is-active" : ""}`}
                  aria-pressed={activeSmartFilter === item.key}
                  onClick={() => {
                    setActiveSmartFilter((prev) => (prev === item.key ? null : item.key));
                    setFilters((prev) => ({ ...prev, page: 1 }));
                  }}
                >
                  <span className="buyer-v2-smart-item-icon" aria-hidden="true">{item.icon}</span>
                  <span className="buyer-v2-smart-item-label">{item.label}</span>
                  <span className="buyer-v2-smart-item-count">{smartFilterCounts[item.key] ?? 0}</span>
                </button>
              ))}
            </div>
            <h2>Hızlı Filtreler</h2>
            <div className="buyer-v2-smart-list buyer-v2-quick-filter-list">
              <button
                type="button"
                className={`buyer-v2-smart-item buyer-v2-quick-filter-item ${buyerQuickFilter === "all" ? "is-active" : ""}`}
                onClick={() => {
                  setBuyerQuickFilter("all");
                  setFilters((prev) => ({ ...prev, page: 1 }));
                }}
              >
                <span className="buyer-v2-smart-item-icon" aria-hidden="true">◉</span>
                <span className="buyer-v2-smart-item-label">Tümü</span>
                <span className="buyer-v2-smart-item-count">{buyerQuickFilterCounts.all}</span>
              </button>
              <button
                type="button"
                className={`buyer-v2-smart-item buyer-v2-quick-filter-item ${buyerQuickFilter === "risky" ? "is-active" : ""}`}
                onClick={() => {
                  setBuyerQuickFilter("risky");
                  setFilters((prev) => ({ ...prev, page: 1 }));
                }}
              >
                <span className="buyer-v2-smart-item-icon" aria-hidden="true">⚠</span>
                <span className="buyer-v2-smart-item-label">Riskli</span>
                <span className="buyer-v2-smart-item-count">{buyerQuickFilterCounts.risky}</span>
              </button>
              <button
                type="button"
                className={`buyer-v2-smart-item buyer-v2-quick-filter-item ${buyerQuickFilter === "open_complaint" ? "is-active" : ""}`}
                onClick={() => {
                  setBuyerQuickFilter("open_complaint");
                  setFilters((prev) => ({ ...prev, page: 1 }));
                }}
              >
                <span className="buyer-v2-smart-item-icon" aria-hidden="true">✉</span>
                <span className="buyer-v2-smart-item-label">Şikayetli</span>
                <span className="buyer-v2-smart-item-count">{buyerQuickFilterCounts.open_complaint}</span>
              </button>
              <button
                type="button"
                className={`buyer-v2-smart-item buyer-v2-quick-filter-item ${buyerQuickFilter === "down_spend" ? "is-active" : ""}`}
                onClick={() => {
                  setBuyerQuickFilter("down_spend");
                  setFilters((prev) => ({ ...prev, page: 1 }));
                }}
              >
                <span className="buyer-v2-smart-item-icon" aria-hidden="true">↓</span>
                <span className="buyer-v2-smart-item-label">Azalan Harcama</span>
                <span className="buyer-v2-smart-item-count">{buyerQuickFilterCounts.down_spend}</span>
              </button>
            </div>
          </aside>

          <section className="panel buyer-v2-board">
          <div className="buyer-v2-toolbar">
            <div className="buyer-v2-toolbar-actions">
              <div className="buyer-v2-filter-wrap" ref={buyerFilterWrapRef}>
                <button className="ghost buyer-v2-toolbar-btn" type="button" onClick={() => setBuyerFilterMenuOpen((prev) => !prev)}>
                  <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true">
                    <path d="M3 6h18M7 12h10M10 18h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  Filtreler ▾
                </button>
                {buyerFilterMenuOpen ? (
                  <div className="buyer-v2-filter-menu">
                    <label>
                      Durum
                      <select
                        value={buyerFilterDraft.status}
                        onChange={(event) => setBuyerFilterDraft((prev) => ({ ...prev, status: event.target.value as typeof prev.status }))}
                      >
                        <option value="all">Tümü</option>
                        <option value="active">Aktif</option>
                        <option value="disabled">Pasif</option>
                      </select>
                    </label>
                    <label>
                      Şikayet
                      <select
                        value={buyerFilterDraft.complaint}
                        onChange={(event) => setBuyerFilterDraft((prev) => ({ ...prev, complaint: event.target.value as typeof prev.complaint }))}
                      >
                        <option value="all">Tümü</option>
                        <option value="has_unresolved">Açık Şikayetli</option>
                        <option value="resolved_only">Sadece Çözülen</option>
                        <option value="no_complaint">Yok</option>
                      </select>
                    </label>
                    <label>
                      Sipariş Trendi
                      <select
                        value={buyerFilterDraft.orderTrend}
                        onChange={(event) => setBuyerFilterDraft((prev) => ({ ...prev, orderTrend: event.target.value as typeof prev.orderTrend }))}
                      >
                        <option value="all">Tümü</option>
                        <option value="up">Artan</option>
                        <option value="down">Azalan</option>
                      </select>
                    </label>
                    <label>
                      Harcama Trendi
                      <select
                        value={buyerFilterDraft.spendTrend}
                        onChange={(event) => setBuyerFilterDraft((prev) => ({ ...prev, spendTrend: event.target.value as typeof prev.spendTrend }))}
                      >
                        <option value="all">Tümü</option>
                        <option value="up">Artan</option>
                        <option value="down">Azalan</option>
                      </select>
                    </label>
                    <div className="buyer-v2-filter-menu-actions">
                      <button
                        className="ghost"
                        type="button"
                        onClick={() => {
                          setBuyerFilterDraft({ status: "all", complaint: "all", orderTrend: "all", spendTrend: "all" });
                          setBuyerFilters({ status: "all", complaint: "all", orderTrend: "all", spendTrend: "all" });
                          setFilters((prev) => ({ ...prev, page: 1 }));
                          setBuyerFilterMenuOpen(false);
                        }}
                      >
                        Sıfırla
                      </button>
                      <button
                        className="primary"
                        type="button"
                        onClick={() => {
                          setBuyerFilters(buyerFilterDraft);
                          setFilters((prev) => ({ ...prev, page: 1 }));
                          setBuyerFilterMenuOpen(false);
                        }}
                      >
                        Uygula
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              <button className="ghost buyer-v2-icon-btn" type="button" onClick={() => loadRows().catch(() => setError(dict.users.requestFailed))}>⟳</button>
              <button className="primary buyer-v2-export" type="button" onClick={downloadBuyersAsExcel}>Excel'e Aktar</button>
            </div>
          </div>

          <div className="table-wrap users-table-wrap buyer-v2-table-wrap density-normal" ref={buyerBoardRef}>
            <table>
              <colgroup>
                <col style={{ width: "40px" }} />
                <col style={{ width: "110px" }} />
                <col style={{ width: "27%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "8%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "7%" }} />
                <col style={{ width: "54px" }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="buyer-v2-check-col">
                    <input
                      type="checkbox"
                      checked={allVisibleBuyerRowsSelected}
                      onChange={(event) => {
                        if (event.target.checked) {
                          setBuyerSelectedIds(filteredRows.map((row) => row.id));
                          return;
                        }
                        setBuyerSelectedIds([]);
                      }}
                    />
                  </th>
                  <th>{language === "tr" ? "Display ID" : "Display ID"}</th>
                  <th>Alıcı</th>
                  <th>Risk</th>
                  <th>Şikayet</th>
                  <th>Sipariş (1 Ay)</th>
                  <th>Harcama (1 Ay)</th>
                  <th>Son Giris</th>
                  <th>Durum</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 6 }).map((_, index) => (
                    <tr key={`skeleton-buyer-${index}`}>
                      <td colSpan={10} className="table-skeleton"><span /></td>
                    </tr>
                  ))
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={10}>{dict.common.noRecords}</td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    const risk = computeBuyerRisk(row);
                    const orderTrendMeta = trendArrow(Number(row.monthlyOrderCountCurrent ?? 0), Number(row.monthlyOrderCountPrevious ?? 0));
                    const spendTrendMeta = trendArrow(Number(row.monthlySpentCurrent ?? 0), Number(row.monthlySpentPrevious ?? 0));
                    const orderCurrent = Number(row.monthlyOrderCountCurrent ?? 0);
                    const orderPrevious = Number(row.monthlyOrderCountPrevious ?? 0);
                    const orderDelta = orderCurrent - orderPrevious;
                    const spendCurrent = Number(row.monthlySpentCurrent ?? 0);
                    const spendPrevious = Number(row.monthlySpentPrevious ?? 0);
                    const spendDelta = spendCurrent - spendPrevious;
                    const unresolved = Number(row.complaintUnresolved ?? 0);
                    const totalComplaints = Number(row.complaintTotal ?? 0);
                    const phoneRaw = String(row.phone ?? row.phoneNumber ?? row.contactPhone ?? "").trim();
                    const hasPhone = phoneRaw.length > 0;
                    const phoneHref = phoneRaw.replace(/\s+/g, "");
                    const loginAtRaw = String(row.lastOnlineAt ?? row.lastLoginAt ?? row.last_login_at ?? "");
                    const loginAt = loginAtRaw ? formatUiDate(loginAtRaw, language) : "-";
                    const displayNameRaw = String(row.displayName ?? row.email ?? "-");
                    const displaySeedMatch = displayNameRaw.match(/^apiseedbuyer\d{4,}.*?(\d+)$/i);
                    const normalizedDisplayName = displaySeedMatch ? `nbuyer${displaySeedMatch[1]}` : displayNameRaw;

                    return (
                      <tr
                        key={row.id}
                        className={`is-clickable buyer-risk-${risk.level}`}
                        onClick={() => navigate(`/app/buyers/${row.id}`)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            navigate(`/app/buyers/${row.id}`);
                          }
                        }}
                        tabIndex={0}
                        >
                        <td className="buyer-v2-check-col">
                          <input
                            type="checkbox"
                            checked={buyerSelectedIds.includes(row.id)}
                            onChange={(event) => {
                              event.stopPropagation();
                              setBuyerSelectedIds((prev) =>
                                event.target.checked ? [...new Set([...prev, row.id])] : prev.filter((id) => id !== row.id)
                              );
                            }}
                            onClick={(event) => event.stopPropagation()}
                          />
                        </td>
                        <td>{toDisplayId(row.id)}</td>
                        <td>
                          <div className="buyer-user-cell">
                            <strong className="buyer-user-name" title={displayNameRaw}>{normalizedDisplayName}</strong>
                          </div>
                        </td>
                        <td>
                          <span className={`risk-pill is-${risk.level}`}>
                            {risk.level === "high" ? "Yüksek" : risk.level === "medium" ? "Orta" : "Düşük"}
                          </span>
                        </td>
                        <td>
                          <div className="buyer-complaint-cell">
                            <strong>{totalComplaints}</strong>
                            {unresolved > 0 ? <span className="complaint-open-chip">{`◀ ${unresolved} Açık`}</span> : null}
                          </div>
                        </td>
                        <td>
                          <div className="buyer-orders-cell">
                            <strong>{orderCurrent}</strong>
                            <span className={`buyer-trend ${orderTrendMeta.className}`}>{orderTrendMeta.symbol}</span>
                            {orderDelta !== 0 ? (
                              <span className={`buyer-delta ${orderDelta > 0 ? "is-up" : "is-down"}`}>{Math.abs(orderDelta)}</span>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          <div className="buyer-spend-cell">
                            <strong>{formatTry(spendCurrent)}</strong>
                            <span className={`buyer-trend ${spendTrendMeta.className}`}>{spendTrendMeta.symbol}</span>
                            {spendDelta === 0 ? <span className="buyer-dot">•</span> : null}
                          </div>
                        </td>
                        <td>
                          <div className="buyer-login-cell">
                            <strong>{loginAt}</strong>
                            {risk.level === "high" ? <span className="status-pill is-warning">⚠ Yuksek</span> : null}
                          </div>
                        </td>
                        <td>
                          <span className={`status-pill ${row.status === "active" ? "is-active" : "is-neutral"}`}>
                            {row.status === "active" ? "Aktif" : "Pasif"}
                          </span>
                        </td>
                        <td className="cell-actions buyer-v2-row-actions">
                          <button
                            className="ghost action-menu-btn"
                            type="button"
                            aria-haspopup="menu"
                            aria-expanded={buyerActionMenuId === row.id}
                            onClick={(event) => {
                              event.stopPropagation();
                              setBuyerActionMenuId((prev) => (prev === row.id ? null : row.id));
                            }}
                          >
                            ⋯
                          </button>
                          {buyerActionMenuId === row.id ? (
                            <div className="buyer-row-menu" role="menu" onClick={(event) => event.stopPropagation()}>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setBuyerActionMenuId(null);
                                  const email = String(row.email ?? "").trim();
                                  if (!email) return;
                                  window.location.href = `mailto:${email}`;
                                }}
                              >
                                Hızlı E-posta
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                disabled={!hasPhone}
                                onClick={() => {
                                  setBuyerActionMenuId(null);
                                  if (!hasPhone) return;
                                  window.location.href = `sms:${phoneHref}`;
                                }}
                              >
                                SMS
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                disabled={!hasPhone}
                                onClick={() => {
                                  setBuyerActionMenuId(null);
                                  if (!hasPhone) return;
                                  window.location.href = `tel:${phoneHref}`;
                                }}
                              >
                                Telefon
                              </button>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="buyer-v2-footer">
            <div className="buyer-v2-pager-left">
              <button className="ghost buyer-v2-page-btn" type="button">‹</button>
              <button className="ghost buyer-v2-page-btn" type="button">›</button>
              <button className="ghost buyer-v2-page-btn is-active" type="button">{String(filters.page)}</button>
              <button className="ghost buyer-v2-page-btn" type="button">{String(Math.min(filters.page + 1, Math.max(pagination?.totalPages ?? 1, 1)))}</button>
              <button className="ghost buyer-v2-page-btn" type="button">{String(Math.min(filters.page + 2, Math.max(pagination?.totalPages ?? 1, 1)))}</button>
              <span className="panel-meta">/ 110+ Kullanıcı</span>
            </div>
            <div className="buyer-v2-pager-right">
              <button className="ghost buyer-v2-page-btn" type="button" disabled={filters.page <= 1} onClick={() => setFilters((prev) => ({ ...prev, page: prev.page - 1 }))}>‹</button>
              <button className="ghost buyer-v2-page-btn is-active" type="button">{String(filters.page)}</button>
              <button className="ghost buyer-v2-page-btn" type="button" disabled>{String(Math.min(filters.page + 1, Math.max(pagination?.totalPages ?? 1, 1)))}</button>
              <button className="ghost buyer-v2-page-btn" type="button" disabled>{String(Math.min(filters.page + 2, Math.max(pagination?.totalPages ?? 1, 1)))}</button>
              <button
                className="ghost buyer-v2-page-btn"
                type="button"
                disabled={filters.page >= Math.max(pagination?.totalPages ?? 1, 1)}
                onClick={() => setFilters((prev) => ({ ...prev, page: prev.page + 1 }))}
              >
                ›
              </button>
            </div>
          </div>
          </section>
        </section>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar topbar-with-centered-search">
        <div className="users-title-wrap">
          <h1>{pageTitleView}</h1>
          {customerIdPreview ? (
            <div className="customer-id-preview-inline" role="status" aria-live="polite">
              <div className="customer-id-preview-eye" aria-hidden="true">
                <svg viewBox="0 0 24 24" role="presentation">
                  <path d="M2 12s3.7-6 10-6 10 6 10 6-3.7 6-10 6-10-6-10-6Z" />
                  <circle cx="12" cy="12" r="3.2" />
                </svg>
              </div>
              <strong>{language === "tr" ? "Müşteri ID" : "Customer ID"}</strong>
              <code>{customerIdPreview}</code>
              <button className="ghost" type="button" onClick={() => setCustomerIdPreview(null)}>
                {language === "tr" ? "Kapat" : "Close"}
              </button>
            </div>
          ) : null}
        </div>
        <div className="topbar-search-center">{renderUnifiedSearch(true)}</div>
        <div className="topbar-actions">
          <>
            <button className="ghost" type="button" onClick={() => setIsColumnsModalOpen(true)}>
              {dict.users.visibleColumns}
            </button>
            {isBuyerPage ? (
              <button className="primary" type="button" onClick={downloadBuyersAsExcel}>
                {dict.actions.exportExcel}
              </button>
            ) : null}
            {!isSellerPage && !isBuyerPage ? (
              <>
              <button className="ghost" type="button" onClick={openCreateDrawer} disabled={!isSuperAdmin}>
                + {dict.actions.create}
              </button>
              <button className="primary" type="button" onClick={() => loadRows().catch(() => setError(dict.users.requestFailed))}>
                {dict.actions.refresh}
              </button>
              </>
            ) : null}
          </>
        </div>
      </header>

      <section className="panel users-kpi-grid">
        {!isSellerPage && !isBuyerPage ? (
          <div className="density-switch users-density-floating" role="group" aria-label="Table density">
            <button type="button" className={density === "compact" ? "is-active" : ""} onClick={() => setDensity("compact")}>
              {language === "tr" ? "Kompakt" : "Compact"}
            </button>
            <button type="button" className={density === "normal" ? "is-active" : ""} onClick={() => setDensity("normal")}>
              {language === "tr" ? "Normal" : "Normal"}
            </button>
            <button type="button" className={density === "comfortable" ? "is-active" : ""} onClick={() => setDensity("comfortable")}>
              {language === "tr" ? "Rahat" : "Comfort"}
            </button>
          </div>
        ) : null}
        {isBuyerPage ? (
          <>
            <article>
              <div className="users-kpi-row">
                <p>{language === "tr" ? "Toplam Alıcı" : "Total Buyers"}</p>
                <strong className="users-kpi-value">{totalBuyersCount}</strong>
              </div>
            </article>
            <article>
              <div className="users-kpi-row users-kpi-row-progress">
                <p>{language === "tr" ? "Aktif Oranı" : "Active Ratio"}</p>
                <strong className="users-kpi-value is-active">%{activeRatio}</strong>
              </div>
              <div className="users-kpi-progress">
                <span style={{ width: `${activeRatio}%` }} />
              </div>
            </article>
            <article>
              <div className="users-kpi-row">
                <p>{language === "tr" ? "Şikayetli Alıcı" : "Buyers with Complaints"}</p>
                <strong className="users-kpi-value">{buyersWithOpenComplaints}</strong>
              </div>
            </article>
            <article>
              <div className="users-kpi-row">
                <p>{language === "tr" ? "Riskli Alıcı" : "Risky Buyers"}</p>
                <strong className="users-kpi-value">{riskyBuyersCount}</strong>
              </div>
            </article>
          </>
        ) : (
          <>
            <article>
              <div className="users-kpi-row">
                <p>{isSellerPage ? (language === "tr" ? "Toplam TR Satıcı" : "Total TR Sellers") : language === "tr" ? "Toplam Alıcılar" : "Total Buyers"}</p>
                <strong className="users-kpi-value">{isSellerPage ? trRows.length : pagination?.total ?? rows.length}</strong>
              </div>
            </article>
            <article>
              <div className="users-kpi-row">
                <p>{isSellerPage ? (language === "tr" ? "Aktif TR Satıcı" : "Active TR Sellers") : language === "tr" ? "Aktif Alıcılar" : "Active Buyers"}</p>
                <strong className="users-kpi-value is-active">{isSellerPage ? trRows.filter((row) => row.status === "active").length : activeRows.length}</strong>
              </div>
            </article>
            <article>
              <div className="users-kpi-row">
                <p>{isSellerPage ? (language === "tr" ? "Pasif TR Satıcı" : "Disabled TR Sellers") : language === "tr" ? "Pasif Alıcılar" : "Disabled Buyers"}</p>
                <strong className="users-kpi-value">{isSellerPage ? trRows.filter((row) => row.status === "disabled").length : passiveRows.length}</strong>
              </div>
            </article>
            <article>
              <div className="users-kpi-row">
                <p>{isSellerPage ? (language === "tr" ? "Bugün Yeni TR Satıcı" : "New TR Sellers Today") : language === "tr" ? "Bugün Yeni" : "New Today"}</p>
                <strong className="users-kpi-value">{newToday}</strong>
              </div>
            </article>
          </>
        )}
      </section>

      <section className="panel">
        <div className="users-filter-top">
          <div className="quick-filters">
            {isBuyerPage ? (
              <div className="buyer-filter-controls">
                <select
                  value={buyerFilterDraft.status}
                  onChange={(event) => setBuyerFilterDraft((prev) => ({ ...prev, status: event.target.value as typeof prev.status }))}
                >
                  <option value="all">{language === "tr" ? "Durum: Tümü" : "Status: All"}</option>
                  <option value="active">{language === "tr" ? "Durum: Aktif" : "Status: Active"}</option>
                  <option value="disabled">{language === "tr" ? "Durum: Pasif" : "Status: Disabled"}</option>
                </select>
                <select
                  value={buyerFilterDraft.complaint}
                  onChange={(event) => setBuyerFilterDraft((prev) => ({ ...prev, complaint: event.target.value as typeof prev.complaint }))}
                >
                  <option value="all">{language === "tr" ? "Şikayet: Tümü" : "Complaints: All"}</option>
                  <option value="has_unresolved">{language === "tr" ? "Şikayet: Çözülmeyen var" : "Complaints: Has unresolved"}</option>
                  <option value="resolved_only">{language === "tr" ? "Şikayet: Sadece çözülen" : "Complaints: Resolved only"}</option>
                  <option value="no_complaint">{language === "tr" ? "Şikayet: Yok" : "Complaints: None"}</option>
                </select>
                <select
                  value={buyerFilterDraft.orderTrend}
                  onChange={(event) => setBuyerFilterDraft((prev) => ({ ...prev, orderTrend: event.target.value as typeof prev.orderTrend }))}
                >
                  <option value="all">{language === "tr" ? "Sipariş Trendi: Tümü" : "Order Trend: All"}</option>
                  <option value="up">{language === "tr" ? "Sipariş Trendi: Artan" : "Order Trend: Up"}</option>
                  <option value="down">{language === "tr" ? "Sipariş Trendi: Azalan" : "Order Trend: Down"}</option>
                </select>
                <select
                  value={buyerFilterDraft.spendTrend}
                  onChange={(event) => setBuyerFilterDraft((prev) => ({ ...prev, spendTrend: event.target.value as typeof prev.spendTrend }))}
                >
                  <option value="all">{language === "tr" ? "Harcama Trendi: Tümü" : "Spend Trend: All"}</option>
                  <option value="up">{language === "tr" ? "Harcama Trendi: Artan" : "Spend Trend: Up"}</option>
                  <option value="down">{language === "tr" ? "Harcama Trendi: Azalan" : "Spend Trend: Down"}</option>
                </select>
                <button
                  type="button"
                  className={`chip ${buyerQuickFilter === "all" ? "is-active" : ""}`}
                  onClick={() => {
                    setBuyerQuickFilter("all");
                    setFilters((prev) => ({ ...prev, page: 1 }));
                  }}
                >
                  {language === "tr" ? "Tümü" : "All"}
                </button>
                <button
                  type="button"
                  className={`chip ${buyerQuickFilter === "risky" ? "is-active" : ""}`}
                  onClick={() => {
                    setBuyerQuickFilter("risky");
                    setFilters((prev) => ({ ...prev, page: 1 }));
                  }}
                >
                  {language === "tr" ? "Riskli" : "Risky"}
                </button>
                <button
                  type="button"
                  className={`chip ${buyerQuickFilter === "open_complaint" ? "is-active" : ""}`}
                  onClick={() => {
                    setBuyerQuickFilter("open_complaint");
                    setFilters((prev) => ({ ...prev, page: 1 }));
                  }}
                >
                  {language === "tr" ? "Açık Şikayetli" : "Open Complaints"}
                </button>
                <button
                  type="button"
                  className={`chip ${buyerQuickFilter === "down_spend" ? "is-active" : ""}`}
                  onClick={() => {
                    setBuyerQuickFilter("down_spend");
                    setFilters((prev) => ({ ...prev, page: 1 }));
                  }}
                >
                  {language === "tr" ? "Azalan Harcama" : "Down Spend"}
                </button>
              </div>
            ) : null}
            {isSellerPage ? (
              <>
                <button type="button" className={`chip ${sellerStatusFilter === "all" ? "is-active" : ""}`} onClick={() => setSellerStatusFilter("all")}>
                  {language === "tr" ? "Tüm TR" : "All TR"}
                </button>
                <button
                  type="button"
                  className={`chip ${sellerStatusFilter === "active" ? "is-active" : ""}`}
                  onClick={() => setSellerStatusFilter("active")}
                >
                  {language === "tr" ? "Aktif" : "Active"}
                </button>
                <button
                  type="button"
                  className={`chip ${sellerStatusFilter === "disabled" ? "is-active" : ""}`}
                  onClick={() => setSellerStatusFilter("disabled")}
                >
                  {language === "tr" ? "Pasif" : "Disabled"}
                </button>
              </>
            ) : null}
            {!isBuyerPage ? (
              <button
                type="button"
                className={`chip ${last7DaysOnly ? "is-active" : ""}`}
                onClick={() => {
                  setLast7DaysOnly((prev) => !prev);
                  setFilters((prev) => ({ ...prev, page: 1 }));
                }}
              >
                {language === "tr" ? "Son 7 Gün" : "Last 7 Days"}
              </button>
            ) : null}
            {!isSellerPage && !isBuyerPage ? <span className={`chip ${showState === "loading" ? "is-active" : ""}`}>{dict.common.loading}</span> : null}
            {!isSellerPage && !isBuyerPage ? (
              <span className={`chip ${showState === "empty" ? "is-active" : ""}`}>{language === "tr" ? "Hiç alıcı bulunamadı" : "No buyers found"}</span>
            ) : null}
            {!isSellerPage && !isBuyerPage ? <span className={`chip ${showState === "error" ? "is-active" : ""}`}>{language === "tr" ? "Bir hata oluştu" : "An error occurred"}</span> : null}
            {showState === "error" && !isBuyerPage ? (
              <button className="chip is-active" type="button" onClick={() => loadRows().catch(() => setError(dict.users.requestFailed))}>
                {language === "tr" ? "Yeniden Dene" : "Retry"}
              </button>
            ) : null}
          </div>
          <button
            className="ghost users-sort-pill"
            type="button"
            onClick={() =>
              setFilters((prev) => ({
                ...prev,
                sortBy: isSellerPage ? "updatedAt" : prev.sortBy,
                sortDir: prev.sortDir === "desc" ? "asc" : "desc",
                page: 1,
              }))
            }
          >
            {isSellerPage
              ? language === "tr"
                ? "Güncelleme: Yeni → Eski "
                : "Updated: New → Old "
              : language === "tr"
                ? "Sırala: Kayıt Tarihi • "
                : "Sort: Created Date • "}
            {filters.sortDir === "desc" ? (language === "tr" ? "Azalan" : "Desc") : language === "tr" ? "Artan" : "Asc"} ▼
          </button>
          {!isSellerPage ? (
            <button
              className="primary users-filter-apply"
              type="button"
              onClick={() => {
                if (isBuyerPage) {
                  setBuyerFilters(buyerFilterDraft);
                }
                setFilters((prev) => ({ ...prev, page: 1 }));
              }}
            >
              {language === "tr" ? "Filtrele" : "Filter"}
            </button>
          ) : null}
        </div>
        <div className={`table-wrap users-table-wrap density-${density}`}>
          <table>
            <thead>
              <tr>
                {isBuyerPage ? (
                  <>
                    <th>{language === "tr" ? "Display ID" : "Display ID"}</th>
                    <th>{language === "tr" ? "Alıcı" : "Buyer"}</th>
                    <th>{language === "tr" ? "Risk" : "Risk"}</th>
                    <th>{language === "tr" ? "Şikayet" : "Complaints"}</th>
                    <th>{language === "tr" ? "Sipariş (1 Ay)" : "Orders (1 Month)"}</th>
                    <th>{language === "tr" ? "Harcama (1 Ay)" : "Spend (1 Month)"}</th>
                    <th>{language === "tr" ? "Durum" : "Status"}</th>
                    <th>{dict.users.actions}</th>
                  </>
                ) : (
                  <>
                    {tableColumns.map((column) => (
                      <th key={column}>{resolveColumnLabel(column)}</th>
                    ))}
                    <th>{dict.users.actions}</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {(() => {
                const tableColSpan = isBuyerPage ? 8 : tableColumns.length + 1;
                return loading ? Array.from({ length: 5 }).map((_, index) => (
                  <tr key={`skeleton-${index}`}>
                    <td colSpan={tableColSpan} className="table-skeleton">
                      <span />
                    </td>
                  </tr>
                )) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={tableColSpan}>{dict.common.noRecords}</td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    if (isBuyerPage) {
                      const risk = computeBuyerRisk(row);
                      const orderTrendMeta = trendArrow(Number(row.monthlyOrderCountCurrent ?? 0), Number(row.monthlyOrderCountPrevious ?? 0));
                      const spendTrendMeta = trendArrow(Number(row.monthlySpentCurrent ?? 0), Number(row.monthlySpentPrevious ?? 0));
                      const unresolved = Number(row.complaintUnresolved ?? 0);
                      const totalComplaints = Number(row.complaintTotal ?? 0);

                      return (
                        <tr
                          key={row.id}
                          className={`is-clickable buyer-risk-${risk.level}`}
                          onClick={() => navigate(`/app/buyers/${row.id}`)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              navigate(`/app/buyers/${row.id}`);
                            }
                          }}
                          tabIndex={0}
                        >
                          <td>{toDisplayId(row.id)}</td>
                          <td>
                            <div className="buyer-user-cell">
                              <strong>{String(row.displayName ?? row.email ?? "-")}</strong>
                            </div>
                          </td>
                          <td>
                            <span className={`risk-pill is-${risk.level}`}>
                              {risk.level === "high" ? (language === "tr" ? "Yüksek" : "High") : risk.level === "medium" ? (language === "tr" ? "Orta" : "Medium") : language === "tr" ? "Düşük" : "Low"}
                            </span>
                          </td>
                          <td>
                            <div className="buyer-complaint-cell">
                              <strong>{totalComplaints}</strong>
                              {unresolved > 0 ? <span className="complaint-open-chip">{`${unresolved} ${language === "tr" ? "Açık" : "Open"}`}</span> : null}
                            </div>
                          </td>
                          <td>
                            <div className={`buyer-trend ${orderTrendMeta.className}`}>
                              <strong>{Number(row.monthlyOrderCountCurrent ?? 0)}</strong>
                              <span>{orderTrendMeta.symbol}</span>
                            </div>
                          </td>
                          <td>
                            <div className={`buyer-trend ${spendTrendMeta.className}`}>
                              <strong>{formatTry(Number(row.monthlySpentCurrent ?? 0))}</strong>
                              <span>{spendTrendMeta.symbol}</span>
                            </div>
                          </td>
                          <td>
                            <span className={`status-pill ${row.status === "active" ? "is-active" : "is-neutral"}`}>
                              {row.status === "active" ? (language === "tr" ? "Aktif" : "Active") : language === "tr" ? "Pasif" : "Passive"}
                            </span>
                          </td>
                          <td className="cell-actions">
                            <button
                              className="ghost action-menu-btn"
                              type="button"
                              aria-label={language === "tr" ? "Aksiyon menüsü" : "Action menu"}
                              onClick={(event) => {
                                event.stopPropagation();
                                navigate(`/app/buyers/${row.id}`);
                              }}
                            >
                              ⋯
                            </button>
                          </td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={row.id}>
                        {tableColumns.map((column) => (
                          <td key={`${row.id}-${column}`}>{renderCell(row, column)}</td>
                        ))}
                        <td className="cell-actions">
                          {!isBuyerPage ? (
                            <button
                              className="ghost action-btn"
                              type="button"
                              title={dict.actions.detail}
                              aria-label={dict.actions.detail}
                              onClick={() =>
                                navigate(
                                  kind === "app"
                                    ? `/app/users/${row.id}`
                                    : `/app/admins/${row.id}`
                                )
                              }
                            >
                              <span aria-hidden="true">◉ Detay</span>
                              <span className="sr-only">{dict.actions.detail}</span>
                            </button>
                          ) : null}
                          {isSuperAdmin && !isSellerPage ? (
                            <button
                              className="ghost action-btn"
                              type="button"
                              title={language === "tr" ? "Pasif Yap" : "Disable"}
                              aria-label={dict.actions.toggleStatus}
                              onClick={() => toggleStatusAction(row)}
                            >
                              <span aria-hidden="true">◔ {language === "tr" ? "Pasif Yap" : "Disable"}</span>
                              <span className="sr-only">{dict.actions.toggleStatus}</span>
                            </button>
                          ) : !isSellerPage ? (
                            <button className="ghost action-btn" type="button" disabled title={dict.users.onlySuperAdmin}>
                              Yetkiniz yok
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })
                );
              })()}
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
              <label key={field.name}>
                <input
                  type="checkbox"
                  checked={tableColumns.includes(field.name)}
                  onChange={(event) => {
                    setVisibleColumns((prev) => {
                      if (event.target.checked) return [...new Set([...prev, field.name])];
                      return prev.filter((item) => item !== field.name);
                    });
                  }}
                />
                {resolveColumnLabel(field.name)}
              </label>
            ))}
          </div>
          <button className="primary" type="button" onClick={savePreferences}>
            {dict.users.savePreferences}
          </button>
        </section>
      </div>

      <div className={`drawer-overlay ${pendingStatusChange ? "is-open" : ""}`} onClick={() => setPendingStatusChange(null)}>
        <section className={`settings-modal ${pendingStatusChange ? "is-open" : ""}`} onClick={(event) => event.stopPropagation()}>
          <div className="form-drawer-header">
            <h2>{language === "tr" ? "Durum Değişikliğini Onayla" : "Confirm Status Change"}</h2>
          </div>
          <p className="panel-meta">
            {pendingStatusChange?.next === "active" ? (language === "tr" ? "Kullanıcı aktif yapılacak." : "User will be activated.") : (language === "tr" ? "Kullanıcı pasif yapılacak." : "User will be disabled.")}
          </p>
          <div className="topbar-actions">
            <button className="ghost" type="button" onClick={() => setPendingStatusChange(null)}>
              {language === "tr" ? "Vazgeç" : "Cancel"}
            </button>
            <button className="primary" type="button" onClick={() => confirmStatusChange().catch(() => setError(dict.users.updateFailed))}>
              {language === "tr" ? "Onayla" : "Confirm"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function InvestigationPage({ language }: { language: Language }) {
  const dict = DICTIONARIES[language];
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "in_review" | "resolved" | "closed">("all");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<
    Array<{
      id: string;
      orderNo: string;
      complainantBuyerNo: string;
      subject: string;
      createdAt: string;
      status: "open" | "in_review" | "resolved" | "closed";
    }>
  >([]);
  const [pagination, setPagination] = useState<{ total: number; totalPages: number } | null>(null);

  const statusText = (status: "open" | "in_review" | "resolved" | "closed") => {
    if (language === "tr") {
      if (status === "open") return "Açık";
      if (status === "in_review") return "İnceleniyor";
      if (status === "resolved") return "Çözüldü";
      return "Kapandı";
    }
    if (status === "open") return "Open";
    if (status === "in_review") return "In Review";
    if (status === "resolved") return "Resolved";
    return "Closed";
  };

  const statusClass = (status: "open" | "in_review" | "resolved" | "closed") => {
    if (status === "open") return "is-pending";
    if (status === "in_review") return "is-approved";
    if (status === "resolved") return "is-done";
    return "is-disabled";
  };

  useEffect(() => {
    const loadComplaints = async () => {
      setLoading(true);
      setError(null);
      const query = new URLSearchParams({
        page: String(page),
        pageSize: "20",
        ...(statusFilter !== "all" ? { status: statusFilter } : {}),
        ...(searchInput.trim() ? { search: searchInput.trim() } : {}),
      });

      try {
        const response = await request(`/v1/admin/investigations/complaints?${query.toString()}`);
        const body = await parseJson<{
          data?: Array<{
            id: string;
            orderNo: string;
            complainantBuyerNo: string;
            subject: string;
            createdAt: string;
            status: "open" | "in_review" | "resolved" | "closed";
          }>;
          pagination?: { total: number; totalPages: number };
        } & ApiError>(response);
        if (response.status !== 200 || !body.data || !body.pagination) {
          setError(body.error?.message ?? dict.investigation.requestFailed);
          return;
        }
        setRows(body.data);
        setPagination(body.pagination);
      } catch {
        setError(dict.investigation.requestFailed);
      } finally {
        setLoading(false);
      }
    };

    loadComplaints().catch(() => setError(dict.investigation.requestFailed));
  }, [dict.investigation.requestFailed, page, searchInput, statusFilter]);

  return (
    <div className="app">
      <header className="topbar topbar-with-centered-search">
        <div>
          <p className="eyebrow">{dict.menu.investigation}</p>
          <h1>{dict.investigation.title}</h1>
          <p className="subtext">{dict.investigation.subtitle}</p>
        </div>
        <div className="topbar-search-center">
          <div className="users-search-wrap users-search-wrap--compact">
            <span className="users-search-icon" aria-hidden="true">
              <svg className="users-search-icon-svg" viewBox="0 0 24 24" fill="none" role="presentation">
                <circle cx="11" cy="11" r="7.2" stroke="currentColor" strokeWidth="2" />
                <path d="M16.7 16.7L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>
            <input
              className="users-search-input users-search-input--compact"
              placeholder={language === "tr" ? "Sipariş no / alıcı no / konu ara" : "Search order no / buyer no / subject"}
              value={searchInput}
              onChange={(event) => {
                setPage(1);
                setSearchInput(event.target.value);
              }}
            />
            {searchInput.trim().length > 0 ? (
              <button
                className="users-search-clear"
                type="button"
                aria-label={language === "tr" ? "Aramayı temizle" : "Clear search"}
                onClick={() => {
                  setPage(1);
                  setSearchInput("");
                }}
              >
                ×
              </button>
            ) : null}
          </div>
        </div>
        <div className="topbar-actions">
          <select
            value={statusFilter}
            onChange={(event) => {
              setPage(1);
              setStatusFilter(event.target.value as typeof statusFilter);
            }}
          >
            <option value="all">{language === "tr" ? "Tüm Durumlar" : "All Statuses"}</option>
            <option value="open">{statusText("open")}</option>
            <option value="in_review">{statusText("in_review")}</option>
            <option value="resolved">{statusText("resolved")}</option>
            <option value="closed">{statusText("closed")}</option>
          </select>
        </div>
      </header>

      <section className="panel">
        {error ? <div className="alert">{error}</div> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Display ID</th>
                <th>{language === "tr" ? "Sipariş Numarası" : "Order No"}</th>
                <th>{language === "tr" ? "Alıcı Numarası" : "Buyer No"}</th>
                <th>{language === "tr" ? "Konu" : "Subject"}</th>
                <th>{language === "tr" ? "Oluşturma Tarihi" : "Created At"}</th>
                <th>{language === "tr" ? "Durum" : "Status"}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6}>{dict.common.loading}</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6}>{dict.common.noRecords}</td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td>{toDisplayId(row.id)}</td>
                    <td>{row.orderNo}</td>
                    <td>{row.complainantBuyerNo}</td>
                    <td>{row.subject}</td>
                    <td>{new Date(row.createdAt).toLocaleString(language === "tr" ? "tr-TR" : "en-US")}</td>
                    <td>
                      <span className={`status-pill ${statusClass(row.status)}`}>{statusText(row.status)}</span>
                    </td>
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
    </div>
  );
}

function FoodsLotsPage({ language }: { language: Language }) {
  const dict = DICTIONARIES[language];
  const [rows, setRows] = useState<
    Array<{
      id: string;
      name: string;
      sellerId: string;
      isActive: boolean;
      price: number;
      updatedAt: string;
      recipe: string | null;
      ingredientsJson: unknown;
      allergensJson: unknown;
    }>
  >([]);
  const [sellerNameById, setSellerNameById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<{ total: number; totalPages: number } | null>(null);
  const [expandedFoodIds, setExpandedFoodIds] = useState<Record<string, boolean>>({});
  const [lotsByFoodId, setLotsByFoodId] = useState<Record<string, AdminLotRow[]>>({});
  const [lotsLoadingByFoodId, setLotsLoadingByFoodId] = useState<Record<string, boolean>>({});
  const [lotsErrorByFoodId, setLotsErrorByFoodId] = useState<Record<string, string | null>>({});
  const [expandedLotIds, setExpandedLotIds] = useState<Record<string, boolean>>({});
  const [lotOrdersByLotId, setLotOrdersByLotId] = useState<Record<string, AdminLotOrderRow[]>>({});
  const [lotOrdersLoadingByLotId, setLotOrdersLoadingByLotId] = useState<Record<string, boolean>>({});
  const [lotOrdersErrorByLotId, setLotOrdersErrorByLotId] = useState<Record<string, string | null>>({});
  const pageSize = 20;

  useEffect(() => {
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sortDir: "desc",
      ...(search ? { search } : {}),
    });
    request(`/v1/admin/metadata/tables/foods/records?${query.toString()}`)
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
          };
          pagination: {
            total: number;
            totalPages: number;
          };
        }>(response);
        const mapped = body.data.rows
          .map((record) => ({
            id: String(record.id ?? ""),
            name: String(record.name ?? "-"),
            sellerId: String(record.seller_id ?? ""),
            isActive: Boolean(record.is_active),
            price: Number(record.price ?? 0),
            updatedAt: String(record.updated_at ?? ""),
            recipe: typeof record.recipe === "string" ? record.recipe : null,
            ingredientsJson: record.ingredients_json ?? null,
            allergensJson: record.allergens_json ?? null,
          }))
          .filter((row) => row.id.length > 0);
        setRows(mapped);
        setPagination({ total: body.pagination.total, totalPages: body.pagination.totalPages });
        setLoading(false);
      })
      .catch(() => {
        setError(dict.entities.recordsRequestFailed);
        setLoading(false);
      });
  }, [dict.entities.loadRecordsFailed, dict.entities.recordsRequestFailed, page, pageSize, search]);

  useEffect(() => {
    const missingSellerIds = Array.from(new Set(rows.map((row) => row.sellerId).filter((sellerId) => sellerId && !sellerNameById[sellerId])));
    if (missingSellerIds.length === 0) return;
    let active = true;
    Promise.all(
      missingSellerIds.map(async (sellerId) => {
        try {
          const response = await request(`/v1/admin/users/${sellerId}`);
          if (response.status !== 200) return [sellerId, sellerId] as const;
          const body = await parseJson<{ data?: { displayName?: string | null; email?: string | null } }>(response);
          return [sellerId, body.data?.displayName || body.data?.email || sellerId] as const;
        } catch {
          return [sellerId, sellerId] as const;
        }
      })
    ).then((entries) => {
      if (!active) return;
      setSellerNameById((prev) => {
        const next = { ...prev };
        for (const [sellerId, label] of entries) next[sellerId] = label;
        return next;
      });
    });
    return () => {
      active = false;
    };
  }, [rows, sellerNameById]);

  async function loadFoodLots(foodId: string) {
    setLotsLoadingByFoodId((prev) => ({ ...prev, [foodId]: true }));
    setLotsErrorByFoodId((prev) => ({ ...prev, [foodId]: null }));
    try {
      const lots = await fetchAllAdminLots({ foodId });
      setLotsByFoodId((prev) => ({ ...prev, [foodId]: lots }));
    } catch (fetchError) {
      setLotsErrorByFoodId((prev) => ({
        ...prev,
        [foodId]: fetchError instanceof Error ? fetchError.message : dict.detail.requestFailed,
      }));
    } finally {
      setLotsLoadingByFoodId((prev) => ({ ...prev, [foodId]: false }));
    }
  }

  async function loadLotOrders(lotId: string) {
    if (lotOrdersByLotId[lotId]) return;
    setLotOrdersLoadingByLotId((prev) => ({ ...prev, [lotId]: true }));
    setLotOrdersErrorByLotId((prev) => ({ ...prev, [lotId]: null }));
    try {
      const response = await request(`/v1/admin/lots/${lotId}/orders`);
      if (response.status !== 200) {
        const body = await parseJson<ApiError>(response);
        setLotOrdersErrorByLotId((prev) => ({ ...prev, [lotId]: body.error?.message ?? dict.detail.requestFailed }));
        return;
      }
      const body = await parseJson<{ data: AdminLotOrderRow[] }>(response);
      setLotOrdersByLotId((prev) => ({ ...prev, [lotId]: body.data ?? [] }));
    } catch {
      setLotOrdersErrorByLotId((prev) => ({ ...prev, [lotId]: dict.detail.requestFailed }));
    } finally {
      setLotOrdersLoadingByLotId((prev) => ({ ...prev, [lotId]: false }));
    }
  }

  return (
    <div className="app">
      <header className="topbar topbar-with-centered-search">
        <div>
          <p className="eyebrow">{dict.menu.foods}</p>
          <h1>{dict.menu.foods}</h1>
          <p className="subtext">{dict.detail.foodsLotsSubtitle}</p>
        </div>
        <div className="topbar-search-center">
          <div className="users-search-wrap users-search-wrap--compact">
            <span className="users-search-icon" aria-hidden="true">
              <svg className="users-search-icon-svg" viewBox="0 0 24 24" fill="none" role="presentation">
                <circle cx="11" cy="11" r="7.2" stroke="currentColor" strokeWidth="2" />
                <path d="M16.7 16.7L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>
            <input
              className="users-search-input users-search-input--compact"
              placeholder={dict.entities.searchPlaceholder}
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
            />
            {search.trim().length > 0 ? (
              <button
                className="users-search-clear"
                type="button"
                aria-label={language === "tr" ? "Aramayı temizle" : "Clear search"}
                onClick={() => {
                  setPage(1);
                  setSearch("");
                }}
              >
                ×
              </button>
            ) : null}
          </div>
        </div>
        <div className="topbar-actions">
        </div>
      </header>

      <section className="panel">
        {error ? <div className="alert">{error}</div> : null}
        <div className="table-wrap">
          <table className="foods-lots-main-table">
            <thead>
              <tr>
                <th>{language === "tr" ? "Display ID" : "Display ID"}</th>
                <th>{dict.detail.foodName}</th>
                <th>{dict.detail.foodSeller}</th>
                <th>{dict.detail.foodStatus}</th>
                <th>{dict.detail.foodPrice}</th>
                <th>{dict.detail.updatedAtLabel}</th>
                <th>{dict.detail.lotSummary}</th>
                <th>{dict.detail.lotActions}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8}>{dict.common.loading}</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8}>{dict.common.noRecords}</td>
                </tr>
              ) : (
                rows.map((food) => {
                  const lots = lotsByFoodId[food.id] ?? [];
                  const activeLots = lots.filter((lot) => lot.lifecycle_status === "on_sale").length;
                  const recalledLots = lots.filter((lot) => lot.lifecycle_status === "recalled").length;
                  const foodExpanded = Boolean(expandedFoodIds[food.id]);
                  return (
                    <Fragment key={food.id}>
                      <tr>
                        <td>{toDisplayId(food.id)}</td>
                        <td>
                          <strong>{food.name}</strong>
                        </td>
                        <td>{sellerNameById[food.sellerId] ?? toDisplayId(food.sellerId)}</td>
                        <td>
                          <span className={`status-pill ${food.isActive ? "is-active" : "is-disabled"}`}>
                            {food.isActive ? dict.common.active : dict.common.disabled}
                          </span>
                        </td>
                        <td>{formatCurrency(food.price, language)}</td>
                        <td>{formatUiDate(food.updatedAt, language)}</td>
                        <td>
                          <div className="lot-summary-cell">
                            <span>{`${dict.detail.lotsTitle}: ${lots.length}`}</span>
                            <span>{`${language === "tr" ? "Satışta" : "On Sale"}: ${activeLots}`}</span>
                            {recalledLots > 0 ? <span className="lot-summary-danger">{`${language === "tr" ? "Geri çağrılan" : "Recalled"}: ${recalledLots}`}</span> : null}
                          </div>
                        </td>
                        <td>
                          <button
                            className="ghost"
                            type="button"
                            onClick={() => {
                              const next = !foodExpanded;
                              setExpandedFoodIds((prev) => ({ ...prev, [food.id]: next }));
                              if (next && !lotsByFoodId[food.id] && !lotsLoadingByFoodId[food.id]) {
                                void loadFoodLots(food.id);
                              }
                            }}
                          >
                            {foodExpanded ? dict.detail.hideLots : dict.detail.showLots}
                          </button>
                        </td>
                      </tr>
                      {foodExpanded ? (
                        <tr className="foods-lots-expanded-row">
                          <td colSpan={8}>
                            {lotsLoadingByFoodId[food.id] ? (
                              <p className="panel-meta">{dict.common.loading}</p>
                            ) : lotsErrorByFoodId[food.id] ? (
                              <div className="alert">{lotsErrorByFoodId[food.id]}</div>
                            ) : lots.length === 0 ? (
                              <p className="panel-meta">{dict.detail.noLotsForFood}</p>
                            ) : (
                              <div className="seller-food-lots-table-wrap">
                                <table className="seller-food-lots-table">
                                  <thead>
                                    <tr>
                                      <th>{dict.detail.lotNumber}</th>
                                      <th>{dict.detail.lotLifecycle}</th>
                                      <th>{dict.detail.lotQuantity}</th>
                                      <th>{dict.detail.lotProducedAt}</th>
                                      <th>{dict.detail.lotSaleWindow}</th>
                                      <th>{dict.detail.lotSnapshot}</th>
                                      <th>{dict.detail.lotActions}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {lots.map((lot) => {
                                      const diff = computeFoodLotDiff({
                                        foodRecipe: food.recipe,
                                        foodIngredients: food.ingredientsJson,
                                        foodAllergens: food.allergensJson,
                                        lot,
                                      });
                                      const lotExpanded = Boolean(expandedLotIds[lot.id]);
                                      const lotOrders = lotOrdersByLotId[lot.id] ?? [];
                                      return (
                                        <Fragment key={lot.id}>
                                          <tr>
                                            <td>{lot.lot_number}</td>
                                            <td>
                                              <span className={`status-pill ${lotLifecycleClass(lot.lifecycle_status)}`}>
                                                {lotLifecycleLabel(lot.lifecycle_status, language)}
                                              </span>
                                            </td>
                                            <td>{`${lot.quantity_available}/${lot.quantity_produced}`}</td>
                                            <td>{formatUiDate(lot.produced_at, language)}</td>
                                            <td>{`${formatUiDate(lot.sale_starts_at, language)} - ${formatUiDate(lot.sale_ends_at, language)}`}</td>
                                            <td>
                                              <div className="lot-diff-badges">
                                                {diff.hasMissingSnapshot ? <span className="status-pill is-danger">{dict.detail.lotSnapshotMissing}</span> : null}
                                                {diff.recipeChanged ? <span className="status-pill is-warning">{dict.detail.lotDiffRecipe}</span> : null}
                                                {diff.ingredientsChanged ? <span className="status-pill is-warning">{dict.detail.lotDiffIngredients}</span> : null}
                                                {diff.allergensChanged ? <span className="status-pill is-danger">{dict.detail.lotDiffAllergens}</span> : null}
                                                {!diff.hasMissingSnapshot && !diff.recipeChanged && !diff.ingredientsChanged && !diff.allergensChanged ? (
                                                  <span className="status-pill is-success">{dict.detail.lotSnapshotOk}</span>
                                                ) : null}
                                              </div>
                                            </td>
                                            <td>
                                              <button
                                                className="ghost"
                                                type="button"
                                                onClick={() => {
                                                  const next = !lotExpanded;
                                                  setExpandedLotIds((prev) => ({ ...prev, [lot.id]: next }));
                                                  if (next) {
                                                    void loadLotOrders(lot.id);
                                                  }
                                                }}
                                              >
                                                {lotExpanded ? dict.detail.hideLotOrders : dict.detail.showLotOrders}
                                              </button>
                                            </td>
                                          </tr>
                                          {lotExpanded ? (
                                            <tr className="lot-orders-row">
                                              <td colSpan={7}>
                                                {lotOrdersLoadingByLotId[lot.id] ? (
                                                  <p className="panel-meta">{dict.common.loading}</p>
                                                ) : lotOrdersErrorByLotId[lot.id] ? (
                                                  <div className="alert">{lotOrdersErrorByLotId[lot.id]}</div>
                                                ) : lotOrders.length === 0 ? (
                                                  <p className="panel-meta">{dict.detail.noOrdersForLot}</p>
                                                ) : (
                                                  <div className="seller-food-lot-orders-wrap">
                                                    <table className="seller-food-lot-orders-table">
                                                      <thead>
                                                        <tr>
                                                          <th>{language === "tr" ? "Sipariş" : "Order"}</th>
                                                          <th>{language === "tr" ? "Durum" : "Status"}</th>
                                                          <th>{language === "tr" ? "Alıcı" : "Buyer"}</th>
                                                          <th>{language === "tr" ? "Adet" : "Quantity"}</th>
                                                          <th>{language === "tr" ? "Tarih" : "Created"}</th>
                                                        </tr>
                                                      </thead>
                                                      <tbody>
                                                        {lotOrders.map((order) => (
                                                          <tr key={`${lot.id}-${order.order_id}`}>
                                                            <td>{`#${order.order_id.slice(0, 10).toUpperCase()}`}</td>
                                                            <td>{order.status}</td>
                                                            <td>{order.buyer_id}</td>
                                                            <td>{order.quantity_allocated}</td>
                                                            <td>{formatUiDate(order.created_at, language)}</td>
                                                          </tr>
                                                        ))}
                                                      </tbody>
                                                    </table>
                                                  </div>
                                                )}
                                              </td>
                                            </tr>
                                          ) : null}
                                        </Fragment>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
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
    </div>
  );
}

function RecordsPage({ language, tableKey }: { language: Language; tableKey: "orders" | "foods" }) {
  const dict = DICTIONARIES[language];
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [userNameById, setUserNameById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<{ total: number; totalPages: number } | null>(null);
  const pageSize = 20;

  const pageTitle = tableKey === "orders" ? dict.menu.orders : dict.menu.foods;
  const subtitle =
    language === "tr"
      ? tableKey === "orders"
        ? "Veritabanındaki sipariş kayıtlarını görüntüleyin."
        : "Veritabanındaki yemek kayıtlarını görüntüleyin."
      : tableKey === "orders"
        ? "Browse order records from the database."
        : "Browse food records from the database.";

  const orderColumns = useMemo(() => {
    if (tableKey !== "orders") return columns;
    const hiddenOrderColumns = new Set([
      "id",
      "updated_at",
      "requested_at",
      "estimated_delivery_time",
      "delivery_address_json",
    ]);
    const filtered = columns.filter((column) => !hiddenOrderColumns.has(column));
    const preferred = ["created_at", "buyer_id", "seller_id", "status", "payment_completed"];
    const used = new Set<string>();
    const ordered: string[] = [];
    for (const name of preferred) {
      if (filtered.includes(name)) {
        ordered.push(name);
        used.add(name);
      }
    }
    for (const name of filtered) {
      if (!used.has(name)) ordered.push(name);
    }
    return ordered;
  }, [columns, tableKey]);

  const orderColumnLabel = (column: string): string => {
    if (column === "__display_id") return language === "tr" ? "Display ID" : "Display ID";
    if (column === "created_at") return language === "tr" ? "Tarih" : "Date";
    if (column === "buyer_id") return language === "tr" ? "Alıcı" : "Buyer";
    if (column === "seller_id") return language === "tr" ? "Satıcı" : "Seller";
    if (column === "payment_completed") return language === "tr" ? "Ödeme" : "Payment";
    return formatTableHeader(column);
  };

  const formatOrderCreatedAt = (value: unknown): string => {
    const iso = String(value ?? "");
    const timestamp = Date.parse(iso);
    if (Number.isNaN(timestamp)) return "-";
    const date = new Date(timestamp);
    const now = new Date();
    const isToday =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();
    if (isToday) {
      const diffMs = Math.max(0, now.getTime() - timestamp);
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return language === "tr" ? "az önce" : "just now";
      if (diffMin < 60) return language === "tr" ? `${diffMin} dk önce` : `${diffMin} min ago`;
      const diffHours = Math.floor(diffMin / 60);
      return language === "tr" ? `${diffHours} saat önce` : `${diffHours} hours ago`;
    }
    const pad2 = (num: number) => String(num).padStart(2, "0");
    return `${pad2(date.getDate())}-${pad2(date.getMonth() + 1)}-${date.getFullYear()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  };

  const orderStatusMeta = (rawStatus: unknown): { label: string; note: string; toneClass: string } => {
    const status = String(rawStatus ?? "").trim().toLowerCase();
    const tr = language === "tr";
    const map: Record<string, { label: string; note: string; toneClass: string }> = {
      pending_seller_approval: {
        label: tr ? "Onay bekliyor" : "Pending approval",
        note: tr ? "Satıcı onayı bekleniyor" : "Waiting for seller approval",
        toneClass: "is-pending",
      },
      seller_approved: {
        label: tr ? "Onaylandı" : "Approved",
        note: tr ? "Satıcı tarafından onaylandı" : "Approved by seller",
        toneClass: "is-approved",
      },
      awaiting_payment: {
        label: tr ? "Ödeme bekliyor" : "Awaiting payment",
        note: tr ? "Ödeme adımı bekleniyor" : "Waiting for payment",
        toneClass: "is-pending",
      },
      paid: {
        label: tr ? "Ödendi" : "Paid",
        note: tr ? "Ödeme tamamlandı" : "Payment completed",
        toneClass: "is-paid",
      },
      preparing: {
        label: tr ? "Hazırlanıyor" : "Preparing",
        note: tr ? "Sipariş hazırlanıyor" : "Order is being prepared",
        toneClass: "is-pending",
      },
      ready: {
        label: tr ? "Teslime hazır" : "Ready",
        note: tr ? "Teslimata çıkmayı bekliyor" : "Waiting for delivery pickup",
        toneClass: "is-approved",
      },
      in_delivery: {
        label: tr ? "Teslimatta" : "In delivery",
        note: tr ? "Teslimat bekliyor" : "Out for delivery",
        toneClass: "is-delivery",
      },
      delivered: {
        label: tr ? "Teslim edildi" : "Delivered",
        note: tr ? "Teslimat tamamlandı" : "Delivery completed",
        toneClass: "is-done",
      },
      completed: {
        label: tr ? "Tamamlandı" : "Completed",
        note: tr ? "Sipariş kapanışı yapıldı" : "Order completed",
        toneClass: "is-done",
      },
    };
    return map[status] ?? {
      label: status ? status.replace(/_/g, " ") : dict.common.counterpartNotFound,
      note: tr ? "Durum notu bulunamadı" : "Status note not found",
      toneClass: "is-pending",
    };
  };

  const renderRecordsCell = (column: string, value: unknown): ReactNode => {
    if (tableKey !== "orders") return renderCell(value, column);

    if (column === "__display_id") {
      return toDisplayId(value);
    }

    if (column === "created_at") {
      return formatOrderCreatedAt(value);
    }

    if (column === "buyer_id" || column === "seller_id") {
      const raw = String(value ?? "").trim();
      if (!raw) return "-";
      return userNameById[raw] ?? raw;
    }

    if (column === "status") {
      const meta = orderStatusMeta(value);
      return <span className={`status-pill order-status-pill ${meta.toneClass}`}>{meta.label}</span>;
    }

    if (column === "payment_completed") {
      const done = value === true || String(value).toLowerCase() === "true";
      return (
        <span className={`status-pill ${done ? "is-success" : "is-warning"}`}>
          {done ? (language === "tr" ? "Tamamlandı" : "Completed") : (language === "tr" ? "Bekliyor" : "Pending")}
        </span>
      );
    }

    return renderCell(value, column);
  };

  useEffect(() => {
    setLoading(true);
    setError(null);

    const query = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sortDir: "desc",
      ...(search ? { search } : {}),
    });

    request(`/v1/admin/metadata/tables/${tableKey}/records?${query.toString()}`)
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
  }, [dict.entities.loadRecordsFailed, dict.entities.recordsRequestFailed, page, pageSize, search, tableKey]);

  useEffect(() => {
    if (tableKey !== "orders") return;
    const missingIds = Array.from(
      new Set(
        rows
          .flatMap((row) => [String(row.buyer_id ?? ""), String(row.seller_id ?? "")])
          .map((id) => id.trim())
          .filter((id) => id && !userNameById[id])
      )
    );
    if (missingIds.length === 0) return;
    let active = true;
    Promise.all(
      missingIds.map(async (id) => {
        try {
          const response = await request(`/v1/admin/users/${id}`);
          if (response.status !== 200) return [id, id] as const;
          const body = await parseJson<{ data?: { displayName?: string | null; email?: string | null } }>(response);
          return [id, body.data?.displayName || body.data?.email || id] as const;
        } catch {
          return [id, id] as const;
        }
      })
    ).then((pairs) => {
      if (!active) return;
      setUserNameById((prev) => {
        const next = { ...prev };
        for (const [id, label] of pairs) next[id] = label;
        return next;
      });
    });
    return () => {
      active = false;
    };
  }, [rows, tableKey, userNameById]);

  return (
    <div className="app">
      <header className="topbar topbar-with-centered-search">
        <div>
          <p className="eyebrow">{dict.entities.eyebrow}</p>
          <h1>{pageTitle}</h1>
          <p className="subtext">{subtitle}</p>
        </div>
        <div className="topbar-search-center">
          <div className="users-search-wrap users-search-wrap--compact">
            <span className="users-search-icon" aria-hidden="true">
              <svg className="users-search-icon-svg" viewBox="0 0 24 24" fill="none" role="presentation">
                <circle cx="11" cy="11" r="7.2" stroke="currentColor" strokeWidth="2" />
                <path d="M16.7 16.7L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>
            <input
              className="users-search-input users-search-input--compact"
              placeholder={dict.entities.searchPlaceholder}
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
            />
            {search.trim().length > 0 ? (
              <button
                className="users-search-clear"
                type="button"
                aria-label={language === "tr" ? "Aramayı temizle" : "Clear search"}
                onClick={() => {
                  setPage(1);
                  setSearch("");
                }}
              >
                ×
              </button>
            ) : null}
          </div>
        </div>
        <div className="topbar-actions">
        </div>
      </header>
      <section className="panel">
        {error ? <div className="alert">{error}</div> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {(tableKey === "orders" ? ["__display_id", ...orderColumns] : orderColumns).map((column) => (
                  <th key={column}>{tableKey === "orders" ? orderColumnLabel(column) : formatTableHeader(column)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={Math.max((tableKey === "orders" ? orderColumns.length + 1 : orderColumns.length), 1)}>{dict.common.loading}</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={Math.max((tableKey === "orders" ? orderColumns.length + 1 : orderColumns.length), 1)}>{dict.common.noRecords}</td>
                </tr>
              ) : (
                rows.map((row, index) => (
                  <tr key={`${tableKey}-${index}`}>
                    {(tableKey === "orders" ? ["__display_id", ...orderColumns] : orderColumns).map((column) => (
                      <td key={`${index}-${column}`}>
                        {renderRecordsCell(column, column === "__display_id" ? row.id : row[column])}
                      </td>
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
      <header className="topbar topbar-with-centered-search">
        <div>
          <p className="eyebrow">{dict.entities.eyebrow}</p>
          <h1>{selectedEntity ? selectedEntity.tableName : dict.entities.titleAll}</h1>
          <p className="subtext">{dict.entities.subtitle}</p>
        </div>
        <div className="topbar-search-center">
          <div className="users-search-wrap users-search-wrap--compact">
            <span className="users-search-icon" aria-hidden="true">
              <svg className="users-search-icon-svg" viewBox="0 0 24 24" fill="none" role="presentation">
                <circle cx="11" cy="11" r="7.2" stroke="currentColor" strokeWidth="2" />
                <path d="M16.7 16.7L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>
            <input
              className="users-search-input users-search-input--compact"
              placeholder={dict.entities.searchPlaceholder}
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
            />
            {search.trim().length > 0 ? (
              <button
                className="users-search-clear"
                type="button"
                aria-label={language === "tr" ? "Aramayı temizle" : "Clear search"}
                onClick={() => {
                  setPage(1);
                  setSearch("");
                }}
              >
                ×
              </button>
            ) : null}
          </div>
        </div>
        <div className="topbar-actions">
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
                  <th>{language === "tr" ? "Display ID" : "Display ID"}</th>
                  {columns.map((column) => (
                    <th key={column}>{formatTableHeader(column)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={Math.max(columns.length + 1, 1)}>{dict.common.loading}</td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={Math.max(columns.length + 1, 1)}>{dict.common.noRecords}</td>
                  </tr>
                ) : (
                  rows.map((row, index) => (
                    <tr key={`${selectedTableKey}-${index}`}>
                      <td>{toDisplayId(row.id ?? row.order_id ?? row.food_id ?? "")}</td>
                      {columns.map((column) => (
                        <td key={`${index}-${column}`}>{renderCell(row[column], column)}</td>
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

function renderCell(value: unknown, columnName?: string): ReactNode {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    const raw = value.trim();
    const normalizedColumn = String(columnName ?? "").trim().toLowerCase();
    const imageColumn = normalizedColumn === "image_url" || normalizedColumn === "imageurl";
    const imageUrlPattern = /^(https?:\/\/\S+|\/\S+)\.(?:png|jpe?g|gif|webp|svg)(?:\?\S*)?$/i;
    if (imageColumn || imageUrlPattern.test(raw)) {
      return raw;
    }
  }
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
  }, [
    filters.page,
    filters.pageSize,
    filters.source,
    filters.eventType,
    filters.actorId,
    filters.entityType,
    filters.search,
    filters.from,
    filters.to,
    filters.sortBy,
    filters.sortDir,
    dict.audit.requestFailed,
  ]);

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
          <label className="audit-search-field">
            {dict.audit.search}
            <div className="users-search-wrap users-search-wrap--compact">
              <span className="users-search-icon" aria-hidden="true">
                <svg className="users-search-icon-svg" viewBox="0 0 24 24" fill="none" role="presentation">
                  <circle cx="11" cy="11" r="7.2" stroke="currentColor" strokeWidth="2" />
                  <path d="M16.7 16.7L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </span>
              <input
                className="users-search-input users-search-input--compact"
                placeholder={dict.audit.search}
                value={filters.search}
                onChange={(event) => setFilters((prev) => ({ ...prev, page: 1, search: event.target.value }))}
              />
              {filters.search.trim().length > 0 ? (
                <button
                  className="users-search-clear"
                  type="button"
                  aria-label={language === "tr" ? "Aramayı temizle" : "Clear search"}
                  onClick={() => setFilters((prev) => ({ ...prev, page: 1, search: "" }))}
                >
                  ×
                </button>
              ) : null}
            </div>
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

type AdminApiTokenResponse = {
  data?: {
    label: string;
    role: "admin" | "super_admin";
    token: string;
    createdAt: string;
    preview: {
      iat: string | null;
      exp: string | null;
      claims: Record<string, unknown>;
    } | null;
  };
} & ApiError;

type AdminApiTokenListItem = {
  id: string;
  sessionId: string;
  label: string;
  role: "admin" | "super_admin";
  tokenPreview: string;
  createdAt: string;
  revokedAt: string | null;
  createdByAdminId: string;
  createdByEmail: string | null;
};

type ComplianceDocumentListRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  source_info: string | null;
  details: string | null;
  is_active: boolean;
  is_required_default: boolean;
  seller_assignment_count: string;
  created_at: string;
  updated_at: string;
};

function ApiTokensPage({ language, isSuperAdmin }: { language: Language; isSuperAdmin: boolean }) {
  const dict = DICTIONARIES[language];
  const [label, setLabel] = useState("");
  const [role, setRole] = useState<"admin" | "super_admin">("admin");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<AdminApiTokenListItem[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(false);

  async function loadTokens() {
    setLoadingRecords(true);
    try {
      const response = await request("/v1/admin/api-tokens/admin");
      const body = await parseJson<{ data?: AdminApiTokenListItem[] } & ApiError>(response);
      if (response.status !== 200 || !body.data) return;
      setRecords(body.data);
    } finally {
      setLoadingRecords(false);
    }
  }

  useEffect(() => {
    loadTokens().catch(() => undefined);
  }, []);

  async function createToken() {
    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      setError(dict.apiTokens.tokenCreateFailed);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await request("/v1/admin/api-tokens/admin", {
        method: "POST",
        body: JSON.stringify({
          label: trimmedLabel,
          role,
        }),
      });
      const body = await parseJson<AdminApiTokenResponse>(response);
      if (response.status !== 201 || !body.data) {
        setError(body.error?.message ?? dict.apiTokens.tokenCreateFailed);
        return;
      }
      setLabel("");
      await loadTokens();
    } catch {
      setError(dict.apiTokens.tokenRequestFailed);
    } finally {
      setSaving(false);
    }
  }

  async function copyPreviewToken(value: string) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <p className="eyebrow">{dict.apiTokens.eyebrow}</p>
          <h1>{dict.apiTokens.title}</h1>
          <p className="subtext">{dict.apiTokens.subtitle}</p>
        </div>
      </header>

      <section className="panel">
        <div className="panel-header">
          <h2>{dict.apiTokens.create}</h2>
          <span className="panel-meta">{dict.apiTokens.nonExpiring}</span>
        </div>
        <div className="form-grid">
          <label>
            {dict.apiTokens.label}
            <input value={label} placeholder={dict.apiTokens.labelPlaceholder} onChange={(event) => setLabel(event.target.value)} />
          </label>
          <label>
            {dict.apiTokens.role}
            <select value={role} onChange={(event) => setRole(event.target.value as "admin" | "super_admin")}>
              <option value="admin">{dict.users.roleAdmin}</option>
              <option value="super_admin" disabled={!isSuperAdmin}>{dict.users.roleSuperAdmin}</option>
            </select>
          </label>
        </div>
        {error ? <div className="alert">{error}</div> : null}
        <div className="topbar-actions">
          <button className="primary" type="button" disabled={saving} onClick={() => createToken()}>
            {dict.apiTokens.create}
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>{language === "tr" ? "Kayıtlı API Tokenları" : "Saved API Tokens"}</h2>
          <span className="panel-meta">{loadingRecords ? dict.common.loading : `${records.length}`}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{dict.apiTokens.label}</th>
                <th>{dict.apiTokens.role}</th>
                <th>{language === "tr" ? "Token Önizleme" : "Token Preview"}</th>
                <th>{language === "tr" ? "Oluşturan" : "Created By"}</th>
                <th>{language === "tr" ? "Oluşturulma" : "Created At"}</th>
                <th>{language === "tr" ? "Durum" : "Status"}</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={6}>{dict.apiTokens.noToken}</td>
                </tr>
              ) : (
                records.map((row) => (
                  <tr key={row.id}>
                    <td>{row.label}</td>
                    <td>{adminRoleLabel(dict, row.role)}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <code>{row.tokenPreview}</code>
                        <button className="ghost" type="button" onClick={() => copyPreviewToken(row.tokenPreview)}>
                          {dict.apiTokens.copyToken}
                        </button>
                      </div>
                    </td>
                    <td>{row.createdByEmail ?? row.createdByAdminId}</td>
                    <td>{row.createdAt.replace("T", " ").replace("Z", "").slice(0, 19)}</td>
                    <td>{row.revokedAt ? (language === "tr" ? "İptal" : "Revoked") : (language === "tr" ? "Aktif" : "Active")}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ComplianceDocumentsPage({ language, isSuperAdmin }: { language: Language; isSuperAdmin: boolean }) {
  const dict = DICTIONARIES[language];
  const [rows, setRows] = useState<ComplianceDocumentListRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [createCode, setCreateCode] = useState("");
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createSourceInfo, setCreateSourceInfo] = useState("");
  const [createDetails, setCreateDetails] = useState("");
  const [createIsActive, setCreateIsActive] = useState(true);
  const [createIsRequiredDefault, setCreateIsRequiredDefault] = useState(true);
  const [editingRow, setEditingRow] = useState<ComplianceDocumentListRow | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [editSourceInfo, setEditSourceInfo] = useState("");
  const [editDetails, setEditDetails] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);
  const [editIsRequiredDefault, setEditIsRequiredDefault] = useState(true);

  async function loadRows() {
    setLoading(true);
    try {
      const response = await request("/v1/admin/compliance/document-list");
      const body = await parseJson<{ data?: ComplianceDocumentListRow[] } & ApiError>(response);
      if (response.status !== 200 || !body.data) {
        setMessage(body.error?.message ?? dict.complianceDocuments.loadFailed);
        return;
      }
      setRows(body.data);
    } catch {
      setMessage(dict.complianceDocuments.requestFailed);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRows().catch(() => setMessage(dict.complianceDocuments.requestFailed));
  }, [dict.complianceDocuments.requestFailed]);

  function resetCreateForm() {
    setCreateCode("");
    setCreateName("");
    setCreateDescription("");
    setCreateSourceInfo("");
    setCreateDetails("");
    setCreateIsActive(true);
    setCreateIsRequiredDefault(true);
  }

  function closeEditModal() {
    if (saving) return;
    setEditingRow(null);
    setEditDescription("");
    setEditSourceInfo("");
    setEditDetails("");
    setEditIsActive(true);
    setEditIsRequiredDefault(true);
  }

  async function submitCreateForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isSuperAdmin || saving) return;
    if (!createCode.trim() || !createName.trim()) {
      setMessage(dict.complianceDocuments.validationRequired);
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        code: createCode.trim(),
        name: createName.trim(),
        description: createDescription.trim() || null,
        sourceInfo: createSourceInfo.trim() || null,
        details: createDetails.trim() || null,
        isActive: createIsActive,
        isRequiredDefault: createIsRequiredDefault,
      };
      const response = await request("/v1/admin/compliance/document-list", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const body = await parseJson<ApiError>(response);
      if (response.status !== 201) {
        setMessage(body.error?.message ?? dict.complianceDocuments.saveFailed);
        return;
      }
      await loadRows();
      resetCreateForm();
      setMessage(dict.common.saved);
    } catch {
      setMessage(dict.complianceDocuments.requestFailed);
    } finally {
      setSaving(false);
    }
  }

  async function submitEditForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isSuperAdmin || saving || !editingRow) return;

    setSaving(true);
    setMessage(null);
    try {
      const response = await request(`/v1/admin/compliance/document-list/${editingRow.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          description: editDescription.trim() || null,
          sourceInfo: editSourceInfo.trim() || null,
          details: editDetails.trim() || null,
          isActive: editIsActive,
          isRequiredDefault: editIsRequiredDefault,
        }),
      });
      const body = await parseJson<ApiError>(response);
      if (response.status !== 200) {
        setMessage(body.error?.message ?? dict.complianceDocuments.saveFailed);
        return;
      }
      await loadRows();
      closeEditModal();
      setMessage(dict.common.saved);
    } catch {
      setMessage(dict.complianceDocuments.requestFailed);
    } finally {
      setSaving(false);
    }
  }

  async function removeRow(row: ComplianceDocumentListRow) {
    if (!isSuperAdmin || saving) return;
    const confirmed = window.confirm(
      language === "tr"
        ? `${row.name} kaydini pasif yapmak istiyor musunuz?`
        : `Set document type ${row.name} as inactive?`
    );
    if (!confirmed) return;

    setSaving(true);
    setMessage(null);
    try {
      const response = await request(`/v1/admin/compliance/document-list/${row.id}`, {
        method: "DELETE",
      });
      const body = await parseJson<ApiError>(response);
      if (response.status !== 200) {
        setMessage(body.error?.message ?? dict.complianceDocuments.deleteFailed);
        return;
      }
      await loadRows();
      if (editingRow?.id === row.id) closeEditModal();
      setMessage(dict.common.saved);
    } catch {
      setMessage(dict.complianceDocuments.requestFailed);
    } finally {
      setSaving(false);
    }
  }

  function startEdit(row: ComplianceDocumentListRow) {
    setEditingRow(row);
    setEditDescription(row.description ?? "");
    setEditSourceInfo(row.source_info ?? "");
    setEditDetails(row.details ?? "");
    setEditIsActive(row.is_active);
    setEditIsRequiredDefault(row.is_required_default);
  }

  async function toggleRequiredDefault(row: ComplianceDocumentListRow) {
    if (!isSuperAdmin || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await request(`/v1/admin/compliance/document-list/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isRequiredDefault: !row.is_required_default }),
      });
      const body = await parseJson<ApiError>(response);
      if (response.status !== 200) {
        setMessage(body.error?.message ?? dict.complianceDocuments.saveFailed);
        return;
      }
      await loadRows();
      setMessage(dict.common.saved);
    } catch {
      setMessage(dict.complianceDocuments.requestFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <p className="eyebrow">{dict.complianceDocuments.eyebrow}</p>
          <h1>{dict.complianceDocuments.title}</h1>
          <p className="subtext">{dict.complianceDocuments.subtitle}</p>
        </div>
      </header>

      <section className="panel">
        <div className="panel-header">
          <h2>{dict.complianceDocuments.createDocument}</h2>
          <span className="panel-meta">{isSuperAdmin ? dict.common.yes : dict.common.readOnly}</span>
        </div>
        <form className="form-grid" onSubmit={submitCreateForm}>
          <label>
            {dict.complianceDocuments.code}
            <input value={createCode} onChange={(event) => setCreateCode(event.target.value)} disabled={!isSuperAdmin || saving} />
          </label>
          <label>
            {dict.complianceDocuments.name}
            <input value={createName} onChange={(event) => setCreateName(event.target.value)} disabled={!isSuperAdmin || saving} />
          </label>
          <label>
            {dict.complianceDocuments.description}
            <textarea value={createDescription} onChange={(event) => setCreateDescription(event.target.value)} rows={3} disabled={!isSuperAdmin || saving} />
          </label>
          <label>
            {dict.complianceDocuments.sourceInfo}
            <textarea value={createSourceInfo} onChange={(event) => setCreateSourceInfo(event.target.value)} rows={3} disabled={!isSuperAdmin || saving} />
          </label>
          <label>
            {dict.complianceDocuments.details}
            <textarea value={createDetails} onChange={(event) => setCreateDetails(event.target.value)} rows={4} disabled={!isSuperAdmin || saving} />
          </label>
          <label>
            {dict.complianceDocuments.active}
            <select value={createIsActive ? "true" : "false"} onChange={(event) => setCreateIsActive(event.target.value === "true")} disabled={!isSuperAdmin || saving}>
              <option value="true">{dict.common.active}</option>
              <option value="false">{dict.common.disabled}</option>
            </select>
          </label>
          <label>
            {dict.complianceDocuments.requiredDefault}
            <select
              value={createIsRequiredDefault ? "true" : "false"}
              onChange={(event) => setCreateIsRequiredDefault(event.target.value === "true")}
              disabled={!isSuperAdmin || saving}
            >
              <option value="true">{dict.common.yes}</option>
              <option value="false">{dict.common.no}</option>
            </select>
          </label>
          <div className="topbar-actions">
            <button className="primary" type="submit" disabled={!isSuperAdmin || saving}>{dict.actions.create}</button>
            <button className="ghost" type="button" disabled={saving} onClick={() => resetCreateForm()}>
              {dict.common.cancel}
            </button>
          </div>
        </form>
        {!isSuperAdmin ? <p className="panel-meta">{dict.users.onlySuperAdmin}</p> : null}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>{dict.complianceDocuments.tableTitle}</h2>
          <div className="topbar-actions">
            <button className="ghost" type="button" onClick={() => loadRows().catch(() => setMessage(dict.complianceDocuments.requestFailed))}>
              {dict.actions.refresh}
            </button>
          </div>
        </div>
        {message ? <div className="alert">{message}</div> : null}
        <div className="buyer-ops-table-wrap">
          <table>
            <thead>
              <tr>
                <th>{dict.complianceDocuments.code}</th>
                <th>{dict.complianceDocuments.name}</th>
                <th>{dict.complianceDocuments.description}</th>
                <th>{dict.complianceDocuments.sourceInfo}</th>
                <th>{dict.complianceDocuments.details}</th>
                <th>{dict.complianceDocuments.active}</th>
                <th>{dict.complianceDocuments.requiredDefault}</th>
                <th>{dict.complianceDocuments.assignedCount}</th>
                <th>{dict.complianceDocuments.updatedAt}</th>
                <th>{dict.users.actions}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10}>{dict.common.loading}</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={10}>{dict.common.noRecords}</td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td><code>{row.code}</code></td>
                    <td>{row.name}</td>
                    <td>{row.description ?? "-"}</td>
                    <td>{row.source_info ?? "-"}</td>
                    <td>{row.details ?? "-"}</td>
                    <td>{row.is_active ? dict.common.active : dict.common.disabled}</td>
                    <td>
                      <button className="ghost compliance-edit-btn" type="button" disabled={!isSuperAdmin || saving} onClick={() => void toggleRequiredDefault(row)}>
                        {row.is_required_default ? dict.complianceDocuments.requiredYes : dict.complianceDocuments.requiredNo}
                      </button>
                    </td>
                    <td>{row.seller_assignment_count}</td>
                    <td>{formatUiDate(row.updated_at, language)}</td>
                    <td>
                      <div className="legal-doc-actions">
                        <button className="ghost compliance-edit-btn" type="button" onClick={() => startEdit(row)}>
                          {dict.complianceDocuments.editAction}
                        </button>
                        <button className="ghost compliance-edit-btn" type="button" disabled={!isSuperAdmin || saving} onClick={() => void removeRow(row)}>
                          {dict.complianceDocuments.deleteAction}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {editingRow ? (
        <div className="buyer-ops-modal-backdrop">
          <div className="buyer-ops-modal">
            <h3>{dict.complianceDocuments.editDocument}</h3>
            <form className="form-grid" onSubmit={submitEditForm}>
              <label>
                {dict.complianceDocuments.code}
                <input value={editingRow.code} disabled readOnly />
              </label>
              <label>
                {dict.complianceDocuments.name}
                <input value={editingRow.name} disabled readOnly />
              </label>
              <label>
                {dict.complianceDocuments.description}
                <textarea value={editDescription} onChange={(event) => setEditDescription(event.target.value)} rows={3} disabled={!isSuperAdmin || saving} />
              </label>
              <label>
                {dict.complianceDocuments.sourceInfo}
                <textarea value={editSourceInfo} onChange={(event) => setEditSourceInfo(event.target.value)} rows={3} disabled={!isSuperAdmin || saving} />
              </label>
              <label>
                {dict.complianceDocuments.details}
                <textarea value={editDetails} onChange={(event) => setEditDetails(event.target.value)} rows={4} disabled={!isSuperAdmin || saving} />
              </label>
              <label>
                {dict.complianceDocuments.active}
                <select value={editIsActive ? "true" : "false"} onChange={(event) => setEditIsActive(event.target.value === "true")} disabled={!isSuperAdmin || saving}>
                  <option value="true">{dict.common.active}</option>
                  <option value="false">{dict.common.disabled}</option>
                </select>
              </label>
              <label>
                {dict.complianceDocuments.requiredDefault}
                <select value={editIsRequiredDefault ? "true" : "false"} onChange={(event) => setEditIsRequiredDefault(event.target.value === "true")} disabled={!isSuperAdmin || saving}>
                  <option value="true">{dict.common.yes}</option>
                  <option value="false">{dict.common.no}</option>
                </select>
              </label>
              <div className="buyer-ops-modal-actions">
                <button className="ghost" type="button" onClick={closeEditModal} disabled={saving}>
                  {dict.common.cancel}
                </button>
                <button className="primary" type="submit" disabled={!isSuperAdmin || saving}>
                  {dict.actions.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

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

function openQuickEmail(email: string | null | undefined, dict: Dictionary, setMessage?: (message: string | null) => void) {
  const normalizedEmail = String(email ?? "").trim();
  if (!normalizedEmail || !normalizedEmail.includes("@")) return;

  try {
    window.location.href = `mailto:${encodeURIComponent(normalizedEmail)}`;
  } catch {
    navigator.clipboard
      .writeText(normalizedEmail)
      .then(() => setMessage?.(`${dict.detail.emailOpenFailed} ${dict.detail.emailCopied}`))
      .catch(() => setMessage?.(dict.detail.emailOpenFailed));
    return;
  }

  window.setTimeout(() => {
    if (document.visibilityState !== "visible") return;
    navigator.clipboard
      .writeText(normalizedEmail)
      .then(() => setMessage?.(`${dict.detail.emailOpenFailed} ${dict.detail.emailCopied}`))
      .catch(() => setMessage?.(dict.detail.emailOpenFailed));
  }, 700);
}

function BuyerDetailScreen({ id, dict }: { id: string; dict: Dictionary }) {
  const navigate = useNavigate();
  const location = useLocation();
  const endpoint = `/v1/admin/users/${id}`;
  const [activeTab, setActiveTab] = useState<BuyerDetailTab>(() => resolveBuyerDetailTab(new URLSearchParams(location.search).get("tab")));
  const [row, setRow] = useState<BuyerDetail | null>(null);
  const [contactInfo, setContactInfo] = useState<BuyerContactInfo | null>(null);
  const [orders, setOrders] = useState<BuyerOrderRow[]>([]);
  const [summary, setSummary] = useState<BuyerSummaryMetrics | null>(null);
  const [ordersPagination, setOrdersPagination] = useState<BuyerPagination | null>(null);
  const [reviews, setReviews] = useState<BuyerReviewRow[]>([]);
  const [cancellations, setCancellations] = useState<BuyerCancellationRow[]>([]);
  const [locations, setLocations] = useState<BuyerLoginLocation[]>([]);
  const [ordersPage, setOrdersPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [smsOpen, setSmsOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [quickContactMenuOpen, setQuickContactMenuOpen] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [smsMessage, setSmsMessage] = useState("");
  const [emailSubject, setEmailSubject] = useState("Coziyoo Destek");
  const [emailBody, setEmailBody] = useState("Merhaba,");
  const [noteInput, setNoteInput] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [orderSearch, setOrderSearch] = useState("");
  const quickContactWrapRef = useRef<HTMLDivElement | null>(null);
  const actionMenuWrapRef = useRef<HTMLDivElement | null>(null);
  const [noteItems, setNoteItems] = useState<string[]>([
    "Alıcıyla son ödeme konusunda iletişime geçildi.",
    "Siparişlerde teslimat notu: kapı zili bozuk.",
  ]);
  const [tagItems, setTagItems] = useState<string[]>(["VIP", "Takip"]);

  function paymentBadge(status: string) {
    const normalized = status.toLowerCase();
    if (normalized.includes("fail") || normalized.includes("cancel") || normalized.includes("declin")) {
      return { text: "Basarisiz", cls: "is-failed" };
    }
    if (normalized.includes("pending") || normalized.includes("wait")) {
      return { text: "Bekliyor", cls: "is-pending" };
    }
    return { text: "Basarili", cls: "is-success" };
  }

  function orderStatusLabel(status: string) {
    const normalized = status.toLowerCase();
    if (normalized.includes("cancel")) return "Iptal";
    if (normalized.includes("deliver")) return "Teslim Edildi";
    if (normalized.includes("done")) return "Tamamlandi";
    if (normalized.includes("approve")) return "Onaylandi";
    if (normalized.includes("pending")) return "Bekliyor";
    return status;
  }

  function formatCurrency(value: number) {
    return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(value);
  }

  function formatDate(value: string) {
    return new Date(value).toLocaleString("tr-TR");
  }

  function trend(current: number, previous: number) {
    if (current > previous) return { arrow: "up", cls: "is-up" };
    if (current < previous) return { arrow: "down", cls: "is-down" };
    return { arrow: "flat", cls: "is-flat" };
  }

  function toRelative(value: string) {
    const diff = Date.now() - new Date(value).getTime();
    const hours = Math.max(0, Math.floor(diff / (1000 * 60 * 60)));
    if (hours < 1) return "Simdi";
    if (hours < 24) return `${hours} saat once`;
    const days = Math.floor(hours / 24);
    return `${days} gun once`;
  }

  async function loadBuyerDetail() {
    setLoading(true);
    setMessage(null);
    try {
      const [
        detailResponse,
        contactResponse,
        summaryResponse,
        ordersResponse,
        reviewsResponse,
        cancellationsResponse,
        locationsResponse,
        notesResponse,
        tagsResponse,
      ] = await Promise.all([
        request(endpoint),
        request(`/v1/admin/users/${id}/buyer-contact`),
        request(`/v1/admin/users/${id}/buyer-summary`),
        request(`/v1/admin/users/${id}/buyer-orders?page=${ordersPage}&pageSize=5&sortDir=desc`),
        request(`/v1/admin/users/${id}/buyer-reviews?page=1&pageSize=5&sortDir=desc`),
        request(`/v1/admin/users/${id}/buyer-cancellations?page=1&pageSize=5&sortDir=desc`),
        request(`/v1/admin/users/${id}/login-locations?page=1&pageSize=5&sortDir=desc`),
        request(`/v1/admin/buyers/${id}/notes?limit=50`),
        request(`/v1/admin/buyers/${id}/tags`),
      ]);

      if (detailResponse.status !== 200) {
        const body = await parseJson<ApiError>(detailResponse);
        setMessage(body.error?.message ?? "Alıcı detayı yüklenemedi");
        return;
      }

      const detailBody = await parseJson<{ data: BuyerDetail }>(detailResponse);
      setRow(detailBody.data);

      if (contactResponse.status === 200) {
        const body = await parseJson<{ data: BuyerContactInfo }>(contactResponse);
        setContactInfo(body.data);
      }

      if (summaryResponse.status === 200) {
        const body = await parseJson<{ data: BuyerSummaryMetrics }>(summaryResponse);
        setSummary(body.data);
      } else {
        setSummary(null);
      }

      if (ordersResponse.status === 200) {
        const body = await parseJson<{ data: BuyerOrderRow[]; pagination: BuyerPagination }>(ordersResponse);
        setOrders(body.data);
        setOrdersPagination(body.pagination);
      } else {
        setOrders([]);
      }

      if (reviewsResponse.status === 200) {
        const body = await parseJson<{ data: BuyerReviewRow[] }>(reviewsResponse);
        setReviews(body.data);
      } else {
        setReviews([]);
      }

      if (cancellationsResponse.status === 200) {
        const body = await parseJson<{ data: BuyerCancellationRow[] }>(cancellationsResponse);
        setCancellations(body.data);
      } else {
        setCancellations([]);
      }

      if (locationsResponse.status === 200) {
        const body = await parseJson<{ data: BuyerLoginLocation[] }>(locationsResponse);
        setLocations(body.data);
      } else {
        setLocations([]);
      }

      if (notesResponse.status === 200) {
        const body = await parseJson<{ data: Array<{ id: string; note: string; createdAt: string }> }>(notesResponse);
        setNoteItems(body.data.map((item) => item.note));
      } else {
        setNoteItems([]);
      }

      if (tagsResponse.status === 200) {
        const body = await parseJson<{ data: Array<{ id: string; tag: string }> }>(tagsResponse);
        setTagItems(body.data.map((item) => item.tag));
      } else {
        setTagItems([]);
      }
    } catch {
      setMessage("Alıcı detay isteği başarısız");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBuyerDetail().catch(() => setMessage("Alıcı detay isteği başarısız"));
  }, [id, ordersPage]);

  useEffect(() => {
    setActiveTab(resolveBuyerDetailTab(new URLSearchParams(location.search).get("tab")));
  }, [location.search]);

  useEffect(() => {
    const onDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (quickContactMenuOpen && quickContactWrapRef.current && !quickContactWrapRef.current.contains(target)) {
        setQuickContactMenuOpen(false);
      }
      if (actionMenuOpen && actionMenuWrapRef.current && !actionMenuWrapRef.current.contains(target)) {
        setActionMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => document.removeEventListener("mousedown", onDocumentMouseDown);
  }, [quickContactMenuOpen, actionMenuOpen]);

  const fullName = row?.fullName ?? row?.displayName ?? "-";
  const email = contactInfo?.identity.email ?? row?.email ?? "-";
  const phone = contactInfo?.contact.phone ?? "Bilinmiyor";
  const compactUserId = row?.id ? `${row.id.slice(0, 10)}...` : "-";
  const latestLoginLocation = locations[0] ?? null;
  const detailLastLoginAtRaw = latestLoginLocation?.createdAt ?? contactInfo?.identity.lastLoginAt ?? null;
  const detailLastLoginAt = detailLastLoginAtRaw ? formatDate(detailLastLoginAtRaw) : "-";

  const failedPayments = useMemo(
    () => orders.filter((order) => paymentBadge(order.paymentStatus).cls === "is-failed").length,
    [orders],
  );
  const openComplaints = summary?.complaintUnresolved ?? 0;
  const cancellations30d = cancellations.length;
  const risk = useMemo(() => {
    const reasons: string[] = [];
    let level: "low" | "medium" | "high" = "low";
    if (openComplaints >= 2) {
      level = "high";
      reasons.push("2+ acik sikayet");
    } else if (openComplaints === 1) {
      level = "medium";
      reasons.push("1 acik sikayet");
    }
    if (cancellations30d >= 3) {
      level = level === "high" ? "high" : "medium";
      reasons.push("30 gunde 3+ iptal");
    }
    if (failedPayments >= 2) {
      level = level === "high" ? "high" : "medium";
      reasons.push("2+ basarisiz odeme");
    }
    return { level, reasons };
  }, [openComplaints, cancellations30d, failedPayments]);

  const orderTrend = trend(summary?.monthlyOrderCountCurrent ?? 0, summary?.monthlyOrderCountPrevious ?? 0);
  const spendTrend = trend(summary?.monthlySpentCurrent ?? 0, summary?.monthlySpentPrevious ?? 0);

  const activityRows = useMemo(() => {
    const orderEvents = orders.slice(0, 5).map((order) => ({
      id: order.orderId,
      at: order.updatedAt || order.createdAt,
      action: `Siparis ${orderStatusLabel(order.status)}`,
      actor: "Sistem",
      detail: `No: ${order.orderNo}`,
    }));
    const locationEvents = locations.slice(0, 5).map((location) => ({
      id: location.id,
      at: location.createdAt,
      action: "Giris Konumu",
      actor: location.source || "Mobil",
      detail: `${location.latitude}, ${location.longitude}`,
    }));
    return [...orderEvents, ...locationEvents].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [orders, locations]);

  const filteredOrders = useMemo(() => {
    const now = Date.now();
    const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);

    let next = [...orders];

    if (statusFilter === "all_delivered") {
      next = next.filter((order) => orderStatusLabel(order.status).toLowerCase().includes("teslim"));
    } else if (statusFilter === "all_pending") {
      next = next.filter((order) => paymentBadge(order.paymentStatus).cls === "is-pending");
    } else if (statusFilter === "all_cancelled") {
      next = next.filter((order) => orderStatusLabel(order.status).toLowerCase().includes("iptal"));
    }

    if (dateFilter === "last7") {
      next = next.filter((order) => new Date(order.createdAt).getTime() >= sevenDaysAgo);
    } else if (dateFilter === "last30") {
      next = next.filter((order) => new Date(order.createdAt).getTime() >= thirtyDaysAgo);
    }

    const search = orderSearch.trim().toLowerCase();
    if (search) {
      next = next.filter((order) => {
        const no = String(order.orderNo ?? "").toLowerCase();
        const foods = order.items.map((item) => String(item.name ?? "").toLowerCase()).join(" ");
        return no.includes(search) || foods.includes(search);
      });
    }

    next.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return next;
  }, [orders, statusFilter, dateFilter, orderSearch]);

  const visibleOrders = useMemo(() => {
    if (filteredOrders.length === 0 && orders.length > 0) return orders;
    return filteredOrders;
  }, [filteredOrders, orders]);
  const buyerRawPayload = {
    user: row,
    contact: contactInfo,
    summary,
    orders: {
      rows: orders,
      pagination: ordersPagination,
      filteredRows: visibleOrders,
    },
    reviews,
    cancellations,
    loginLocations: locations,
    notes: noteItems,
    tags: tagItems,
  };

  function switchBuyerTab(tab: BuyerDetailTab) {
    setActiveTab(tab);
    const params = new URLSearchParams(location.search);
    params.set("tab", tab);
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
  }

  async function sendSms() {
    if (!smsMessage.trim()) {
      setMessage("SMS icerigi bos olamaz.");
      return;
    }
    try {
      const response = await request(`/v1/admin/buyers/${id}/send-sms`, {
        method: "POST",
        body: JSON.stringify({ message: smsMessage.trim() }),
      });
      if (response.status >= 200 && response.status < 300) {
        setMessage("SMS gonderildi.");
        setSmsOpen(false);
        setSmsMessage("");
      } else {
        setMessage("SMS gonderilemedi.");
      }
    } catch {
      setMessage("SMS gonderilemedi.");
    }
  }

  function openEmail() {
    const target = String(email).trim();
    if (!target || !target.includes("@")) {
      setMessage("Gecerli e-posta bulunamadi.");
      return;
    }
    const href = `mailto:${encodeURIComponent(target)}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;
    window.location.href = href;
    setEmailOpen(false);
  }

  function copyBuyerId() {
    if (!row?.id) return;
    navigator.clipboard
      .writeText(row.id)
      .then(() => setMessage("Alici ID kopyalandi."))
      .catch(() => setMessage("Kopyalama basarisiz."));
  }

  function openAddressInMaps(address: string | null | undefined) {
    const value = String(address ?? "").trim();
    if (!value || value.toLowerCase() === "adres yok") {
      setMessage("Acilabilir adres bulunamadi.");
      return;
    }
    const target = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}`;
    window.open(target, "_blank", "noopener,noreferrer");
  }

  function openDialer(phoneValue: string | null | undefined) {
    const normalized = String(phoneValue ?? "").trim();
    if (!normalized || normalized.toLowerCase() === "bilinmiyor") {
      setMessage("Aranabilir telefon bulunamadi.");
      return;
    }
    window.location.href = `tel:${normalized.replace(/\s+/g, "")}`;
  }

  function downloadBuyerOrdersAsExcel() {
    if (orders.length === 0) {
      setMessage("Disa aktarilacak siparis bulunamadi.");
      return;
    }

    const headers = ["Tarih / Saat", "Siparis No", "Satici", "Yemekler", "Tutar", "Durum", "Odeme Durumu"];
    const rowsForExport = orders.map((order) => [
      formatDate(order.createdAt),
      order.orderNo,
      order.sellerName ?? order.sellerEmail ?? order.sellerId,
      order.items.map((item) => `${item.name} x${item.quantity}`).join(", ") || "-",
      formatCurrency(order.totalAmount),
      orderStatusLabel(order.status),
      paymentBadge(order.paymentStatus).text,
    ]);

    const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const csv = [headers, ...rowsForExport].map((line) => line.map((cell) => escapeCsv(String(cell))).join(",")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `buyer-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function addNote() {
    const trimmed = noteInput.trim();
    if (!trimmed) return;
    try {
      const response = await request(`/v1/admin/buyers/${id}/notes`, {
        method: "POST",
        body: JSON.stringify({ note: trimmed }),
      });
      if (response.status >= 200 && response.status < 300) {
        setNoteItems((prev) => [trimmed, ...prev]);
        setNoteInput("");
      } else {
        setMessage("Not kaydedilemedi.");
      }
    } catch {
      setMessage("Not kaydedilemedi.");
    }
  }

  async function addTag() {
    const trimmed = noteInput.trim();
    if (!trimmed) return;
    try {
      const response = await request(`/v1/admin/buyers/${id}/tags`, {
        method: "POST",
        body: JSON.stringify({ tag: trimmed }),
      });
      if (response.status >= 200 && response.status < 300) {
        if (!tagItems.includes(trimmed)) {
          setTagItems((prev) => [trimmed, ...prev].slice(0, 8));
        }
        setNoteInput("");
      } else {
        setMessage("Etiket kaydedilemedi.");
      }
    } catch {
      setMessage("Etiket kaydedilemedi.");
    }
  }

  if (loading && !row) return <div className="panel">Yükleniyor...</div>;
  if (!row) return <div className="panel">{message ?? "Kayıt bulunamadı"}</div>;

  return (
    <div className="app buyer-ops-page">
      <section className="buyer-ref-head">
        <div>
          <h1>Alici Detayi</h1>
        </div>
        <div className="buyer-ref-actions">
          <button className="ghost" type="button" onClick={downloadBuyerOrdersAsExcel}>
            <span className="buyer-ref-action-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M12 3.5v11.8" />
                <path d="m7.9 11.8 4.1 4.1 4.1-4.1" />
                <path d="M4.5 18.5h15" />
              </svg>
            </span>
            Excel'e Dok
          </button>
          <div className="buyer-ops-menu-wrap" ref={quickContactWrapRef}>
            <button className="ghost" type="button" onClick={() => setQuickContactMenuOpen((prev) => !prev)}>
              <span className="buyer-ref-action-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M5 7.2h14v9.4H9l-4 3v-3z" />
                  <path d="M9 10.8h6M9 13.5h4.2" />
                </svg>
              </span>
              Hizli Iletisim
            </button>
            {quickContactMenuOpen ? (
              <div className="buyer-ops-menu">
                <button type="button" onClick={() => { setEmailOpen(true); setQuickContactMenuOpen(false); }}>Hizli E-posta</button>
                <button type="button" onClick={() => { setSmsOpen(true); setQuickContactMenuOpen(false); }}>Hizli SMS</button>
              </div>
            ) : null}
          </div>
          <button className="ghost" type="button">
            <span className="buyer-ref-action-icon is-warn" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M18.5 8.2A7 7 0 1 0 19 13" />
                <path d="M19 5.8v4h-4" />
              </svg>
            </span>
            {row.status === "active" ? "Pasif Yap" : "Aktif Yap"}
          </button>
          <div className="buyer-ops-menu-wrap" ref={actionMenuWrapRef}>
            <button className="ghost" type="button" onClick={() => setActionMenuOpen((prev) => !prev)}>
              <span className="buyer-ref-action-icon" aria-hidden="true">•••</span>
              Diger
            </button>
            {actionMenuOpen ? (
              <div className="buyer-ops-menu">
                <button type="button" onClick={() => { loadBuyerDetail(); setActionMenuOpen(false); }}>Yenile</button>
                <button type="button" onClick={() => { navigate("/app/dashboard"); setActionMenuOpen(false); }}>Bekleyen Isler</button>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="buyer-ref-top buyer-ref-hero-strip">
        <article className="buyer-ref-profile-card">
          <div className="buyer-ref-avatar">{(fullName || "?").slice(0, 2).toUpperCase()}</div>
          <div className="buyer-ref-profile-body">
            <h2 title={fullName}>{fullName}</h2>
            <p title={email}>{email}</p>
            <div className="buyer-ops-id-row">
              <span>ID {compactUserId}</span>
              <button type="button" className="ghost buyer-ops-mini-btn" onClick={copyBuyerId}>
                <span aria-hidden="true">◌</span>
              </button>
            </div>
          </div>
        </article>
        <article className="buyer-ops-kpi-card buyer-ref-metric">
          <div className="buyer-ref-metric-head">
            <span className="buyer-ref-metric-icon is-alert" aria-hidden="true">♡</span>
            <p>Acik Sikayet</p>
          </div>
          <strong>{openComplaints} <span>Aktif sikayet</span></strong>
          <small>Son sikayet: {cancellations[0] ? toRelative(cancellations[0].cancelledAt) : "4 ay once"}</small>
        </article>
        <article className="buyer-ops-kpi-card buyer-ref-metric">
          <div className="buyer-ref-metric-head">
            <span className="buyer-ref-metric-icon is-trend" aria-hidden="true">⌁</span>
            <p>Son 30 Gun</p>
          </div>
          <strong>{summary?.monthlyOrderCountCurrent ?? 0} <span className="is-accent">{formatCurrency(summary?.monthlySpentCurrent ?? 0)}</span></strong>
          <small className={`buyer-trend ${orderTrend.cls}`}>Son siparis: {orders[0] ? toRelative(orders[0].createdAt) : "2 gun once"}</small>
        </article>
        <article className="buyer-ops-kpi-card buyer-ref-metric">
          <div className="buyer-ref-metric-head">
            <span className="buyer-ref-metric-icon is-payment" aria-hidden="true">◔</span>
            <p>Odeme Durumu</p>
          </div>
          <strong>{orders.length - failedPayments} <span className="is-accent">{failedPayments} beklemede</span></strong>
          <small>Son islem: {orders[0] ? toRelative(orders[0].updatedAt || orders[0].createdAt) : "2 hafta once"}</small>
        </article>
      </section>

      <section className="buyer-ref-content">
        <div className="buyer-ref-left">
          <section className="panel buyer-ref-main-panel">
            <div className="buyer-ops-tabs" role="tablist" aria-label="Alici detay sekmeleri">
              <button className={activeTab === "orders" ? "is-active" : ""} onClick={() => switchBuyerTab("orders")} type="button">Siparisler</button>
              <button className={activeTab === "payments" ? "is-active" : ""} onClick={() => switchBuyerTab("payments")} type="button">Odemeler</button>
              <button className={activeTab === "complaints" ? "is-active" : ""} onClick={() => switchBuyerTab("complaints")} type="button">Sikayetler</button>
              <button className={activeTab === "reviews" ? "is-active" : ""} onClick={() => switchBuyerTab("reviews")} type="button">Yorumlar & Puanlar</button>
              <button className={activeTab === "activity" ? "is-active" : ""} onClick={() => switchBuyerTab("activity")} type="button">Aktivite Logu</button>
              <button className={activeTab === "notes" ? "is-active" : ""} onClick={() => switchBuyerTab("notes")} type="button">Notlar & Etiketler</button>
              <button className={activeTab === "raw" ? "is-active" : ""} onClick={() => switchBuyerTab("raw")} type="button">Ham Veri</button>
            </div>
            {activeTab === "orders" || activeTab === "payments" ? (
              <>
                <div className="buyer-ref-filter-row">
                  <label className="ghost buyer-ref-filter-btn buyer-ref-select-wrap">
                    <span className="buyer-ref-filter-leading" aria-hidden="true">
                      <svg viewBox="0 0 24 24" focusable="false">
                        <path d="M3 7h13" />
                        <path d="M6 12h15" />
                        <path d="M3 17h13" />
                        <circle cx="19" cy="7" r="2" />
                        <circle cx="4" cy="12" r="2" />
                        <circle cx="19" cy="17" r="2" />
                      </svg>
                    </span>
                    <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Durum filtresi">
                      <option value="all">Hepsi | Tumu</option>
                      <option value="all_delivered">Hepsi | Teslim Edildi</option>
                      <option value="all_pending">Hepsi | Bekliyor</option>
                      <option value="all_cancelled">Hepsi | Iptal</option>
                    </select>
                    <span className="buyer-ref-filter-trailing" aria-hidden="true">
                      <svg viewBox="0 0 24 24" focusable="false">
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </span>
                  </label>
                  <label className="ghost buyer-ref-filter-btn buyer-ref-select-wrap">
                    <span className="buyer-ref-filter-leading" aria-hidden="true">
                      <svg viewBox="0 0 24 24" focusable="false">
                        <rect x="3.5" y="4.5" width="17" height="16" rx="2.5" />
                        <path d="M8 2.8v3.4M16 2.8v3.4M3.5 9.5h17" />
                        <path d="M8.2 13h3.4M8.2 16h6.6" />
                      </svg>
                    </span>
                    <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} aria-label="Tarih filtresi">
                      <option value="all">27.01.2028 - 27.02.2028</option>
                      <option value="last7">Son 7 gun</option>
                      <option value="last30">Son 30 gun</option>
                    </select>
                    <span className="buyer-ref-filter-trailing" aria-hidden="true">
                      <svg viewBox="0 0 24 24" focusable="false">
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </span>
                  </label>
                  <label className="ghost buyer-ref-search-btn">
                    <span className="buyer-ref-filter-leading" aria-hidden="true">
                      <svg viewBox="0 0 24 24" focusable="false">
                        <circle cx="11" cy="11" r="5.5" />
                        <path d="m15.2 15.2 4.3 4.3" />
                      </svg>
                    </span>
                    <input
                      className="buyer-ref-search-input"
                      value={orderSearch}
                      onChange={(event) => setOrderSearch(event.target.value)}
                      placeholder="Siparis No veya isim ile ara..."
                      aria-label="Siparis veya isim ara"
                    />
                  </label>
                </div>

                <div className="buyer-ops-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th><span className="buyer-ref-head-checkbox" aria-hidden="true" /></th>
                        <th>Tarih / Saat</th>
                        <th>Siparis No</th>
                        <th>Satici</th>
                        <th>{activeTab === "orders" ? "Yemekler" : "Odeme / Yemek"}</th>
                        <th>Tutar</th>
                        <th>Durum</th>
                        <th>Star</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleOrders.length === 0 ? (
                        <tr><td colSpan={8}>Siparis kaydi bulunamadi.</td></tr>
                      ) : visibleOrders.map((order) => {
                        const foods = order.items.map((item) => `${item.name} x${item.quantity}`).join(", ");
                        const paymentState = paymentBadge(order.paymentStatus);
                        const statusText = paymentState.cls === "is-pending"
                          ? "Bekleyen"
                          : paymentState.cls === "is-failed"
                            ? "Basarisiz"
                            : "Tamamlanmis";
                        return (
                          <tr key={order.orderId}>
                            <td><input type="checkbox" aria-label="Satir sec" /></td>
                            <td>{formatDate(order.createdAt)}</td>
                            <td className="buyer-order-no">{order.orderNo}</td>
                            <td>{order.sellerName ?? order.sellerEmail ?? order.sellerId.slice(0, 10)}</td>
                            <td>{activeTab === "orders" ? (foods || "-") : `${paymentState.text} • ${foods || "-"}`}</td>
                            <td>{formatCurrency(order.totalAmount)}</td>
                            <td><span className={`buyer-payment-badge ${paymentState.cls}`}>{statusText}</span></td>
                            <td><span className="status-pill is-success">Aktif</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="buyer-ref-pager">
                  <div>
                    <button className="ghost" type="button" onClick={() => setOrdersPage(Math.max(1, (ordersPagination?.page ?? 1) - 1))}>Onceki</button>
                    <button className="ghost" type="button" onClick={() => setOrdersPage(Math.min((ordersPagination?.totalPages ?? 1), (ordersPagination?.page ?? 1) + 1))}>Sonraki</button>
                    <span>Toplam {visibleOrders.length} Siparis</span>
                  </div>
                  <div>
                    <button className="ghost" type="button">1</button>
                    <button className="ghost is-active" type="button">2</button>
                    <button className="ghost" type="button">3</button>
                  </div>
                </div>
              </>
            ) : null}

            {activeTab === "complaints" ? (
              <div className="buyer-ops-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Tarih / Saat</th>
                      <th>Siparis No</th>
                      <th>Tutar</th>
                      <th>Sebep</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cancellations.length === 0 ? (
                      <tr><td colSpan={4}>Sikayet kaydi bulunamadi.</td></tr>
                    ) : cancellations.map((item) => (
                      <tr key={`${item.orderId}-${item.cancelledAt}`}>
                        <td>{formatDate(item.cancelledAt)}</td>
                        <td className="buyer-order-no">{item.orderNo}</td>
                        <td>{formatCurrency(item.totalAmount)}</td>
                        <td>{item.reason ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {activeTab === "reviews" ? (
              <div className="buyer-ops-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Tarih / Saat</th>
                      <th>Yemek</th>
                      <th>Puan</th>
                      <th>Yorum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviews.length === 0 ? (
                      <tr><td colSpan={4}>Yorum kaydi bulunamadi.</td></tr>
                    ) : reviews.map((item) => (
                      <tr key={item.id}>
                        <td>{formatDate(item.createdAt)}</td>
                        <td>{item.foodName}</td>
                        <td>{item.rating}/5</td>
                        <td>{item.comment ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {activeTab === "activity" ? (
              <div className="buyer-ops-activity-mini buyer-ref-main-activity">
                {activityRows.map((item) => (
                  <article key={`main-${item.id}-${item.at}`}>
                    <p className="buyer-ref-activity-top"><span aria-hidden="true">•</span> {toRelative(item.at)}</p>
                    <p className="buyer-ref-activity-action">{item.action}</p>
                    <p className="panel-meta">{item.detail}</p>
                  </article>
                ))}
              </div>
            ) : null}

            {activeTab === "notes" ? (
              <div className="buyer-ref-main-notes">
                <div className="buyer-ops-tag-list">{tagItems.map((tag) => <span key={`main-${tag}`} className="buyer-ops-tag">{tag}</span>)}</div>
                <div className="buyer-ops-note-form">
                  <input
                    value={noteInput}
                    onChange={(event) => setNoteInput(event.target.value)}
                    placeholder="Not Ekle veya Etiketle"
                  />
                  <button className="ghost" type="button" onClick={addNote}>Not</button>
                  <button className="ghost" type="button" onClick={addTag}>Etiket</button>
                  <button className="ghost" type="button" onClick={() => switchBuyerTab("activity")}>Kayit</button>
                </div>
                <p className="panel-meta">{noteItems.length} Not, {tagItems.length} Etiket</p>
              </div>
            ) : null}

            {activeTab === "raw" ? (
              <section className="seller-json-card">
                <div className="seller-json-header">
                  <h2>Ham Veri (JSON)</h2>
                  <button
                    className="ghost seller-json-copy"
                    type="button"
                    onClick={() => navigator.clipboard.writeText(JSON.stringify(buyerRawPayload, null, 2)).catch(() => undefined)}
                  >
                    {dict.detail.copyJson}
                  </button>
                </div>
                <pre className="json-box">{JSON.stringify(buyerRawPayload, null, 2)}</pre>
              </section>
            ) : null}
          </section>

        </div>

        <aside className="buyer-ref-right">
          <section className="panel buyer-ops-side-card buyer-ref-contact-side">
            <h2>Iletisim & Adres</h2>
            <button type="button" className="buyer-ref-link-block" onClick={() => openAddressInMaps(contactInfo?.addresses.home?.addressLine ?? null)}>
              <p className="buyer-ref-contact-label"><span className="buyer-ref-side-icon" aria-hidden="true">⌂</span> Ev Adresi</p>
              <p className="buyer-ref-contact-value">{contactInfo?.addresses.home?.addressLine ?? "Adres yok"}</p>
            </button>
            <button type="button" className="buyer-ref-link-block" onClick={() => openDialer(phone)}>
              <p className="buyer-ref-contact-label"><span className="buyer-ref-side-icon" aria-hidden="true">✆</span> Cep</p>
              <p className="buyer-ref-contact-value buyer-ref-phone-row">
                <strong>{phone}</strong>
                <span className="buyer-ref-online-dot" aria-hidden="true" />
              </p>
              <p className="panel-meta">{locations.length} segilones</p>
            </button>
            <button type="button" className="buyer-ref-link-block" onClick={() => switchBuyerTab("activity")}>
              <p className="buyer-ref-contact-label"><span className="buyer-ref-side-icon" aria-hidden="true">◷</span> Son Giris</p>
              <p className="buyer-ref-contact-value">{detailLastLoginAt}</p>
              {risk.level === "high" ? <p><span className="status-pill is-warning">⚠ Yuksek</span></p> : null}
            </button>
            <div className="buyer-ref-contact-block">
              <p className="buyer-ref-contact-label"><span className="buyer-ref-side-icon" aria-hidden="true">○</span> Kimlik</p>
              <div className="buyer-ref-contact-id-row">
                <p className="buyer-ref-contact-value">{contactInfo?.identity.id ?? "-"}</p>
                <button type="button" className="ghost buyer-ops-mini-btn" onClick={copyBuyerId}>
                  <span aria-hidden="true">□</span> <span aria-hidden="true">⌄</span>
                </button>
              </div>
            </div>
          </section>

          <section className="panel buyer-ops-side-card buyer-ref-activity-card">
            <div className="panel-header">
              <h2>Aktivite Logu</h2>
              <button className="ghost buyer-ops-mini-btn" type="button" onClick={() => switchBuyerTab("activity")}>Ac</button>
            </div>
            <div className="buyer-ops-activity-mini">
              {activityRows.slice(0, 2).map((item) => (
                <article key={item.id} className="buyer-ref-click-item" onClick={() => switchBuyerTab("activity")} role="button" tabIndex={0} onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    switchBuyerTab("activity");
                  }
                }}>
                  <p className="buyer-ref-activity-top"><span aria-hidden="true">•</span> {toRelative(item.at)}</p>
                  <p className="buyer-ref-activity-action">{item.action}</p>
                  <p className="panel-meta">{item.detail}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="panel buyer-ops-side-card buyer-ref-notes-card">
            <div className="panel-header">
              <h2>Notlar & Etiketler</h2>
              <button className="ghost buyer-ops-mini-btn" type="button" onClick={() => switchBuyerTab("notes")}>Ac</button>
            </div>
            <div className="buyer-ops-tag-list">{tagItems.map((tag) => <span key={tag} className="buyer-ops-tag">{tag}</span>)}</div>
            <div className="buyer-ops-note-form">
              <input
                value={noteInput}
                onChange={(event) => setNoteInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") addNote();
                }}
                placeholder="Not Ekle veya Etiketle"
              />
            </div>
            <p className="panel-meta">{noteItems.length} Not, {tagItems.length} Etikes</p>
          </section>
        </aside>
      </section>

      {smsOpen ? (
        <div className="buyer-ops-modal-backdrop" role="dialog" aria-modal="true" aria-label="Hizli SMS">
          <div className="buyer-ops-modal">
            <h3>Hizli SMS</h3>
            <label>
              Telefon
              <input value={phone} readOnly />
            </label>
            <label>
              Mesaj
              <textarea value={smsMessage} onChange={(event) => setSmsMessage(event.target.value)} rows={5} placeholder="Mesajinizi yazin" />
            </label>
            <div className="buyer-ops-modal-actions">
              <button className="ghost" type="button" onClick={() => setSmsOpen(false)}>Vazgec</button>
              <button className="primary" type="button" onClick={sendSms}>Gonder</button>
            </div>
          </div>
        </div>
      ) : null}

      {emailOpen ? (
        <div className="buyer-ops-modal-backdrop" role="dialog" aria-modal="true" aria-label="Hizli E-posta">
          <div className="buyer-ops-modal">
            <h3>Hizli E-posta</h3>
            <label>
              E-posta
              <input value={email} readOnly />
            </label>
            <label>
              Konu
              <input value={emailSubject} onChange={(event) => setEmailSubject(event.target.value)} />
            </label>
            <label>
              Mesaj
              <textarea value={emailBody} onChange={(event) => setEmailBody(event.target.value)} rows={5} />
            </label>
            <div className="buyer-ops-modal-actions">
              <button className="ghost" type="button" onClick={() => setEmailOpen(false)}>Vazgec</button>
              <button className="primary" type="button" onClick={openEmail}>E-posta Ac</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type SellerComplianceStatus = "not_started" | "in_progress" | "under_review" | "approved" | "rejected";
type SellerComplianceDocumentStatus = "requested" | "uploaded" | "approved" | "rejected";
type OptionalUploadStatus = "uploaded" | "approved" | "rejected" | "archived";

type SellerCompliancePayload = {
  profile: {
    seller_id: string;
    status: SellerComplianceStatus;
    required_count: number;
    approved_required_count: number;
    uploaded_required_count: number;
    requested_required_count: number;
    rejected_required_count: number;
    review_notes: string | null;
    updated_at: string;
  };
  checks: Array<{
    id: string;
    check_code: string;
    required: boolean;
    status: string;
    value_json: unknown;
    updated_at: string;
  }>;
  documents: Array<{
    id: string;
    seller_id: string;
    document_list_id: string;
    code: string;
    name: string;
    description: string | null;
    source_info: string | null;
    details: string | null;
    is_required: boolean;
    is_active: boolean;
    doc_type: string;
    file_url: string | null;
    status: SellerComplianceDocumentStatus;
    rejection_reason: string | null;
    notes: string | null;
    uploaded_at: string | null;
    reviewed_at: string | null;
    updated_at: string;
  }>;
  profileDocuments: Array<{
    id: string;
    seller_id: string;
    doc_type: string;
    latest_document_id: string | null;
    status: SellerComplianceDocumentStatus;
    required: boolean;
    updated_at: string;
  }>;
  optionalUploads: Array<{
    id: string;
    seller_id: string;
    document_list_id: string | null;
    catalog_doc_code: string | null;
    catalog_doc_name: string | null;
    custom_title: string | null;
    custom_description: string | null;
    file_url: string;
    status: OptionalUploadStatus;
    reviewed_at: string | null;
    rejection_reason: string | null;
    created_at: string;
    updated_at: string;
  }>;
};

type ComplianceRowKey =
  | "foodBusiness"
  | "taxPlate"
  | "kvkk"
  | "foodSafetyTraining"
  | "phoneVerification"
  | "workplaceInsurance";

type ComplianceTone = "success" | "warning" | "danger" | "neutral";

type ComplianceRowViewModel = {
  key: ComplianceRowKey;
  label: string;
  statusLabel: string;
  tone: ComplianceTone;
  detailText: string;
  isOptional?: boolean;
  sourceType: "document" | "check" | "fallback";
};

type ComplianceSource = {
  status: string | null;
  reviewedAt: string | null;
  uploadedAt: string | null;
  updatedAt: string | null;
  phoneValue?: string | null;
};

function maskEmail(value: string | null | undefined): string {
  const email = String(value ?? "").trim();
  const [local, domain] = email.split("@");
  if (!local || !domain) return email || "-";
  const head = local.slice(0, Math.min(3, local.length));
  return `${head}***@${domain}`;
}

function maskPhone(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "-";
  if (digits.length < 10) return "***";
  const base = digits.startsWith("90") ? digits.slice(2) : digits;
  const normalized = base.padEnd(10, "x").slice(0, 10);
  return `+90 ${normalized.slice(0, 3)} ${normalized.slice(3, 6)} ${normalized.slice(6, 8)} ${normalized.slice(8, 10)}`.replace(
    /\d/g,
    (char, index) => {
      if (index < 8) return char;
      return "x";
    }
  );
}

function addTwoYears(value: string | null | undefined): string | null {
  const date = Date.parse(String(value ?? ""));
  if (Number.isNaN(date)) return null;
  const next = new Date(date);
  next.setFullYear(next.getFullYear() + 2);
  return next.toISOString();
}

function extractPhoneFromChecks(payload: SellerCompliancePayload | null): string | null {
  if (!payload) return null;
  for (const check of payload.checks) {
    const code = check.check_code.toLowerCase();
    if (!code.includes("phone") && !code.includes("telefon")) continue;
    const raw = check.value_json;
    if (typeof raw === "string") return raw;
    if (raw && typeof raw === "object") {
      const valueObj = raw as Record<string, unknown>;
      const candidates = [valueObj.phone, valueObj.telephone, valueObj.value, valueObj.number];
      for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) return candidate;
      }
    }
  }
  return null;
}

function formatUiDate(value: string | null | undefined, language: Language): string {
  if (!value) return "-";
  const date = Date.parse(value);
  if (Number.isNaN(date)) return "-";
  return new Date(date).toLocaleDateString(language === "tr" ? "tr-TR" : "en-US");
}

function foodDateKey(value: string | null | undefined): string | null {
  const date = Date.parse(String(value ?? ""));
  if (Number.isNaN(date)) return null;
  const normalized = new Date(date);
  const year = normalized.getFullYear();
  const month = String(normalized.getMonth() + 1).padStart(2, "0");
  const day = String(normalized.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatCurrency(value: number, language: Language): string {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat(language === "tr" ? "tr-TR" : "en-US", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 2,
  }).format(safe);
}

function normalizeImageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeSeedText(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const cleaned = raw
    .replace(/^LIVE-TR-SEED:\s*/i, "")
    .replace(/^TR-SEED:\s*/i, "")
    .replace(/canli\s*tr\s*menu/gi, "")
    .replace(/otomatik\s*eklenen\s*menu/gi, "")
    .replace(/standart\s*tarif/gi, "")
    .trim();
  return cleaned || null;
}

const FOOD_METADATA_BY_NAME: Record<string, { ingredients: string; imageUrl: string }> = {
  "izgara tavuk": {
    ingredients: "tavuk, yogurt, zeytinyagi, sarimsak, pul biber, kimyon, tuz, karabiber",
    imageUrl: "https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?auto=format&fit=crop&w=900&q=80",
  },
  "etli kuru fasulye": {
    ingredients: "kuru fasulye, dana eti, sogan, domates salcasi, siviyag, tuz, karabiber",
    imageUrl: "https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=900&q=80",
  },
  "adana kebap": {
    ingredients: "kuzu kiyma, kuyruk yagi, pul biber, paprika, tuz, isot, lavas, sogan",
    imageUrl: "https://images.unsplash.com/photo-1529692236671-f1f6cf9683ba?auto=format&fit=crop&w=900&q=80",
  },
  "mercimek corbasi": {
    ingredients: "kirmizi mercimek, sogan, havuc, patates, tereyagi, un, tuz, kimyon",
    imageUrl: "https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=80",
  },
  "firinda sutlac": {
    ingredients: "sut, pirinc, toz seker, nisasta, vanilya, tarcin",
    imageUrl: "https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=900&q=80",
  },
  "fistikli baklava": {
    ingredients: "baklava yufkasi, antep fistigi, tereyagi, toz seker, su, limon",
    imageUrl: "https://images.unsplash.com/photo-1626803775151-61d756612f97?auto=format&fit=crop&w=900&q=80",
  },
  "levrek izgara": {
    ingredients: "levrek fileto, zeytinyagi, limon, sarimsak, tuz, karabiber, roka",
    imageUrl: "https://images.unsplash.com/photo-1612874742237-6526221588e3?auto=format&fit=crop&w=900&q=80",
  },
  "zeytinyagli yaprak sarma": {
    ingredients: "asma yapragi, pirinc, sogan, zeytinyagi, kus uzumu, dolmalik fistik, nane, limon",
    imageUrl: "https://images.unsplash.com/photo-1611584186769-0a53b5f7f350?auto=format&fit=crop&w=900&q=80",
  },
  "kasarli sucuklu pide": {
    ingredients: "un, su, maya, kasar peyniri, sucuk, tereyagi, tuz",
    imageUrl: "https://images.unsplash.com/photo-1590947132387-155cc02f3212?auto=format&fit=crop&w=900&q=80",
  },
  "tavuklu pilav": {
    ingredients: "pirinc, tavuk gogsu, tereyagi, tavuk suyu, nohut, tuz, karabiber",
    imageUrl: "https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=900&q=80",
  },
};

function foodMetadataByName(value: string | null | undefined): { ingredients: string; imageUrl: string } | null {
  const key = String(value ?? "")
    .toLowerCase()
    .replace(/[ç]/g, "c")
    .replace(/[ğ]/g, "g")
    .replace(/[ı]/g, "i")
    .replace(/[ö]/g, "o")
    .replace(/[ş]/g, "s")
    .replace(/[ü]/g, "u")
    .trim();
  return FOOD_METADATA_BY_NAME[key] ?? null;
}

function isPlaceholderIngredients(value: string | null | undefined): boolean {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, "");
  if (!normalized) return true;
  return normalized.includes("icerik1") || normalized.includes("icerik2") || normalized.includes("standarttarif");
}

function resolveFoodIngredients(
  currentIngredients: string | null | undefined,
  recipe: string | null | undefined,
  metadataIngredients: string | null | undefined,
  language: Language
): string {
  if (!isPlaceholderIngredients(currentIngredients) && String(currentIngredients ?? "").trim()) {
    return String(currentIngredients).trim();
  }
  if (!isPlaceholderIngredients(recipe) && String(recipe ?? "").trim()) {
    return String(recipe).trim();
  }
  if (String(metadataIngredients ?? "").trim()) {
    return String(metadataIngredients).trim();
  }
  return language === "tr" ? "Belirtilmemiş" : "Not specified";
}

function resolveFoodImageUrl(
  name: string,
  currentImageUrl: string | null | undefined,
  metadataImageUrl: string | null | undefined
): string | null {
  const current = normalizeImageUrl(currentImageUrl);
  const meta = normalizeImageUrl(metadataImageUrl);
  if (!meta) return current;
  // Known placeholder flows should prefer name-based image metadata.
  const loweredName = name.toLowerCase();
  if (loweredName.includes("mercimek") || loweredName.includes("levrek") || loweredName.includes("baklava")) {
    return meta;
  }
  return current ?? meta;
}

function normalizeComplianceToken(value: string | null | undefined): string {
  const raw = String(value ?? "")
    .toLowerCase()
    .replace(/[ç]/g, "c")
    .replace(/[ğ]/g, "g")
    .replace(/[ı]/g, "i")
    .replace(/[ö]/g, "o")
    .replace(/[ş]/g, "s")
    .replace(/[ü]/g, "u")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return raw;
}

function pickComplianceSourceDate(source: ComplianceSource): string | null {
  return source.reviewedAt || source.uploadedAt || source.updatedAt || null;
}

function complianceToneFromStatus(status: string | null | undefined): ComplianceTone {
  const normalized = normalizeComplianceToken(status);
  if (!normalized) return "warning";
  if (["verified", "approved", "active", "completed", "tamamlandi"].includes(normalized)) return "success";
  if (["rejected", "declined", "failed", "expired"].includes(normalized)) return "danger";
  if (["pending", "submitted", "under_review", "in_progress", "not_started", "unknown"].includes(normalized)) return "warning";
  return "neutral";
}

function complianceLabelFromTone(tone: ComplianceTone, dict: Dictionary, sourceType: "document" | "check" | "fallback"): string {
  if (tone === "success") return dict.detail.sellerStatus.verified;
  if (tone === "danger") return dict.detail.sellerStatus.rejected;
  if (tone === "warning" && sourceType === "check") return dict.detail.sellerStatus.underReview;
  return dict.detail.sellerStatus.pending;
}

function profileBadgeFromStatus(
  status: SellerComplianceStatus | null | undefined,
  dict: Dictionary
): { label: string; tone: ComplianceTone } {
  if (!status) return { label: dict.detail.legalProfileBadge.pending, tone: "warning" };
  if (status === "approved") return { label: dict.detail.legalProfileBadge.completed, tone: "success" };
  if (status === "rejected") return { label: dict.detail.legalProfileBadge.rejected, tone: "danger" };
  if (status === "under_review") return { label: dict.detail.legalProfileBadge.inReview, tone: "warning" };
  return { label: dict.detail.legalProfileBadge.pending, tone: "warning" };
}

function sellerDocumentStatusLabel(status: SellerComplianceDocumentStatus, dict: Dictionary): string {
  if (status === "approved") return dict.detail.sellerStatus.approved;
  if (status === "rejected") return dict.detail.sellerStatus.rejected;
  if (status === "uploaded") return dict.detail.sellerStatus.uploaded;
  return dict.detail.sellerStatus.requested;
}

function sellerDocumentStatusTone(status: SellerComplianceDocumentStatus): ComplianceTone {
  if (status === "approved") return "success";
  if (status === "rejected") return "danger";
  if (status === "uploaded") return "warning";
  return "neutral";
}

function optionalUploadStatusLabel(status: OptionalUploadStatus, dict: Dictionary): string {
  if (status === "approved") return dict.detail.sellerStatus.approved;
  if (status === "rejected") return dict.detail.sellerStatus.rejected;
  if (status === "uploaded") return dict.detail.sellerStatus.uploaded;
  return dict.detail.optionalArchived;
}

function optionalUploadStatusTone(status: OptionalUploadStatus): ComplianceTone {
  if (status === "approved") return "success";
  if (status === "rejected") return "danger";
  if (status === "uploaded") return "warning";
  return "neutral";
}

function knownDocumentCodeRank(code: string): number {
  const normalized = normalizeComplianceToken(code);
  const order = [
    "food_business",
    "tax_plate",
    "kvkk",
    "food_safety_training",
    "phone_verification",
    "workplace_insurance",
  ];
  const index = order.findIndex((item) => normalized.includes(item));
  return index >= 0 ? index : 999;
}

function mapComplianceRows(
  payload: SellerCompliancePayload | null,
  dict: Dictionary,
  language: Language
): ComplianceRowViewModel[] {
  const docs = payload?.documents ?? [];
  const checks = payload?.checks ?? [];

  const docByKey = new Map<ComplianceRowKey, ComplianceSource>();
  const checkByKey = new Map<ComplianceRowKey, ComplianceSource>();

  const keyMatchers: Array<{ key: ComplianceRowKey; tokens: string[] }> = [
    { key: "foodBusiness", tokens: ["gida_isletme", "isletme_belgesi", "food_business", "business_license", "food_license"] },
    { key: "taxPlate", tokens: ["vergi_levhasi", "tax_plate", "tax_document", "tax", "vergi"] },
    { key: "kvkk", tokens: ["kvkk", "privacy", "kisisel_veri", "gdpr"] },
    { key: "foodSafetyTraining", tokens: ["gida_guvenligi_egitimi", "food_safety_training", "hygiene_training", "egitim"] },
    { key: "phoneVerification", tokens: ["telefon", "phone", "sms", "phone_verification", "telefon_dogrulama"] },
    { key: "workplaceInsurance", tokens: ["is_yeri_sigortasi", "workplace_insurance", "insurance", "sigorta"] },
  ];

  const resolveKey = (value: string): ComplianceRowKey | null => {
    for (const item of keyMatchers) {
      if (item.tokens.some((token) => value.includes(token))) return item.key;
    }
    return null;
  };

  for (const doc of docs) {
    const normalizedType = normalizeComplianceToken(doc.doc_type);
    const rowKey = resolveKey(normalizedType);
    if (!rowKey || docByKey.has(rowKey)) continue;
    docByKey.set(rowKey, {
      status: doc.status,
      reviewedAt: doc.reviewed_at,
      uploadedAt: doc.uploaded_at,
      updatedAt: null,
    });
  }

  for (const check of checks) {
    const normalizedCode = normalizeComplianceToken(check.check_code);
    const rowKey = resolveKey(normalizedCode);
    if (!rowKey || checkByKey.has(rowKey)) continue;
    let phoneValue: string | null = null;
    if (rowKey === "phoneVerification") {
      const raw = check.value_json;
      if (typeof raw === "string") phoneValue = raw;
      else if (raw && typeof raw === "object") {
        const valueObj = raw as Record<string, unknown>;
        const candidate = [valueObj.phone, valueObj.telephone, valueObj.number, valueObj.value].find(
          (entry) => typeof entry === "string" && entry.trim()
        );
        phoneValue = (candidate as string | undefined) ?? null;
      }
    }
    checkByKey.set(rowKey, {
      status: check.status,
      reviewedAt: null,
      uploadedAt: null,
      updatedAt: check.updated_at,
      phoneValue,
    });
  }

  const rowMeta: Array<{ key: ComplianceRowKey; label: string; optional?: boolean }> = [
    { key: "foodBusiness", label: dict.detail.complianceRows.foodBusiness },
    { key: "taxPlate", label: dict.detail.complianceRows.taxPlate },
    { key: "kvkk", label: dict.detail.complianceRows.kvkk },
    { key: "foodSafetyTraining", label: dict.detail.complianceRows.foodSafetyTraining },
    { key: "phoneVerification", label: dict.detail.complianceRows.phoneVerification },
    { key: "workplaceInsurance", label: dict.detail.complianceRows.workplaceInsurance, optional: true },
  ];

  return rowMeta.map((meta) => {
    const documentSource = docByKey.get(meta.key) ?? null;
    const checkSource = checkByKey.get(meta.key) ?? null;
    const source = documentSource ?? checkSource ?? null;
    const sourceType: "document" | "check" | "fallback" = documentSource ? "document" : checkSource ? "check" : "fallback";
    const tone = complianceToneFromStatus(source?.status ?? null);
    const statusLabel =
      tone === "success" && sourceType === "check" ? dict.detail.sellerStatus.validated : complianceLabelFromTone(tone, dict, sourceType);
    const date = pickComplianceSourceDate(
      source ?? {
        status: null,
        reviewedAt: null,
        uploadedAt: null,
        updatedAt: null,
      }
    );
    const dateText = formatUiDate(date, language);
    const phoneText = meta.key === "phoneVerification" ? maskPhone(source?.phoneValue ?? null) : null;
    const detailText = phoneText && phoneText !== "-" ? `${statusLabel} • ${phoneText}` : dateText !== "-" ? `${statusLabel} • ${dateText}` : statusLabel;
    return {
      key: meta.key,
      label: meta.label,
      statusLabel,
      tone,
      detailText,
      isOptional: meta.optional,
      sourceType,
    };
  });
}

function renderJsonLine(line: string): ReactNode {
  const match = line.match(/^(\s*)"([^"]+)":\s(.+?)(,?)$/);
  if (!match) return <code>{line}</code>;
  const [, indent, key, rawValue, comma] = match;
  const value = rawValue.trim();
  let valueClass = "json-value-plain";
  if (value.startsWith("\"")) valueClass = "json-value-string";
  else if (value === "true" || value === "false") valueClass = "json-value-bool";
  else if (value === "null") valueClass = "json-value-null";
  else if (/^-?\d/.test(value)) valueClass = "json-value-number";
  return (
    <code>
      {indent}
      <span className="json-key">"{key}"</span>
      <span className="json-sep">: </span>
      <span className={valueClass}>{value}</span>
      {comma}
    </code>
  );
}

function initialsFromName(displayName: string | null | undefined, email: string | null | undefined): string {
  const source = String(displayName || email || "").trim();
  if (!source) return "U";
  const pieces = source.split(/\s+/).filter(Boolean);
  if (pieces.length >= 2) return `${pieces[0][0]}${pieces[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function SellerDetailScreen({ id, isSuperAdmin, dict, language }: { id: string; isSuperAdmin: boolean; dict: Dictionary; language: Language }) {
  const location = useLocation();
  const navigate = useNavigate();
  const endpoint = `/v1/admin/users/${id}`;
  const [row, setRow] = useState<any | null>(null);
  const [compliance, setCompliance] = useState<SellerCompliancePayload | null>(null);
  const [foodRows, setFoodRows] = useState<SellerFoodRow[]>([]);
  const [sellerOrders, setSellerOrders] = useState<
    Array<{
      orderId: string;
      orderNo: string;
      buyerId: string;
      buyerName: string | null;
      buyerEmail: string | null;
      status: string;
      totalAmount: number;
      paymentCompleted: boolean;
      paymentStatus: string;
      paymentProvider: string | null;
      paymentUpdatedAt: string | null;
      createdAt: string;
      updatedAt: string;
      items: Array<{ name?: string; quantity?: number }>;
    }>
  >([]);
  const [sellerOrdersPagination, setSellerOrdersPagination] = useState<BuyerPagination | null>(null);
  const [activeTab, setActiveTab] = useState<SellerDetailTab>(() => resolveSellerDetailTab(new URLSearchParams(location.search).get("tab")));
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [legalSaving, setLegalSaving] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [optionalRejectTargetId, setOptionalRejectTargetId] = useState<string | null>(null);
  const [optionalRejectReason, setOptionalRejectReason] = useState("");
  const [profileImageFailed, setProfileImageFailed] = useState(false);
  const [foodImageErrors, setFoodImageErrors] = useState<Record<string, boolean>>({});
  const [lotsByFoodId, setLotsByFoodId] = useState<Record<string, AdminLotRow[]>>({});
  const [lotOrdersByLotId, setLotOrdersByLotId] = useState<Record<string, AdminLotOrderRow[]>>({});
  const [expandedFoodIds, setExpandedFoodIds] = useState<Record<string, boolean>>({});
  const [expandedLotIds, setExpandedLotIds] = useState<Record<string, boolean>>({});
  const [lotsLoading, setLotsLoading] = useState(false);
  const [lotsError, setLotsError] = useState<string | null>(null);
  const [lotOrdersLoadingByLotId, setLotOrdersLoadingByLotId] = useState<Record<string, boolean>>({});
  const [lotOrdersErrorByLotId, setLotOrdersErrorByLotId] = useState<Record<string, string | null>>({});

  async function loadSellerDetail() {
    setLoading(true);
    setMessage(null);
    setLotsError(null);
    try {
      const [detailResponse, complianceResponse, foodsResponse, sellerOrdersResponse] = await Promise.all([
        request(endpoint),
        request(`/v1/admin/compliance/${id}`),
        request(`/v1/admin/users/${id}/seller-foods?page=1&pageSize=200&sortDir=desc`),
        request(`/v1/admin/users/${id}/seller-orders?page=1&pageSize=20&sortDir=desc`),
      ]);

      if (detailResponse.status !== 200) {
        const body = await parseJson<ApiError>(detailResponse);
        setMessage(body.error?.message ?? dict.detail.loadFailed);
        return;
      }
      const detailBody = await parseJson<{ data: any }>(detailResponse);
      setRow(detailBody.data);

      if (complianceResponse.status === 200) {
        const complianceBody = await parseJson<{ data: SellerCompliancePayload }>(complianceResponse);
        setCompliance(complianceBody.data);
      } else {
        setCompliance(null);
      }

      if (foodsResponse.status === 200) {
        const foodsBody = await parseJson<{
          data: SellerFoodRow[];
        }>(foodsResponse);
        setFoodRows(foodsBody.data);
      } else {
        setFoodRows([]);
      }

      if (sellerOrdersResponse.status === 200) {
        const ordersBody = await parseJson<{ data: any[]; pagination: BuyerPagination }>(sellerOrdersResponse);
        setSellerOrders(ordersBody.data);
        setSellerOrdersPagination(ordersBody.pagination);
      } else {
        setSellerOrders([]);
        setSellerOrdersPagination(null);
      }

      setLotsLoading(true);
      try {
        const lots = await fetchAllAdminLots({ sellerId: id });
        const grouped: Record<string, AdminLotRow[]> = {};
        for (const lot of lots) {
          if (!grouped[lot.food_id]) grouped[lot.food_id] = [];
          grouped[lot.food_id].push(lot);
        }
        setLotsByFoodId(grouped);
      } catch (error) {
        setLotsByFoodId({});
        setLotsError(error instanceof Error ? error.message : dict.detail.requestFailed);
      } finally {
        setLotsLoading(false);
      }
    } catch {
      setMessage(dict.detail.requestFailed);
    } finally {
      setLoading(false);
    }
  }

  async function loadLotOrders(lotId: string) {
    if (lotOrdersByLotId[lotId]) return;
    setLotOrdersLoadingByLotId((prev) => ({ ...prev, [lotId]: true }));
    setLotOrdersErrorByLotId((prev) => ({ ...prev, [lotId]: null }));
    try {
      const response = await request(`/v1/admin/lots/${lotId}/orders`);
      if (response.status !== 200) {
        const body = await parseJson<ApiError>(response);
        setLotOrdersErrorByLotId((prev) => ({ ...prev, [lotId]: body.error?.message ?? dict.detail.requestFailed }));
        return;
      }
      const body = await parseJson<{ data: AdminLotOrderRow[] }>(response);
      setLotOrdersByLotId((prev) => ({ ...prev, [lotId]: body.data ?? [] }));
    } catch {
      setLotOrdersErrorByLotId((prev) => ({ ...prev, [lotId]: dict.detail.requestFailed }));
    } finally {
      setLotOrdersLoadingByLotId((prev) => ({ ...prev, [lotId]: false }));
    }
  }

  useEffect(() => {
    loadSellerDetail().catch(() => setMessage(dict.detail.requestFailed));
  }, [id]);

  useEffect(() => {
    setProfileImageFailed(false);
    setFoodImageErrors({});
    setRejectTargetId(null);
    setRejectReason("");
    setOptionalRejectTargetId(null);
    setOptionalRejectReason("");
    setLotsByFoodId({});
    setLotOrdersByLotId({});
    setExpandedFoodIds({});
    setExpandedLotIds({});
    setLotOrdersLoadingByLotId({});
    setLotOrdersErrorByLotId({});
    setLotsError(null);
  }, [id]);

  useEffect(() => {
    setActiveTab(resolveSellerDetailTab(new URLSearchParams(location.search).get("tab")));
  }, [location.search]);

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isSuperAdmin) return;
    const formData = new FormData(event.currentTarget);
    const payload: Record<string, string> = { email: String(formData.get("email") ?? "") };
    const password = String(formData.get("password") ?? "").trim();
    if (password) payload.password = password;
    const update = await request(endpoint, { method: "PUT", body: JSON.stringify(payload) });
    if (update.status !== 200) {
      const body = await parseJson<ApiError>(update);
      setMessage(body.error?.message ?? dict.detail.updateFailed);
      return;
    }
    const updated = await parseJson<{ data: any }>(update);
    setRow(updated.data);
    setMessage(dict.common.saved);
  }

  if (loading && !row) return <div className="panel">{dict.common.loading}</div>;
  if (!row) return <div className="panel">{message ?? dict.common.noRecords}</div>;

  const isActive = row.status === "active";
  const accountStatusLabel = isActive ? dict.common.active : dict.common.disabled;
  const phone = extractPhoneFromChecks(compliance);
  const maskedEmail = maskEmail(row.email);
  const profileRetentionUntil = addTwoYears(row.updatedAt);
  const complianceRetentionUntil = addTwoYears(compliance?.profile.updated_at);
  const totalFoods = Number(row.totalFoods ?? foodRows.length ?? 0);
  const latestFoodUpdatedAt = foodRows.reduce<string | null>((latest, item) => {
    const value = String(item.updatedAt ?? "");
    if (!value) return latest;
    if (!latest) return value;
    return Date.parse(value) > Date.parse(latest) ? value : latest;
  }, null);
  const foodRetentionUntil = addTwoYears(latestFoodUpdatedAt);
  const initials = initialsFromName(row.displayName, row.email);
  const fallbackProfileImageFromFoods = foodRows.map((item) => normalizeImageUrl(item.imageUrl)).find(Boolean) ?? null;
  const profileImageUrl =
    !profileImageFailed
      ? normalizeImageUrl(row.profileImageUrl) ?? normalizeImageUrl(row.profile_image_url) ?? fallbackProfileImageFromFoods
      : null;
  const complianceCta = language === "tr" ? "Uygunluğa Git" : "Go to Compliance";
  const auditCta = language === "tr" ? "Denetim Kayıtları" : "Audit Logs";
  const walletAmount = "—";
  const roleLabel =
    row.role === "seller"
      ? dict.users.userTypeSeller
      : row.role === "buyer"
        ? dict.users.userTypeBuyer
        : row.role === "both"
          ? dict.users.userTypeBoth
          : String(row.role ?? "-");
  const ratingSource = foodRows
    .map(() => 4)
    .filter((value) => Number.isFinite(value) && value > 0);
  const avgRating = ratingSource.length > 0 ? ratingSource.reduce((sum, value) => sum + value, 0) / ratingSource.length : 4;
  const roundedStars = Math.max(0, Math.min(5, Math.round(avgRating)));

  const legalRows = mapComplianceRows(compliance, dict, language);
  const profileBadge = profileBadgeFromStatus(compliance?.profile.status, dict);
  const legalDocuments = [...(compliance?.documents ?? [])].sort((a, b) => {
    const rankDiff = knownDocumentCodeRank(a.code) - knownDocumentCodeRank(b.code);
    if (rankDiff !== 0) return rankDiff;
    return a.name.localeCompare(b.name, language === "tr" ? "tr" : "en", { sensitivity: "base" });
  });
  const legalTypeRows = (() => {
    const map = new Map<string, (typeof legalDocuments)[number]>();
    for (const row of legalDocuments) {
      if (!map.has(row.code)) map.set(row.code, row);
    }
    return Array.from(map.values());
  })();
  const optionalUploads = [...(compliance?.optionalUploads ?? [])].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  async function updateDocumentStatus(documentId: string, status: "requested" | "approved" | "rejected", rejectionReasonInput?: string) {
    setLegalSaving(true);
    setMessage(null);
    try {
      const response = await request(`/v1/admin/compliance/${id}/documents/${documentId}`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          rejectionReason: status === "rejected" ? (rejectionReasonInput ?? null) : null,
        }),
      });
      if (response.status !== 200) {
        const body = await parseJson<ApiError>(response);
        setMessage(body.error?.message ?? dict.detail.legalUpdateFailed);
        return;
      }
      await loadSellerDetail();
      setMessage(dict.common.saved);
      setRejectTargetId(null);
      setRejectReason("");
      setOptionalRejectTargetId(null);
      setOptionalRejectReason("");
    } catch {
      setMessage(dict.detail.requestFailed);
    } finally {
      setLegalSaving(false);
    }
  }

  async function updateOptionalUploadStatus(uploadId: string, status: "uploaded" | "approved" | "rejected", rejectionReasonInput?: string) {
    setLegalSaving(true);
    setMessage(null);
    try {
      const response = await request(`/v1/admin/compliance/${id}/optional-uploads/${uploadId}`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          rejectionReason: status === "rejected" ? (rejectionReasonInput ?? null) : null,
        }),
      });
      if (response.status !== 200) {
        const body = await parseJson<ApiError>(response);
        setMessage(body.error?.message ?? dict.detail.legalUpdateFailed);
        return;
      }
      await loadSellerDetail();
      setMessage(dict.common.saved);
      setOptionalRejectTargetId(null);
      setOptionalRejectReason("");
    } catch {
      setMessage(dict.detail.requestFailed);
    } finally {
      setLegalSaving(false);
    }
  }

  async function updateDocumentRequired(docTypeCode: string, required: boolean) {
    setLegalSaving(true);
    setMessage(null);
    try {
      const response = await request(`/v1/admin/compliance/${id}/doc-types/${encodeURIComponent(docTypeCode)}`, {
        method: "PATCH",
        body: JSON.stringify({ required }),
      });
      if (response.status !== 200) {
        const body = await parseJson<ApiError>(response);
        setMessage(body.error?.message ?? dict.detail.legalUpdateFailed);
        return;
      }
      await loadSellerDetail();
      setMessage(dict.common.saved);
    } catch {
      setMessage(dict.detail.requestFailed);
    } finally {
      setLegalSaving(false);
    }
  }

  const sellerRawPayload = {
    id: row.id,
    user: row,
    compliance,
    foods: foodRows,
    orders: {
      rows: sellerOrders,
      pagination: sellerOrdersPagination,
    },
    derived: {
      emailMasked: maskedEmail,
      phoneFromComplianceChecks: phone,
      roleLabel,
      isActive,
    },
    legalHoldState: Boolean(row.legalHoldState),
  };

  const tabs = [
    { key: "general", label: dict.detail.sellerTabs.general },
    { key: "foods", label: dict.detail.sellerTabs.foods },
    { key: "orders", label: dict.detail.sellerTabs.orders },
    { key: "wallet", label: dict.detail.sellerTabs.wallet },
    { key: "identity", label: dict.detail.sellerTabs.identity },
    { key: "legal", label: dict.detail.sellerTabs.legal },
    { key: "retention", label: dict.detail.sellerTabs.retention },
    { key: "security", label: dict.detail.sellerTabs.security },
    { key: "raw", label: dict.detail.sellerTabs.raw },
  ] as const;

  return (
    <div className="app seller-detail-page">
      <section className="panel seller-hero">
        <article className="seller-hero-main">
          <div className="seller-avatar-col">
            <div className="seller-avatar">
              {profileImageUrl ? (
                <img
                  src={profileImageUrl}
                  alt={row.displayName ?? "seller"}
                  onError={() => setProfileImageFailed(true)}
                />
              ) : (
                <span>{initials}</span>
              )}
            </div>
            <div className="seller-rating-row" aria-label={`rating ${avgRating.toFixed(1)}`}>
              <span className="rating-value">{avgRating.toFixed(1)}</span>
              <span className="rating-stars" aria-hidden="true">
                {Array.from({ length: 5 }).map((_, index) => (
                  <span key={index} className={index < roundedStars ? "is-filled" : ""}>★</span>
                ))}
              </span>
            </div>
          </div>
          <div className="seller-hero-text">
            <div className="seller-hero-title-row">
              <h1>{row.displayName ?? row.email}</h1>
              <span className={`status-pill ${isActive ? "is-active" : "is-disabled"}`}>{accountStatusLabel}</span>
              <span className="seller-user-id">{`${dict.detail.userId}: ${row.id}`}</span>
            </div>
            <p>{maskedEmail}</p>
            <p className="panel-meta">
              <span>{roleLabel}</span>
              <span className="seller-country-badge">{row.countryCode ?? "-"}</span>
              <span>{`${language === "tr" ? "Kayıt" : "Created"}: ${formatUiDate(row.createdAt, language)}`}</span>
            </p>
          </div>
        </article>
        <div className="seller-hero-right">
          <div className="topbar-actions">
            <button className="ghost" type="button" onClick={() => loadSellerDetail().catch(() => setMessage(dict.detail.requestFailed))}>
              {dict.actions.refresh}
            </button>
            <button className="ghost" type="button" onClick={() => openQuickEmail(row.email, dict, setMessage)}>
              {dict.detail.quickEmail}
            </button>
            <button className="primary" type="button" onClick={() => setActiveTab("legal")}>{complianceCta}</button>
            <button className="ghost" type="button" onClick={() => navigate("/app/audit")}>{auditCta}</button>
          </div>
          <div className="seller-hero-stats">
            <article>
              <p>{dict.detail.sellerTabs.wallet}</p>
              <strong>{walletAmount}</strong>
            </article>
            <article>
              <p>{dict.detail.lastAction}</p>
              <strong>{formatUiDate(row.updatedAt, language)}</strong>
            </article>
          </div>
        </div>
      </section>

      {message ? <div className="alert">{message}</div> : null}

      <section className="panel seller-tabs-panel">
        <div className="seller-tabs" role="tablist" aria-label={dict.detail.sellerTabs.title}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              className={activeTab === tab.key ? "is-active" : ""}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {activeTab === "identity" ? (
        <section className="panel">
          <article>
            <div className="panel-header">
              <h2>{dict.detail.basicAccountEdit}</h2>
            </div>
            <form className="form-grid" onSubmit={onSave}>
              <label>
                {dict.auth.email}
                <input name="email" defaultValue={row.email} disabled={!isSuperAdmin} />
              </label>
              <label>
                {dict.detail.passwordOptional}
                <input name="password" type="password" disabled={!isSuperAdmin} placeholder={dict.detail.passwordPlaceholder} />
              </label>
              <div className="seller-actions-row">
                <span className="panel-meta">{`${dict.detail.saveChanges}: ${isSuperAdmin ? dict.common.yes : dict.common.no}`}</span>
                <button className="primary" disabled={!isSuperAdmin} type="submit">
                  {dict.actions.save}
                </button>
              </div>
            </form>
            <div className="seller-meta-chips">
              <span className="retention-chip">{`${dict.detail.updatedAtLabel}: ${formatUiDate(row.updatedAt, language)}`}</span>
              <span className="retention-chip">{`${dict.detail.legalHoldStateLabel}: ${Boolean(row.legalHoldState)}`}</span>
            </div>
            {!isSuperAdmin ? <p className="panel-meta">{dict.detail.readOnly}</p> : null}
          </article>
        </section>
      ) : null}

      {activeTab === "legal" ? (
        <section className="panel">
          <article className="seller-compliance-card">
            <div className="seller-compliance-header">
              <div className="seller-compliance-title">
                <span className="seller-compliance-flag" aria-hidden="true">🇹🇷</span>
                <h2>{dict.detail.trCompliance}</h2>
              </div>
              <span className={`status-pill compliance-status-pill is-${profileBadge.tone}`}>{profileBadge.label}</span>
            </div>
            {compliance?.profile.review_notes ? <div className="panel-note">{compliance.profile.review_notes}</div> : null}
            <div className="seller-compliance-list">
              <h3>{dict.detail.legalDocumentTypesTitle}</h3>
              {legalTypeRows.length === 0 ? (
                <p className="panel-meta">{dict.detail.noComplianceData}</p>
              ) : (
                <div className="buyer-ops-table-wrap legal-docs-table">
                  <table>
                    <thead>
                      <tr>
                        <th>{dict.detail.legalDocType}</th>
                        <th>{dict.detail.legalRequired}</th>
                        <th>{dict.detail.legalStatus}</th>
                        <th>{dict.detail.updatedAtLabel}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {legalTypeRows.map((row) => {
                        const tone = sellerDocumentStatusTone(row.status);
                        return (
                          <tr key={`dtype-${row.code}`}>
                            <td>
                              <strong>{row.name}</strong>
                              <div className="panel-meta legal-doc-sub">{row.code}</div>
                            </td>
                            <td>
                              <label className="legal-required-toggle">
                                <input
                                  type="checkbox"
                                  checked={row.is_required}
                                  disabled={!isSuperAdmin || legalSaving}
                                  onChange={(event) => {
                                    void updateDocumentRequired(row.code, event.target.checked);
                                  }}
                                />
                                <span>{row.is_required ? dict.common.yes : dict.common.no}</span>
                              </label>
                            </td>
                            <td><span className={`status-pill compliance-status-pill is-${tone}`}>{sellerDocumentStatusLabel(row.status, dict)}</span></td>
                            <td>{formatUiDate(row.updated_at, language)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="seller-compliance-list legal-doc-history-block">
              <h3>{dict.detail.legalDocumentHistoryTitle}</h3>
              {legalDocuments.length === 0 ? (
                <p className="panel-meta">{dict.detail.noComplianceData}</p>
              ) : (
                <div className="buyer-ops-table-wrap legal-docs-table">
                  <table>
                    <thead>
                      <tr>
                        <th>{dict.detail.legalUploadedAt}</th>
                        <th>{dict.detail.legalDocType}</th>
                        <th>{dict.detail.legalFile}</th>
                        <th>{dict.detail.legalStatus}</th>
                        <th>{dict.detail.legalReviewedAt}</th>
                        <th>{dict.detail.legalRejectionReason}</th>
                        <th>{dict.detail.legalActions}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {legalDocuments.map((row) => {
                        const tone = sellerDocumentStatusTone(row.status);
                        return (
                          <tr key={row.id}>
                            <td>{formatUiDate(row.uploaded_at, language)}</td>
                            <td>
                              <strong>{row.name}</strong>
                              <div className="panel-meta legal-doc-sub">{row.code}</div>
                            </td>
                            <td>
                              {row.file_url ? (
                                <a href={row.file_url} target="_blank" rel="noreferrer" className="inline-copy">{dict.detail.legalOpenFile}</a>
                              ) : (
                                <span className="panel-meta">-</span>
                              )}
                            </td>
                            <td><span className={`status-pill compliance-status-pill is-${tone}`}>{sellerDocumentStatusLabel(row.status, dict)}</span></td>
                            <td>{formatUiDate(row.reviewed_at, language)}</td>
                            <td>{row.rejection_reason ?? "-"}</td>
                            <td>
                              <div className="legal-doc-actions">
                                <button
                                  className="ghost compliance-edit-btn"
                                  type="button"
                                  disabled={!isSuperAdmin || legalSaving}
                                  onClick={() => void updateDocumentStatus(row.id, "approved")}
                                >
                                  {dict.detail.legalApprove}
                                </button>
                                <button
                                  className="ghost compliance-edit-btn"
                                  type="button"
                                  disabled={!isSuperAdmin || legalSaving}
                                  onClick={() => {
                                    setRejectTargetId(row.id);
                                    setRejectReason(row.rejection_reason ?? "");
                                  }}
                                >
                                  {dict.detail.legalReject}
                                </button>
                                <button
                                  className="ghost compliance-edit-btn"
                                  type="button"
                                  disabled={!isSuperAdmin || legalSaving}
                                  onClick={() => void updateDocumentStatus(row.id, "requested")}
                                >
                                  {dict.detail.legalPend}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="seller-compliance-list legal-doc-history-block">
              <h3>{dict.detail.optionalUploadsTitle}</h3>
              {optionalUploads.length === 0 ? (
                <p className="panel-meta">{dict.detail.noComplianceData}</p>
              ) : (
                <div className="buyer-ops-table-wrap legal-docs-table">
                  <table>
                    <thead>
                      <tr>
                        <th>{dict.detail.legalUploadedAt}</th>
                        <th>{dict.detail.optionalTitle}</th>
                        <th>{dict.detail.legalFile}</th>
                        <th>{dict.detail.legalStatus}</th>
                        <th>{dict.detail.legalReviewedAt}</th>
                        <th>{dict.detail.legalRejectionReason}</th>
                        <th>{dict.detail.legalActions}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {optionalUploads.map((row) => {
                        const tone = optionalUploadStatusTone(row.status);
                        const title = row.catalog_doc_name ?? row.custom_title ?? row.catalog_doc_code ?? "-";
                        return (
                          <tr key={`optional-${row.id}`}>
                            <td>{formatUiDate(row.created_at, language)}</td>
                            <td>
                              <strong>{title}</strong>
                              {row.custom_description ? <div className="panel-meta legal-doc-sub">{row.custom_description}</div> : null}
                            </td>
                            <td>
                              <a href={row.file_url} target="_blank" rel="noreferrer" className="inline-copy">{dict.detail.legalOpenFile}</a>
                            </td>
                            <td><span className={`status-pill compliance-status-pill is-${tone}`}>{optionalUploadStatusLabel(row.status, dict)}</span></td>
                            <td>{formatUiDate(row.reviewed_at, language)}</td>
                            <td>{row.rejection_reason ?? "-"}</td>
                            <td>
                              <div className="legal-doc-actions">
                                <button
                                  className="ghost compliance-edit-btn"
                                  type="button"
                                  disabled={!isSuperAdmin || legalSaving || row.status === "archived"}
                                  onClick={() => void updateOptionalUploadStatus(row.id, "approved")}
                                >
                                  {dict.detail.legalApprove}
                                </button>
                                <button
                                  className="ghost compliance-edit-btn"
                                  type="button"
                                  disabled={!isSuperAdmin || legalSaving || row.status === "archived"}
                                  onClick={() => {
                                    setOptionalRejectTargetId(row.id);
                                    setOptionalRejectReason(row.rejection_reason ?? "");
                                  }}
                                >
                                  {dict.detail.legalReject}
                                </button>
                                <button
                                  className="ghost compliance-edit-btn"
                                  type="button"
                                  disabled={!isSuperAdmin || legalSaving || row.status === "archived"}
                                  onClick={() => void updateOptionalUploadStatus(row.id, "uploaded")}
                                >
                                  {dict.detail.legalPend}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </article>
          {rejectTargetId ? (
            <div className="buyer-ops-modal-backdrop">
              <div className="buyer-ops-modal">
                <h3>{dict.detail.legalRejectModalTitle}</h3>
                <label>
                  {dict.detail.legalRejectionReason}
                  <textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} rows={4} />
                </label>
                <div className="buyer-ops-modal-actions">
                  <button className="ghost" type="button" onClick={() => { setRejectTargetId(null); setRejectReason(""); }}>
                    {dict.common.cancel}
                  </button>
                  <button
                    className="primary"
                    type="button"
                    disabled={!rejectReason.trim() || legalSaving}
                    onClick={() => void updateDocumentStatus(rejectTargetId, "rejected", rejectReason.trim())}
                  >
                    {dict.detail.legalReject}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {optionalRejectTargetId ? (
            <div className="buyer-ops-modal-backdrop">
              <div className="buyer-ops-modal">
                <h3>{dict.detail.optionalRejectModalTitle}</h3>
                <label>
                  {dict.detail.legalRejectionReason}
                  <textarea value={optionalRejectReason} onChange={(event) => setOptionalRejectReason(event.target.value)} rows={4} />
                </label>
                <div className="buyer-ops-modal-actions">
                  <button className="ghost" type="button" onClick={() => { setOptionalRejectTargetId(null); setOptionalRejectReason(""); }}>
                    {dict.common.cancel}
                  </button>
                  <button
                    className="primary"
                    type="button"
                    disabled={!optionalRejectReason.trim() || legalSaving}
                    onClick={() => void updateOptionalUploadStatus(optionalRejectTargetId, "rejected", optionalRejectReason.trim())}
                  >
                    {dict.detail.legalReject}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {activeTab === "foods" ? (
        <section className="panel">
          <div className="panel-header">
            <h2>{dict.detail.sellerTabs.foods}</h2>
          </div>
          <p className="panel-meta">{`${dict.detail.totalFoods}: ${totalFoods}`}</p>
          {lotsError ? <div className="alert">{lotsError}</div> : null}
          {foodRows.length === 0 ? (
            <p className="panel-meta">{dict.common.noRecords}</p>
          ) : (
            <div className="table-wrap">
              <table className="foods-lots-main-table">
                <thead>
                  <tr>
                    <th>{language === "tr" ? "Display ID" : "Display ID"}</th>
                    <th>{dict.detail.foodName}</th>
                    <th>{dict.detail.foodStatus}</th>
                    <th>{dict.detail.foodPrice}</th>
                    <th>{dict.detail.updatedAtLabel}</th>
                    <th>{dict.detail.lotSummary}</th>
                    <th>{dict.detail.lotActions}</th>
                  </tr>
                </thead>
                <tbody>
                  {foodRows.map((food) => {
                    const isActiveFood = food.status === "active";
                    const foodLots = lotsByFoodId[food.id] ?? [];
                    const activeLots = foodLots.filter((lot) => lot.lifecycle_status === "on_sale").length;
                    const recalledLots = foodLots.filter((lot) => lot.lifecycle_status === "recalled").length;
                    const foodExpanded = Boolean(expandedFoodIds[food.id]);
                    return (
                      <Fragment key={food.id}>
                        <tr>
                          <td>{toDisplayId(food.id)}</td>
                          <td>
                            <strong>{food.name}</strong>
                          </td>
                          <td>
                            <span className={`status-pill ${isActiveFood ? "is-active" : "is-disabled"}`}>
                              {isActiveFood ? dict.common.active : dict.common.disabled}
                            </span>
                          </td>
                          <td>{formatCurrency(food.price, language)}</td>
                          <td>{formatUiDate(food.updatedAt, language)}</td>
                          <td>
                            <div className="lot-summary-cell">
                              <span>{`${dict.detail.lotsTitle}: ${foodLots.length}`}</span>
                              <span>{`${language === "tr" ? "Satışta" : "On Sale"}: ${activeLots}`}</span>
                              {recalledLots > 0 ? <span className="lot-summary-danger">{`${language === "tr" ? "Geri çağrılan" : "Recalled"}: ${recalledLots}`}</span> : null}
                            </div>
                          </td>
                          <td>
                            <button
                              className="ghost"
                              type="button"
                              onClick={() => setExpandedFoodIds((prev) => ({ ...prev, [food.id]: !prev[food.id] }))}
                            >
                              {foodExpanded ? dict.detail.hideLots : dict.detail.showLots}
                            </button>
                          </td>
                        </tr>
                        {foodExpanded ? (
                          <tr className="foods-lots-expanded-row">
                            <td colSpan={7}>
                              {lotsLoading ? (
                                <p className="panel-meta">{dict.common.loading}</p>
                              ) : foodLots.length === 0 ? (
                                <p className="panel-meta">{dict.detail.noLotsForFood}</p>
                              ) : (
                                <div className="seller-food-lots-table-wrap">
                                  <table className="seller-food-lots-table">
                                    <thead>
                                      <tr>
                                        <th>{dict.detail.lotNumber}</th>
                                        <th>{dict.detail.lotLifecycle}</th>
                                        <th>{dict.detail.lotQuantity}</th>
                                        <th>{dict.detail.lotProducedAt}</th>
                                        <th>{dict.detail.lotSaleWindow}</th>
                                        <th>{dict.detail.lotSnapshot}</th>
                                        <th>{dict.detail.lotActions}</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {foodLots.map((lot) => {
                                        const diff = computeFoodLotDiff({
                                          foodRecipe: food.recipe,
                                          foodIngredients: food.ingredients,
                                          foodAllergens: undefined,
                                          lot,
                                        });
                                        const isLotExpanded = Boolean(expandedLotIds[lot.id]);
                                        const lotOrders = lotOrdersByLotId[lot.id] ?? [];
                                        return (
                                          <Fragment key={lot.id}>
                                            <tr>
                                              <td>{lot.lot_number}</td>
                                              <td>
                                                <span className={`status-pill ${lotLifecycleClass(lot.lifecycle_status)}`}>
                                                  {lotLifecycleLabel(lot.lifecycle_status, language)}
                                                </span>
                                              </td>
                                              <td>{`${lot.quantity_available}/${lot.quantity_produced}`}</td>
                                              <td>{formatUiDate(lot.produced_at, language)}</td>
                                              <td>{`${formatUiDate(lot.sale_starts_at, language)} - ${formatUiDate(lot.sale_ends_at, language)}`}</td>
                                              <td>
                                                <div className="lot-diff-badges">
                                                  {diff.hasMissingSnapshot ? <span className="status-pill is-danger">{dict.detail.lotSnapshotMissing}</span> : null}
                                                  {diff.recipeChanged ? <span className="status-pill is-warning">{dict.detail.lotDiffRecipe}</span> : null}
                                                  {diff.ingredientsChanged ? <span className="status-pill is-warning">{dict.detail.lotDiffIngredients}</span> : null}
                                                  {diff.allergensChanged ? <span className="status-pill is-danger">{dict.detail.lotDiffAllergens}</span> : null}
                                                  {!diff.hasMissingSnapshot && !diff.recipeChanged && !diff.ingredientsChanged && !diff.allergensChanged ? (
                                                    <span className="status-pill is-success">{dict.detail.lotSnapshotOk}</span>
                                                  ) : null}
                                                </div>
                                              </td>
                                              <td>
                                                <button
                                                  className="ghost"
                                                  type="button"
                                                  onClick={() => {
                                                    const next = !isLotExpanded;
                                                    setExpandedLotIds((prev) => ({ ...prev, [lot.id]: next }));
                                                    if (next) void loadLotOrders(lot.id);
                                                  }}
                                                >
                                                  {isLotExpanded ? dict.detail.hideLotOrders : dict.detail.showLotOrders}
                                                </button>
                                              </td>
                                            </tr>
                                            {isLotExpanded ? (
                                              <tr className="lot-orders-row">
                                                <td colSpan={7}>
                                                  {lotOrdersLoadingByLotId[lot.id] ? (
                                                    <p className="panel-meta">{dict.common.loading}</p>
                                                  ) : lotOrdersErrorByLotId[lot.id] ? (
                                                    <div className="alert">{lotOrdersErrorByLotId[lot.id]}</div>
                                                  ) : lotOrders.length === 0 ? (
                                                    <p className="panel-meta">{dict.detail.noOrdersForLot}</p>
                                                  ) : (
                                                    <div className="seller-food-lot-orders-wrap">
                                                      <table className="seller-food-lot-orders-table">
                                                        <thead>
                                                          <tr>
                                                            <th>{language === "tr" ? "Sipariş" : "Order"}</th>
                                                            <th>{language === "tr" ? "Durum" : "Status"}</th>
                                                            <th>{language === "tr" ? "Alıcı" : "Buyer"}</th>
                                                            <th>{language === "tr" ? "Adet" : "Quantity"}</th>
                                                            <th>{language === "tr" ? "Tarih" : "Created"}</th>
                                                          </tr>
                                                        </thead>
                                                        <tbody>
                                                          {lotOrders.map((order) => (
                                                            <tr key={`${lot.id}-${order.order_id}`}>
                                                              <td>{`#${order.order_id.slice(0, 10).toUpperCase()}`}</td>
                                                              <td>{order.status}</td>
                                                              <td>{order.buyer_id}</td>
                                                              <td>{order.quantity_allocated}</td>
                                                              <td>{formatUiDate(order.created_at, language)}</td>
                                                            </tr>
                                                          ))}
                                                        </tbody>
                                                      </table>
                                                    </div>
                                                  )}
                                                </td>
                                              </tr>
                                            ) : null}
                                          </Fragment>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {activeTab === "orders" ? (
        <section className="panel">
          <div className="panel-header">
            <h2>{dict.detail.sellerTabs.orders}</h2>
          </div>
          {sellerOrders.length === 0 ? (
            <p className="panel-meta">{dict.common.noRecords}</p>
          ) : (
            <>
              <div className="buyer-ops-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Display ID</th>
                      <th>Tarih / Saat</th>
                      <th>Sipariş No</th>
                      <th>Alıcı</th>
                      <th>Yemekler</th>
                      <th>Tutar</th>
                      <th>Ödeme</th>
                      <th>Durum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sellerOrders.map((order) => {
                      const paymentText = String(order.paymentStatus ?? "").toLowerCase().includes("fail")
                        ? "Başarısız"
                        : String(order.paymentStatus ?? "").toLowerCase().includes("pending")
                          ? "Bekliyor"
                          : "Başarılı";
                      const foods = Array.isArray(order.items)
                        ? order.items.map((item) => `${String(item.name ?? "-")} x${Number(item.quantity ?? 0)}`).join(", ")
                        : "-";
                      return (
                        <tr key={order.orderId}>
                          <td>{toDisplayId(order.orderId)}</td>
                          <td>{formatUiDate(order.createdAt, language)}</td>
                          <td>{order.orderNo}</td>
                          <td>{order.buyerName ?? order.buyerEmail ?? order.buyerId}</td>
                          <td>{foods || "-"}</td>
                          <td>{formatCurrency(Number(order.totalAmount ?? 0), language)}</td>
                          <td>{paymentText}</td>
                          <td>{order.status}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="panel-meta">
                {`${sellerOrdersPagination?.total ?? sellerOrders.length} sipariş`}
              </p>
            </>
          )}
        </section>
      ) : null}

      {activeTab === "retention" ? (
        <section className="panel">
          <div className="panel-header">
            <h2>{dict.detail.retentionPolicy}</h2>
          </div>
          <div className="seller-retention-chips">
            <span className="retention-chip">{`${dict.detail.retentionYears}: 2`}</span>
            <span className="retention-chip">{`${dict.detail.retentionUntil} (${dict.detail.sellerTabs.identity}): ${formatUiDate(
              profileRetentionUntil,
              language
            )}`}</span>
            <span className="retention-chip">{`${dict.detail.retentionUntil} (${dict.detail.trCompliance}): ${formatUiDate(
              complianceRetentionUntil,
              language
            )}`}</span>
            <span className="retention-chip">{`${dict.detail.retentionUntil} (${dict.detail.sellerTabs.foods}): ${formatUiDate(
              foodRetentionUntil,
              language
            )}`}</span>
            <span className="retention-chip">{`${dict.detail.legalHold}: ${Boolean(row.legalHoldState)}`}</span>
          </div>
        </section>
      ) : null}

      {activeTab === "security" ? (
        <section className="panel">
          <div className="panel-header">
            <h2>{dict.detail.sellerTabs.security}</h2>
          </div>
          <p className="panel-meta">{dict.detail.sectionPlanned}</p>
        </section>
      ) : null}

      {activeTab === "raw" ? (
        <section className="panel">
          <section className="seller-json-card">
            <div className="seller-json-header">
              <h2>{dict.detail.accountJson}</h2>
              <button
                className="ghost seller-json-copy"
                type="button"
                onClick={() => navigator.clipboard.writeText(JSON.stringify(sellerRawPayload, null, 2)).catch(() => undefined)}
              >
                {dict.detail.copyJson}
              </button>
            </div>
            <pre className="json-box">{JSON.stringify(sellerRawPayload, null, 2)}</pre>
          </section>
        </section>
      ) : null}

      {activeTab !== "identity" && activeTab !== "legal" && activeTab !== "foods" && activeTab !== "orders" && activeTab !== "retention" && activeTab !== "security" && activeTab !== "raw" ? (
        <section className="panel">
          <p className="panel-meta">{dict.detail.sectionPlanned}</p>
        </section>
      ) : null}
    </div>
  );
}

function DefaultUserDetailScreen({
  kind,
  isSuperAdmin,
  dict,
  id,
}: {
  kind: UserKind;
  isSuperAdmin: boolean;
  dict: Dictionary;
  id: string;
}) {
  const endpoint = kind === "admin" ? `/v1/admin/admin-users/${id}` : `/v1/admin/users/${id}`;
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
    const payload: Record<string, string> = { email: String(formData.get("email") ?? "") };
    const password = String(formData.get("password") ?? "").trim();
    if (password) payload.password = password;
    const update = await request(endpoint, { method: "PUT", body: JSON.stringify(payload) });
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
        <h2>{kind === "admin" ? dict.detail.adminUser : kind === "sellers" ? dict.detail.seller : dict.detail.appUser}</h2>
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

function UserDetail({ kind, isSuperAdmin, language }: { kind: UserKind; isSuperAdmin: boolean; language: Language }) {
  const dict = DICTIONARIES[language];
  const location = useLocation();
  const id = location.pathname.split("/").at(-1) ?? "";
  if (kind === "buyers") return <BuyerDetailScreen id={id} dict={dict} />;
  if (kind === "sellers") return <SellerDetailScreen id={id} isSuperAdmin={isSuperAdmin} dict={dict} language={language} />;
  return <DefaultUserDetailScreen kind={kind} isSuperAdmin={isSuperAdmin} dict={dict} id={id} />;
}

createRoot(document.getElementById("root")!).render(<App />);
