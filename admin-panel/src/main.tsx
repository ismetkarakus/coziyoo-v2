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
  return (
    <BrowserRouter>
      <Routes />
    </BrowserRouter>
  );
}

function Routes() {
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
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <>
      {location.pathname === "/login" ? <LoginScreen onLoggedIn={setAdminState} /> : null}
      {location.pathname !== "/login" ? <Shell admin={admin!} onLoggedOut={() => setAdminState(null)} /> : null}
    </>
  );
}

function LoginScreen({ onLoggedIn }: { onLoggedIn: (admin: AdminUser) => void }) {
  const [email, setEmail] = useState("admin@coziyoo.local");
  const [password, setPassword] = useState("Admin12345!");
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
        setError(body.error?.message ?? "Login failed");
        return;
      }

      setTokens(body.data.tokens);
      const meResp = await request("/v1/admin/auth/me");
      if (meResp.status !== 200) {
        setError("Could not load admin profile");
        return;
      }

      const me = await parseJson<{ data: AdminUser }>(meResp);
      setAdmin(me.data);
      onLoggedIn(me.data);
      navigate("/dashboard", { replace: true });
    } catch {
      setError("Network error: check API server and browser console (CORS/proxy).");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-wrap">
      <section className="login-card">
        <h1>Coziyoo Admin Control</h1>
        <p>Auth, dashboard, users and audit-safe mutations</p>
        <form onSubmit={onSubmit}>
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {error ? <div className="error-box">{error}</div> : null}
          <button disabled={loading} type="submit">{loading ? "Signing in..." : "Sign in"}</button>
        </form>
      </section>
    </main>
  );
}

function Shell({ admin, onLoggedOut }: { admin: AdminUser; onLoggedOut: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();

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
      <aside className="side">
        <h2>Coziyoo</h2>
        <nav>
          <Link className={location.pathname === "/dashboard" ? "active" : ""} to="/dashboard">Dashboard</Link>
          <Link className={location.pathname.startsWith("/users/app") ? "active" : ""} to="/users/app">App Users</Link>
          <Link className={location.pathname.startsWith("/users/admin") ? "active" : ""} to="/users/admin">Admin Users</Link>
        </nav>
        <div className="side-footer">
          <div>{admin.email}</div>
          <div className="role-chip">{admin.role}</div>
          <button onClick={logout}>Logout</button>
        </div>
      </aside>
      <section className="content">
        {location.pathname === "/dashboard" ? <DashboardPage /> : null}
        {location.pathname === "/users/app" ? <UsersPage kind="app" isSuperAdmin={isSuperAdmin} /> : null}
        {location.pathname === "/users/admin" ? <UsersPage kind="admin" isSuperAdmin={isSuperAdmin} /> : null}
        {location.pathname.startsWith("/users/app/") ? <UserDetail kind="app" isSuperAdmin={isSuperAdmin} /> : null}
        {location.pathname.startsWith("/users/admin/") ? <UserDetail kind="admin" isSuperAdmin={isSuperAdmin} /> : null}
      </section>
      <Outlet />
    </main>
  );
}

function DashboardPage() {
  const [data, setData] = useState<Record<string, number | string> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    request("/v1/admin/dashboard/overview")
      .then(async (response) => {
        if (response.status !== 200) {
          const body = (await parseJson<ApiError>(response)) ?? {};
          setError(body.error?.message ?? "Failed to load dashboard");
          return;
        }
        const body = await parseJson<{ data: Record<string, number | string> }>(response);
        setData(body.data);
      })
      .catch(() => setError("Dashboard request failed"));
  }, []);

  if (error) return <div className="error-box">{error}</div>;
  if (!data) return <div className="panel">Loading dashboard...</div>;

  return (
    <>
      <h1>Operational Overview</h1>
      <div className="kpi-grid">
        {Object.entries(data).map(([key, value]) => (
          <article className="kpi" key={key}>
            <h3>{key}</h3>
            <strong>{String(value)}</strong>
          </article>
        ))}
      </div>
    </>
  );
}

type UserKind = "app" | "admin";

function UsersPage({ kind, isSuperAdmin }: { kind: UserKind; isSuperAdmin: boolean }) {
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ page: 1, pageSize: 20, search: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const navigate = useNavigate();

  const endpoint = kind === "app" ? "/v1/admin/users" : "/v1/admin/admin-users";
  const tableKey = kind === "app" ? "users" : "adminUsers";

  const [fields, setFields] = useState<string[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);

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
      ...(filters.search ? { search: filters.search } : {}),
      sortBy: "createdAt",
      sortDir: "desc",
    });

    const response = await request(`${endpoint}?${query.toString()}`);
    const body = await parseJson<{ data?: any[] } & ApiError>(response);

    if (response.status !== 200 || !body.data) {
      setError(body.error?.message ?? "List failed");
      setLoading(false);
      return;
    }

    setRows(body.data);
    setLoading(false);
  }

  useEffect(() => {
    loadRows().catch(() => setError("List request failed"));
  }, [filters.page, filters.pageSize]);

  async function savePreferences() {
    const response = await request(`/v1/admin/table-preferences/${tableKey}`, {
      method: "PUT",
      body: JSON.stringify({ visibleColumns, columnOrder: visibleColumns }),
    });

    if (response.status !== 200) {
      setError("Could not save column preferences");
    }
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const formData = new FormData(event.currentTarget);

    if (kind === "app") {
      const payload = {
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
        displayName: String(formData.get("displayName") ?? ""),
        userType: String(formData.get("userType") ?? "buyer") as "buyer" | "seller" | "both",
      };
      const parsed = AppUserFormSchema.safeParse(payload);
      if (!parsed.success) {
        setFormError(parsed.error.issues[0]?.message ?? "Validation failed");
        return;
      }

      const create = await request(endpoint, {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });

      if (create.status !== 201) {
        const body = await parseJson<ApiError>(create);
        setFormError(body.error?.message ?? "Create failed");
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
        setFormError(parsed.error.issues[0]?.message ?? "Validation failed");
        return;
      }

      const create = await request(endpoint, {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });

      if (create.status !== 201) {
        const body = await parseJson<ApiError>(create);
        setFormError(body.error?.message ?? "Create failed");
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
      setError(body.error?.message ?? "Update failed");
      return;
    }

    await loadRows();
  }

  const tableColumns = useMemo(() => {
    if (visibleColumns.length === 0) return fields;
    return visibleColumns;
  }, [fields, visibleColumns]);

  return (
    <>
      <div className="page-head">
        <h1>{kind === "app" ? "App Users" : "Admin Users"}</h1>
        <div className="actions-inline">
          <input
            placeholder="Search by email"
            value={filters.search}
            onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
          />
          <button onClick={() => loadRows()}>Search</button>
        </div>
      </div>

      <section className="panel columns-panel">
        <h3>Columns ({tableKey})</h3>
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
        <button onClick={savePreferences}>Save Preferences</button>
      </section>

      {error ? <div className="error-box">{error}</div> : null}

      <section className="panel">
        <table>
          <thead>
            <tr>
              {tableColumns.map((column) => (
                <th key={column}>{column}</th>
              ))}
              <th>actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={tableColumns.length + 1}>Loading...</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  {tableColumns.map((column) => (
                    <td key={`${row.id}-${column}`}>{String(row[column] ?? "")}</td>
                  ))}
                  <td>
                    <button onClick={() => navigate(`/users/${kind}/${row.id}`)}>Detail</button>
                    {isSuperAdmin ? (
                      <>
                        <button
                          onClick={() =>
                            patchUser(row.id, "status", {
                              status: row.is_active || row.status === "active" ? "disabled" : "active",
                            })
                          }
                        >
                          Toggle Status
                        </button>
                        <button
                          onClick={() =>
                            patchUser(row.id, "role", {
                              role:
                                kind === "app"
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
                          Rotate Role
                        </button>
                      </>
                    ) : (
                      <span className="muted">read-only</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h3>Create {kind === "app" ? "App" : "Admin"} User</h3>
        {!isSuperAdmin ? <p className="muted">Only super_admin can create users.</p> : null}
        <form className="form-grid" onSubmit={createUser}>
          <label>
            Email
            <input name="email" disabled={!isSuperAdmin} />
          </label>
          <label>
            Password
            <input name="password" type="password" disabled={!isSuperAdmin} />
          </label>
          {kind === "app" ? (
            <>
              <label>
                Display Name
                <input name="displayName" disabled={!isSuperAdmin} />
              </label>
              <label>
                User Type
                <select name="userType" disabled={!isSuperAdmin}>
                  <option value="buyer">buyer</option>
                  <option value="seller">seller</option>
                  <option value="both">both</option>
                </select>
              </label>
            </>
          ) : (
            <label>
              Role
              <select name="role" disabled={!isSuperAdmin}>
                <option value="admin">admin</option>
                <option value="super_admin">super_admin</option>
              </select>
            </label>
          )}
          <button type="submit" disabled={!isSuperAdmin}>Create</button>
        </form>
        {formError ? <div className="error-box">{formError}</div> : null}
      </section>
    </>
  );
}

function UserDetail({ kind, isSuperAdmin }: { kind: UserKind; isSuperAdmin: boolean }) {
  const location = useLocation();
  const id = location.pathname.split("/").at(-1) ?? "";
  const endpoint = kind === "app" ? `/v1/admin/users/${id}` : `/v1/admin/admin-users/${id}`;

  const [row, setRow] = useState<any | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    request(endpoint)
      .then(async (response) => {
        if (response.status !== 200) {
          setMessage("Detail load failed");
          return;
        }
        const body = await parseJson<{ data: any }>(response);
        setRow(body.data);
      })
      .catch(() => setMessage("Detail request failed"));
  }, [endpoint]);

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
      setMessage(body.error?.message ?? "Update failed");
      return;
    }

    const updated = await parseJson<{ data: any }>(update);
    setRow(updated.data);
    setMessage("Saved");
  }

  if (!row) return <div className="panel">Loading detail...</div>;

  return (
    <section className="panel">
      <h1>{kind === "app" ? "App User Detail" : "Admin User Detail"}</h1>
      <pre className="json-box">{JSON.stringify(row, null, 2)}</pre>
      <form className="form-grid" onSubmit={onSave}>
        <label>
          Email
          <input name="email" defaultValue={row.email} disabled={!isSuperAdmin} />
        </label>
        <label>
          Password (optional reset)
          <input name="password" type="password" disabled={!isSuperAdmin} />
        </label>
        <button disabled={!isSuperAdmin} type="submit">Save</button>
      </form>
      {!isSuperAdmin ? <p className="muted">read-only mode for admin role.</p> : null}
      {message ? <div className="info-box">{message}</div> : null}
    </section>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
