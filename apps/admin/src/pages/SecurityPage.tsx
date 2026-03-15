import { useEffect, useState } from "react";
import { request, parseJson } from "../lib/api";
import { Pager } from "../components/ui";
import { fmt, formatTableDateTime } from "../lib/format";
import type { Language, ApiError } from "../types/core";

const PAGE_DICT = {
  en: {
    eyebrow: "Security",
    title: "Login Security",
    subtitle: "Brute-force protection monitoring and login risk events",
    riskyAccounts: "Risky Accounts (3+ failures)",
    softLocked: "Soft Locked Accounts",
    sharedDevice: "Shared Device Alarms",
    loadFailed: "Failed to load security data",
    requestFailed: "Security request failed",
    filterIdentifier: "Identifier (email)",
    filterDeviceId: "Device ID",
    filterIp: "IP Address",
    filterSuccess: "Result",
    filterMinFailedCount: "Min Failed Count",
    filterFrom: "From",
    filterTo: "To",
    filterSortDir: "Sort",
    filterPageSize: "Page Size",
    colTime: "Time",
    colIdentifier: "Identifier",
    colSuccess: "Success",
    colFailureReason: "Failure Reason",
    colDevice: "Device",
    colIp: "IP",
    colUserAgent: "User Agent",
    successTrue: "Success",
    successFalse: "Failed",
    allResults: "All",
    noEvents: "No events found",
  },
  tr: {
    eyebrow: "Güvenlik",
    title: "Giriş Güvenliği",
    subtitle: "Brute-force koruma izleme ve giriş riski olayları",
    riskyAccounts: "Riskli Hesaplar (3+ hata)",
    softLocked: "Soft Kilitli Hesaplar",
    sharedDevice: "Paylaşılan Cihaz Alarmları",
    loadFailed: "Güvenlik verisi yüklenemedi",
    requestFailed: "Güvenlik isteği başarısız",
    filterIdentifier: "Tanımlayıcı (e-posta)",
    filterDeviceId: "Cihaz ID",
    filterIp: "IP Adresi",
    filterSuccess: "Sonuç",
    filterMinFailedCount: "Min Hata Sayısı",
    filterFrom: "Başlangıç",
    filterTo: "Bitiş",
    filterSortDir: "Sıralama",
    filterPageSize: "Sayfa Boyutu",
    colTime: "Zaman",
    colIdentifier: "Tanımlayıcı",
    colSuccess: "Başarı",
    colFailureReason: "Hata Nedeni",
    colDevice: "Cihaz",
    colIp: "IP",
    colUserAgent: "Kullanıcı Ajanı",
    successTrue: "Başarılı",
    successFalse: "Başarısız",
    allResults: "Tümü",
    noEvents: "Olay bulunamadı",
  },
};

type SummaryData = {
  riskyAccountCount: number;
  softLockedCount: number;
  sharedDeviceAlarmCount: number;
};

type EventRow = {
  id: string;
  realm: string;
  actorUserId: string | null;
  identifier: string;
  success: boolean;
  failureReason: string | null;
  deviceId: string | null;
  deviceName: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
};

export default function SecurityPage({ language }: { language: Language }) {
  const dict = PAGE_DICT[language];

  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [pagination, setPagination] = useState<{ total: number } | null>(null);

  const [filters, setFilters] = useState({
    page: 1,
    pageSize: 20,
    identifier: "",
    deviceId: "",
    ip: "",
    success: "all",
    minFailedCount: "",
    from: "",
    to: "",
    sortDir: "desc" as "asc" | "desc",
  });

  async function loadSummary() {
    setSummaryError(null);
    const response = await request("/v1/admin/security/login-risk/summary");
    const body = await parseJson<{ data?: SummaryData } & ApiError>(response);
    if (response.status !== 200 || !body.data) {
      setSummaryError(body.error?.message ?? dict.loadFailed);
      return;
    }
    setSummary(body.data);
  }

  async function loadEvents() {
    setEventsLoading(true);
    setEventsError(null);

    const query = new URLSearchParams({
      page: String(filters.page),
      pageSize: String(filters.pageSize),
      sortDir: filters.sortDir,
      ...(filters.identifier ? { identifier: filters.identifier } : {}),
      ...(filters.deviceId ? { deviceId: filters.deviceId } : {}),
      ...(filters.ip ? { ip: filters.ip } : {}),
      ...(filters.success !== "all" ? { success: filters.success } : {}),
      ...(filters.minFailedCount ? { minFailedCount: filters.minFailedCount } : {}),
      ...(filters.from ? { from: new Date(filters.from).toISOString() } : {}),
      ...(filters.to ? { to: new Date(filters.to).toISOString() } : {}),
    });

    const response = await request(`/v1/admin/security/login-risk/events?${query.toString()}`);
    const body = await parseJson<{
      data?: { events: EventRow[]; total: number; page: number; pageSize: number };
    } & ApiError>(response);

    if (response.status !== 200 || !body.data) {
      setEventsError(body.error?.message ?? dict.loadFailed);
      setEventsLoading(false);
      return;
    }

    setEvents(body.data.events);
    setPagination({ total: body.data.total });
    setEventsLoading(false);
  }

  useEffect(() => {
    loadSummary().catch(() => setSummaryError(dict.requestFailed));
  }, [dict.requestFailed]);

  useEffect(() => {
    loadEvents().catch(() => setEventsError(dict.requestFailed));
  }, [
    filters.page,
    filters.pageSize,
    filters.sortDir,
    filters.identifier,
    filters.deviceId,
    filters.ip,
    filters.success,
    filters.minFailedCount,
    filters.from,
    filters.to,
    dict.requestFailed,
  ]);

  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / filters.pageSize)) : 1;

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <p className="eyebrow">{dict.eyebrow}</p>
          <h1>{dict.title}</h1>
          <p className="subtext">{dict.subtitle}</p>
        </div>
        <div className="topbar-actions">
          <button
            className="ghost"
            type="button"
            onClick={() => {
              loadSummary().catch(() => setSummaryError(dict.requestFailed));
              loadEvents().catch(() => setEventsError(dict.requestFailed));
            }}
          >
            {language === "tr" ? "Yenile" : "Refresh"}
          </button>
        </div>
      </header>

      {summaryError ? <div className="alert">{summaryError}</div> : null}

      {summary ? (
        <section className="panel">
          <div className="stats-grid">
            <div className="stat-card">
              <p className="stat-label">{dict.riskyAccounts}</p>
              <p className="stat-value">{summary.riskyAccountCount}</p>
            </div>
            <div className="stat-card">
              <p className="stat-label">{dict.softLocked}</p>
              <p className="stat-value">{summary.softLockedCount}</p>
            </div>
            <div className="stat-card">
              <p className="stat-label">{dict.sharedDevice}</p>
              <p className="stat-value">{summary.sharedDeviceAlarmCount}</p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="filter-grid">
          <label>
            {dict.filterIdentifier}
            <input
              value={filters.identifier}
              onChange={(e) => setFilters((prev) => ({ ...prev, page: 1, identifier: e.target.value }))}
            />
          </label>
          <label>
            {dict.filterDeviceId}
            <input
              value={filters.deviceId}
              onChange={(e) => setFilters((prev) => ({ ...prev, page: 1, deviceId: e.target.value }))}
            />
          </label>
          <label>
            {dict.filterIp}
            <input
              value={filters.ip}
              onChange={(e) => setFilters((prev) => ({ ...prev, page: 1, ip: e.target.value }))}
            />
          </label>
          <label>
            {dict.filterSuccess}
            <select
              value={filters.success}
              onChange={(e) => setFilters((prev) => ({ ...prev, page: 1, success: e.target.value }))}
            >
              <option value="all">{dict.allResults}</option>
              <option value="true">{dict.successTrue}</option>
              <option value="false">{dict.successFalse}</option>
            </select>
          </label>
          <label>
            {dict.filterMinFailedCount}
            <input
              type="number"
              min={0}
              value={filters.minFailedCount}
              onChange={(e) => setFilters((prev) => ({ ...prev, page: 1, minFailedCount: e.target.value }))}
            />
          </label>
          <label>
            {dict.filterFrom}
            <input
              type="datetime-local"
              value={filters.from}
              onChange={(e) => setFilters((prev) => ({ ...prev, page: 1, from: e.target.value }))}
            />
          </label>
          <label>
            {dict.filterTo}
            <input
              type="datetime-local"
              value={filters.to}
              onChange={(e) => setFilters((prev) => ({ ...prev, page: 1, to: e.target.value }))}
            />
          </label>
          <label>
            {dict.filterSortDir}
            <select
              value={filters.sortDir}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, page: 1, sortDir: e.target.value as "asc" | "desc" }))
              }
            >
              <option value="desc">{language === "tr" ? "Azalan" : "Descending"}</option>
              <option value="asc">{language === "tr" ? "Artan" : "Ascending"}</option>
            </select>
          </label>
          <label>
            {dict.filterPageSize}
            <select
              value={String(filters.pageSize)}
              onChange={(e) => setFilters((prev) => ({ ...prev, page: 1, pageSize: Number(e.target.value) }))}
            >
              <option value="20">20</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </label>
        </div>
      </section>

      {eventsError ? <div className="alert">{eventsError}</div> : null}

      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{dict.colTime}</th>
                <th>{dict.colIdentifier}</th>
                <th>{dict.colSuccess}</th>
                <th>{dict.colFailureReason}</th>
                <th>{dict.colDevice}</th>
                <th>{dict.colIp}</th>
                <th>{dict.colUserAgent}</th>
              </tr>
            </thead>
            <tbody>
              {eventsLoading ? (
                <tr>
                  <td colSpan={7}>{language === "tr" ? "Yükleniyor..." : "Loading..."}</td>
                </tr>
              ) : events.length === 0 ? (
                <tr>
                  <td colSpan={7}>{dict.noEvents}</td>
                </tr>
              ) : (
                events.map((row) => (
                  <tr key={row.id}>
                    <td>{formatTableDateTime(row.createdAt)}</td>
                    <td>{row.identifier}</td>
                    <td>{row.success ? dict.successTrue : dict.successFalse}</td>
                    <td>{row.failureReason ?? ""}</td>
                    <td>{[row.deviceName, row.deviceId].filter(Boolean).join(" / ")}</td>
                    <td>{row.ip ?? ""}</td>
                    <td className="audit-cell">{row.userAgent ?? ""}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <Pager
          page={filters.page}
          totalPages={totalPages}
          summary={fmt(
            language === "tr"
              ? "Toplam: {total} | Sayfa {page} / {totalPages}"
              : "Total: {total} | Page {page} / {totalPages}",
            { total: pagination?.total ?? 0, page: filters.page, totalPages }
          )}
          prevLabel={language === "tr" ? "Önceki" : "Prev"}
          nextLabel={language === "tr" ? "Sonraki" : "Next"}
          onPageChange={(nextPage) => setFilters((prev) => ({ ...prev, page: nextPage }))}
          onPrev={() => setFilters((prev) => ({ ...prev, page: prev.page - 1 }))}
          onNext={() => setFilters((prev) => ({ ...prev, page: prev.page + 1 }))}
        />
      </section>
    </div>
  );
}
