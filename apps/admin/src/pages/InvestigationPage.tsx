import { useEffect, useState } from "react";
import { request, parseJson } from "../lib/api";
import { DICTIONARIES } from "../lib/i18n";
import { fmt, toDisplayId } from "../lib/format";
import type { Language, ApiError } from "../types/core";

export default function InvestigationPage({ language }: { language: Language }) {
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

  async function downloadComplaintsAsExcel() {
    try {
      const exportQuery = new URLSearchParams({
        page: "1",
        pageSize: "5000",
        ...(statusFilter !== "all" ? { status: statusFilter } : {}),
        ...(searchInput.trim() ? { search: searchInput.trim() } : {}),
      });
      const response = await request(`/v1/admin/investigations/complaints?${exportQuery.toString()}`);
      const body = await parseJson<{
        data?: Array<{
          id: string;
          orderNo: string;
          complainantBuyerNo: string;
          subject: string;
          createdAt: string;
          status: "open" | "in_review" | "resolved" | "closed";
        }>;
      } & ApiError>(response);
      if (response.status !== 200 || !body.data) {
        setError(body.error?.message ?? dict.investigation.requestFailed);
        return;
      }
      if (body.data.length === 0) {
        setError(dict.common.noRecords);
        return;
      }

      const headers = [
        "Display ID",
        language === "tr" ? "Sipariş Numarası" : "Order No",
        language === "tr" ? "Alıcı Numarası" : "Buyer No",
        language === "tr" ? "Konu" : "Subject",
        language === "tr" ? "Oluşturma Tarihi" : "Created At",
        language === "tr" ? "Durum" : "Status",
      ];
      const rowsForExport = body.data.map((row) => [
        toDisplayId(row.id),
        row.orderNo,
        row.complainantBuyerNo,
        row.subject,
        new Date(row.createdAt).toLocaleString(language === "tr" ? "tr-TR" : "en-US"),
        statusText(row.status),
      ]);
      const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;
      const csv = [headers, ...rowsForExport].map((line) => line.map((cell) => escapeCsv(String(cell))).join(",")).join("\n");
      const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `complaints-${statusFilter}-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(dict.investigation.requestFailed);
    }
  }

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
    <div className="app investigation-page">
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
          <button className="primary" type="button" onClick={() => void downloadComplaintsAsExcel()}>
            {language === "tr" ? "Excel'e Aktar" : "Export to Excel"}
          </button>
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
