import { useEffect, useState } from "react";
import { request, parseJson } from "../lib/api";
import { DICTIONARIES } from "../lib/i18n";
import { ExcelExportButton } from "../components/ui";
import { fmt, toDisplayId } from "../lib/format";
import type { Language, ApiError } from "../types/core";

type ComplaintStatus = "open" | "in_review" | "resolved" | "closed";

type ComplaintRow = {
  id: string;
  orderNo: string;
  complainantBuyerNo: string;
  complainantBuyerName?: string;
  subject: string;
  categoryName?: string | null;
  createdAt: string;
  status: ComplaintStatus;
};

type ComplaintNote = {
  id: string;
  complaintId: string;
  note: string;
  createdByAdminId: string;
  createdByAdminEmail: string | null;
  createdAt: string;
};

export default function InvestigationPage({ language }: { language: Language }) {
  const dict = DICTIONARIES[language];
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | ComplaintStatus>("all");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ComplaintRow[]>([]);
  const [pagination, setPagination] = useState<{ total: number; totalPages: number } | null>(null);

  const [selectedComplaint, setSelectedComplaint] = useState<ComplaintRow | null>(null);
  const [notes, setNotes] = useState<ComplaintNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [noteInput, setNoteInput] = useState("");
  const [modalError, setModalError] = useState<string | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);

  const statusText = (status: ComplaintStatus) => {
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

  const statusClass = (status: ComplaintStatus) => {
    if (status === "open") return "is-pending";
    if (status === "in_review") return "is-approved";
    if (status === "resolved") return "is-done";
    return "is-disabled";
  };

  async function loadComplaintNotes(complaintId: string) {
    setNotesLoading(true);
    setModalError(null);
    try {
      const response = await request(`/v1/admin/investigations/complaints/${complaintId}/notes`);
      const body = await parseJson<{ data?: ComplaintNote[] } & ApiError>(response);
      if (response.status !== 200 || !body.data) {
        setModalError(body.error?.message ?? dict.investigation.requestFailed);
        return;
      }
      setNotes(body.data);
    } catch {
      setModalError(dict.investigation.requestFailed);
    } finally {
      setNotesLoading(false);
    }
  }

  async function openComplaintModal(row: ComplaintRow) {
    setSelectedComplaint(row);
    setNotes([]);
    setNoteInput("");
    await loadComplaintNotes(row.id);
  }

  async function updateComplaintStatus(nextStatus: ComplaintStatus) {
    if (!selectedComplaint || statusSaving) return;
    setStatusSaving(true);
    setModalError(null);
    try {
      const response = await request(`/v1/admin/investigations/complaints/${selectedComplaint.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
      const body = await parseJson<{ data?: { status: ComplaintStatus } } & ApiError>(response);
      if (response.status !== 200 || !body.data) {
        setModalError(body.error?.message ?? dict.investigation.requestFailed);
        return;
      }
      setSelectedComplaint((prev) => (prev ? { ...prev, status: body.data!.status } : prev));
      setRows((prev) => prev.map((item) => (item.id === selectedComplaint.id ? { ...item, status: body.data!.status } : item)));
    } catch {
      setModalError(dict.investigation.requestFailed);
    } finally {
      setStatusSaving(false);
    }
  }

  async function addComplaintNote() {
    if (!selectedComplaint || noteSaving) return;
    const note = noteInput.trim();
    if (!note) return;

    setNoteSaving(true);
    setModalError(null);
    try {
      const response = await request(`/v1/admin/investigations/complaints/${selectedComplaint.id}/notes`, {
        method: "POST",
        body: JSON.stringify({ note }),
      });
      const body = await parseJson<{ data?: ComplaintNote } & ApiError>(response);
      if (response.status !== 201 || !body.data) {
        setModalError(body.error?.message ?? dict.investigation.requestFailed);
        return;
      }
      setNoteInput("");
      await loadComplaintNotes(selectedComplaint.id);
    } catch {
      setModalError(dict.investigation.requestFailed);
    } finally {
      setNoteSaving(false);
    }
  }

  async function downloadComplaintsAsExcel() {
    try {
      const exportQuery = new URLSearchParams({
        page: "1",
        pageSize: "5000",
        ...(statusFilter !== "all" ? { status: statusFilter } : {}),
        ...(searchInput.trim() ? { search: searchInput.trim() } : {}),
      });
      const response = await request(`/v1/admin/investigations/complaints?${exportQuery.toString()}`);
      const body = await parseJson<{ data?: ComplaintRow[] } & ApiError>(response);
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
        language === "tr" ? "Alıcı" : "Buyer",
        language === "tr" ? "Şikayet Kategorisi" : "Complaint Category",
        language === "tr" ? "Oluşturma Tarihi" : "Created At",
        language === "tr" ? "Durum" : "Status",
      ];
      const rowsForExport = body.data.map((row) => [
        toDisplayId(row.id),
        row.orderNo,
        row.complainantBuyerName ?? row.complainantBuyerNo,
        row.categoryName ?? "-",
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
          data?: ComplaintRow[];
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
          <ExcelExportButton className="primary" type="button" onClick={() => void downloadComplaintsAsExcel()} language={language} />
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
                <th>{language === "tr" ? "Alıcı" : "Buyer"}</th>
                <th>{language === "tr" ? "Şikayet Kategorisi" : "Complaint Category"}</th>
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
                  <tr key={row.id} className="is-clickable" onClick={() => void openComplaintModal(row)}>
                    <td>
                      <button className="inline-copy" type="button" onClick={() => void openComplaintModal(row)}>
                        {toDisplayId(row.id)}
                      </button>
                    </td>
                    <td>{row.orderNo}</td>
                    <td>{row.complainantBuyerName ?? row.complainantBuyerNo}</td>
                    <td>{row.categoryName ?? "-"}</td>
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

      <div className={`drawer-overlay ${selectedComplaint ? "is-open" : ""}`} onClick={() => setSelectedComplaint(null)}>
        <section className={`settings-modal ${selectedComplaint ? "is-open" : ""}`} onClick={(event) => event.stopPropagation()}>
          <div className="form-drawer-header">
            <h2>{language === "tr" ? "Şikayet Detayı" : "Complaint Detail"}</h2>
            <button className="ghost" type="button" onClick={() => setSelectedComplaint(null)}>
              {language === "tr" ? "Kapat" : "Close"}
            </button>
          </div>

          {selectedComplaint ? (
            <>
              <div className="form-grid">
                <label>
                  {language === "tr" ? "Sipariş Numarası" : "Order No"}
                  <input value={selectedComplaint.orderNo} readOnly />
                </label>
                <label>
                  {language === "tr" ? "Şikayet Kategorisi" : "Complaint Category"}
                  <input value={selectedComplaint.categoryName ?? "-"} readOnly />
                </label>
                <label>
                  {language === "tr" ? "Konu" : "Subject"}
                  <input value={selectedComplaint.subject} readOnly />
                </label>
                <label>
                  {language === "tr" ? "Alıcı" : "Buyer"}
                  <input value={selectedComplaint.complainantBuyerName ?? selectedComplaint.complainantBuyerNo} readOnly />
                </label>
              </div>

              <div>
                <p className="panel-meta">{language === "tr" ? "Şikayet Durumu" : "Complaint Status"}</p>
                <div className="topbar-actions">
                  {(["open", "in_review", "resolved", "closed"] as ComplaintStatus[]).map((status) => (
                    <button
                      key={status}
                      className={selectedComplaint.status === status ? "primary" : "ghost"}
                      type="button"
                      disabled={statusSaving}
                      onClick={() => void updateComplaintStatus(status)}
                    >
                      {statusText(status)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="panel-meta">{language === "tr" ? "Notlar" : "Notes"}</p>
                <div className="form-grid">
                  <label>
                    {language === "tr" ? "Yeni Not" : "New Note"}
                    <textarea value={noteInput} onChange={(event) => setNoteInput(event.target.value)} rows={3} />
                  </label>
                </div>
                <div className="topbar-actions">
                  <button className="primary" type="button" disabled={noteSaving} onClick={() => void addComplaintNote()}>
                    {noteSaving ? dict.common.loading : dict.actions.save}
                  </button>
                </div>

                {notesLoading ? (
                  <p className="panel-meta">{dict.common.loading}</p>
                ) : notes.length === 0 ? (
                  <p className="panel-meta">{dict.common.noRecords}</p>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>{language === "tr" ? "Not" : "Note"}</th>
                          <th>{language === "tr" ? "Yazan" : "Author"}</th>
                          <th>{language === "tr" ? "Tarih" : "Date"}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {notes.map((item) => (
                          <tr key={item.id}>
                            <td>{item.note}</td>
                            <td>{item.createdByAdminEmail ?? item.createdByAdminId}</td>
                            <td>{new Date(item.createdAt).toLocaleString(language === "tr" ? "tr-TR" : "en-US")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          ) : null}

          {modalError ? <div className="alert">{modalError}</div> : null}
        </section>
      </div>
    </div>
  );
}
