import { useEffect, useMemo, useState } from "react";
import { parseJson, request } from "../lib/api";
import { DICTIONARIES } from "../lib/i18n";
import type { ApiError, Language } from "../types/core";

type Audience = "buyer" | "seller";

type AppUserListItem = {
  id: string;
  email: string;
  displayName: string;
  role: "buyer" | "seller" | "both";
  status: "active" | "disabled";
};

type SendResult = {
  target: {
    id: string;
    email: string;
    displayName: string;
    userType: "buyer" | "seller" | "both";
  };
  activeDeviceTokenCount: number;
};

function defaultTitle(language: Language, audience: Audience): string {
  if (language === "tr") return audience === "buyer" ? "Test Bildirim (Alıcı)" : "Test Bildirim (Satıcı)";
  return audience === "buyer" ? "Test Notification (Buyer)" : "Test Notification (Seller)";
}

function defaultBody(language: Language, audience: Audience): string {
  if (language === "tr") {
    return audience === "buyer"
      ? "Bu mesaj admin panel test ekranından gönderildi."
      : "Bu mesaj admin panelden satıcı test bildirimi olarak gönderildi.";
  }
  return audience === "buyer"
    ? "This message was sent from the admin test notification panel."
    : "This message was sent as a seller test notification from admin panel.";
}

export default function AdminNotificationTestPage({ language }: { language: Language }) {
  const dict = DICTIONARIES[language];
  const [audience, setAudience] = useState<Audience>("buyer");
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<AppUserListItem[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [title, setTitle] = useState(defaultTitle(language, "buyer"));
  const [body, setBody] = useState(defaultBody(language, "buyer"));
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendMessage, setSendMessage] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SendResult | null>(null);
  const trimmedSearch = search.trim();

  const selectedUser = useMemo(
    () => users.find((row) => row.id === selectedUserId) ?? null,
    [users, selectedUserId],
  );

  useEffect(() => {
    setTitle(defaultTitle(language, audience));
    setBody(defaultBody(language, audience));
  }, [language, audience]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadUsers();
    }, 180);
    return () => window.clearTimeout(timer);
  }, [audience, trimmedSearch]);

  async function loadUsers() {
    setLoadingUsers(true);
    setUsersError(null);
    try {
      const query = new URLSearchParams({
        page: "1",
        pageSize: "25",
        sortBy: "updatedAt",
        sortDir: "desc",
        audience,
      });
      if (trimmedSearch.length > 0) query.set("search", trimmedSearch);

      const response = await request(`/v1/admin/users?${query.toString()}`);
      const payload = await parseJson<{ data?: AppUserListItem[] } & ApiError>(response);
      if (response.status !== 200 || !Array.isArray(payload.data)) {
        setUsers([]);
        setUsersError(payload.error?.message ?? dict.testNotifications.usersLoadFailed);
        return;
      }

      setUsers(payload.data);
      if (payload.data.length === 0) {
        setSelectedUserId("");
      } else if (!payload.data.some((row) => row.id === selectedUserId)) {
        setSelectedUserId(payload.data[0].id);
      }
    } catch {
      setUsers([]);
      setUsersError(dict.testNotifications.usersLoadFailed);
    } finally {
      setLoadingUsers(false);
    }
  }

  async function sendTestNotification() {
    if (!selectedUserId) {
      setSendError(dict.testNotifications.selectUserRequired);
      return;
    }
    if (!title.trim() || !body.trim()) {
      setSendError(dict.testNotifications.fillFieldsRequired);
      return;
    }

    setSending(true);
    setSendError(null);
    setSendMessage(null);
    try {
      const response = await request("/v1/admin/notifications/test", {
        method: "POST",
        body: JSON.stringify({
          targetUserId: selectedUserId,
          audience,
          title: title.trim(),
          body: body.trim(),
        }),
      });
      const payload = await parseJson<{ data?: SendResult } & ApiError>(response);
      if (response.status !== 201 || !payload.data) {
        setSendError(payload.error?.message ?? dict.testNotifications.sendFailed);
        return;
      }
      setLastResult(payload.data);
      setSendMessage(dict.testNotifications.sendSuccess);
    } catch {
      setSendError(dict.testNotifications.sendFailed);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <p className="eyebrow">{dict.menu.management}</p>
          <h1>{dict.testNotifications.title}</h1>
          <p className="subtext">{dict.testNotifications.subtitle}</p>
        </div>
      </header>

      <section className="panel">
        <div className="panel-header">
          <h2>{dict.testNotifications.formTitle}</h2>
          <span className="panel-meta">{loadingUsers ? dict.common.loading : `${users.length}`}</span>
        </div>

        <div className="form-grid">
          <label>
            {dict.testNotifications.audienceLabel}
            <select value={audience} onChange={(event) => setAudience(event.target.value as Audience)}>
              <option value="buyer">{dict.testNotifications.audienceBuyer}</option>
              <option value="seller">{dict.testNotifications.audienceSeller}</option>
            </select>
          </label>
          <label>
            {dict.testNotifications.searchLabel}
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={dict.testNotifications.searchPlaceholder}
            />
          </label>
          <label>
            {dict.testNotifications.titleLabel}
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} />
          </label>
          <label>
            {dict.testNotifications.bodyLabel}
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={4}
              maxLength={500}
            />
          </label>
        </div>

        {usersError ? <div className="alert">{usersError}</div> : null}
        {sendError ? <div className="alert">{sendError}</div> : null}
        {sendMessage ? <div className="panel-note">{sendMessage}</div> : null}

        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table>
            <thead>
              <tr>
                <th>{dict.testNotifications.selectLabel}</th>
                <th>{dict.testNotifications.userNameLabel}</th>
                <th>{dict.testNotifications.userEmailLabel}</th>
                <th>{dict.testNotifications.userStatusLabel}</th>
              </tr>
            </thead>
            <tbody>
              {loadingUsers ? (
                <tr>
                  <td colSpan={4}>{dict.testNotifications.loadingUsers}</td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={4}>{dict.testNotifications.noUsers}</td>
                </tr>
              ) : (
                users.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <input
                        type="radio"
                        name="targetUser"
                        checked={row.id === selectedUserId}
                        onChange={() => setSelectedUserId(row.id)}
                      />
                    </td>
                    <td>{row.displayName || "-"}</td>
                    <td>{row.email}</td>
                    <td>{row.status}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="topbar-actions">
          <button className="primary" type="button" onClick={() => void sendTestNotification()} disabled={sending}>
            {sending ? dict.testNotifications.sending : dict.testNotifications.sendCta}
          </button>
        </div>
      </section>

      {lastResult ? (
        <section className="panel">
          <div className="panel-header">
            <h2>{dict.testNotifications.lastResultTitle}</h2>
            <span className="panel-meta">{selectedUser?.displayName ?? lastResult.target.displayName}</span>
          </div>
          <p className="panel-meta">{lastResult.target.id}</p>
          <p className="panel-meta">{lastResult.target.email}</p>
          <p className="panel-meta">
            {dict.testNotifications.activeTokenCountLabel}: {lastResult.activeDeviceTokenCount}
          </p>
        </section>
      ) : null}
    </div>
  );
}
