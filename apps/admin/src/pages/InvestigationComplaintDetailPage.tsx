import { useEffect, useState } from "react";
import { request, parseJson } from "../lib/api";
import { DICTIONARIES } from "../lib/i18n";
import type { Language, ApiError } from "../types/core";

type ComplaintStatus = "open" | "in_review" | "resolved" | "closed";

type ComplaintDetail = {
  id: string;
  orderId: string;
  orderNo: string;
  complainantBuyerId: string;
  complainantBuyerName: string;
  complainantBuyerEmail: string | null;
  sellerId: string;
  sellerName: string;
  sellerEmail: string | null;
  subject: string;
  description: string | null;
  categoryId: string | null;
  categoryCode: string | null;
  categoryName: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  resolvedAt: string | null;
  resolutionNote: string | null;
  assignedAdminId: string | null;
  assignedAdminEmail: string | null;
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

export default function InvestigationComplaintDetailPage({ language, complaintId }: { language: Language; complaintId: string }) {
  const dict = DICTIONARIES[language];
  const [detail, setDetail] = useState<ComplaintDetail | null>(null);
  const [notes, setNotes] = useState<ComplaintNote[]>([]);
  const [noteInput, setNoteInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const complaintDate = detail ? new Date(detail.createdAt).toLocaleString(language === "tr" ? "tr-TR" : "en-US") : "";
  const complainantLabel = detail
    ? `${detail.complainantBuyerName}${detail.complainantBuyerEmail ? ` (${detail.complainantBuyerEmail})` : ""}`
    : "";
  const complainedAgainstLabel = detail
    ? `${detail.sellerName}${detail.sellerEmail ? ` (${detail.sellerEmail})` : ""}`
    : "";
  const categoryLabel = detail?.categoryName ?? (language === "tr" ? "Kategori yok" : "No category");
  const subjectLabel = detail?.subject ?? "-";

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [detailRes, notesRes] = await Promise.all([
        request(`/v1/admin/investigations/complaints/${complaintId}`),
        request(`/v1/admin/investigations/complaints/${complaintId}/notes`),
      ]);
      const detailBody = await parseJson<{ data?: ComplaintDetail } & ApiError>(detailRes);
      const notesBody = await parseJson<{ data?: ComplaintNote[] } & ApiError>(notesRes);

      if (detailRes.status !== 200 || !detailBody.data) {
        setError(detailBody.error?.message ?? dict.investigation.requestFailed);
        return;
      }
      if (notesRes.status !== 200 || !notesBody.data) {
        setError(notesBody.error?.message ?? dict.investigation.requestFailed);
        return;
      }

      setDetail(detailBody.data);
      setNotes(notesBody.data);
    } catch {
      setError(dict.investigation.requestFailed);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData().catch(() => setError(dict.investigation.requestFailed));
  }, [complaintId, dict.investigation.requestFailed]);

  async function updateStatus(nextStatus: ComplaintStatus) {
    if (!detail || savingStatus) return;
    setSavingStatus(true);
    setError(null);
    try {
      const response = await request(`/v1/admin/investigations/complaints/${detail.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
      const body = await parseJson<{ data?: { status: ComplaintStatus } } & ApiError>(response);
      if (response.status !== 200 || !body.data) {
        setError(body.error?.message ?? dict.investigation.requestFailed);
        return;
      }
      setDetail((prev) => (prev ? { ...prev, status: body.data!.status } : prev));
    } catch {
      setError(dict.investigation.requestFailed);
    } finally {
      setSavingStatus(false);
    }
  }

  async function saveNote() {
    if (!detail || savingNote) return;
    const note = noteInput.trim();
    if (!note) return;
    setSavingNote(true);
    setError(null);
    try {
      const response = await request(`/v1/admin/investigations/complaints/${detail.id}/notes`, {
        method: "POST",
        body: JSON.stringify({ note }),
      });
      const body = await parseJson<{ data?: ComplaintNote } & ApiError>(response);
      if (response.status !== 201 || !body.data) {
        setError(body.error?.message ?? dict.investigation.requestFailed);
        return;
      }
      setNoteInput("");
      const notesRes = await request(`/v1/admin/investigations/complaints/${detail.id}/notes`);
      const notesBody = await parseJson<{ data?: ComplaintNote[] } & ApiError>(notesRes);
      if (notesRes.status === 200 && notesBody.data) setNotes(notesBody.data);
    } catch {
      setError(dict.investigation.requestFailed);
    } finally {
      setSavingNote(false);
    }
  }

  return (
    <div className="app investigation-page">
      <header className="topbar">
        <div>
          <h1>{language === "tr" ? "Şikayet Detayı" : "Complaint Detail"}</h1>
          <p className="subtext">{language === "tr" ? "Şikayetin tüm detaylarını inceleyin." : "Inspect all complaint details."}</p>
        </div>
      </header>

      <section className="panel">
        {loading ? <p className="panel-meta">{dict.common.loading}</p> : null}
        {error ? <div className="alert">{error}</div> : null}

        {detail ? (
          <>
            <div className="complaint-detail-card">
              <div className="complaint-status-strip">
                <div className="complaint-status-strip-label">{language === "tr" ? "Şikayet Durumu" : "Complaint Status"}</div>
                <div className="complaint-status-strip-options">
                  {(["open", "in_review", "resolved", "closed"] as ComplaintStatus[]).map((status) => (
                    <button
                      key={status}
                      className={`complaint-status-tab ${detail.status === status ? "is-active" : ""}`}
                      type="button"
                      disabled={savingStatus}
                      onClick={() => void updateStatus(status)}
                    >
                      {status === "in_review" && detail.status === status ? (
                        <span className="complaint-status-tab-icon" aria-hidden="true">
                          <svg viewBox="0 0 20 20" fill="none" role="presentation">
                            <path d="M6.3 10h7.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                            <path d="M9.2 7.2L6.2 10l3 2.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M13.2 8.1v3.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                          </svg>
                        </span>
                      ) : null}
                      <span>{statusText(status)}</span>
                      {detail.status === status ? (
                        <span className="complaint-status-tab-caret" aria-hidden="true">
                          <svg viewBox="0 0 20 20" fill="none" role="presentation">
                            <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>

              <div className="complaint-detail-grid">
                <div className="complaint-detail-field">
                  <span className="complaint-detail-label">{language === "tr" ? "Şikayet ID" : "Complaint ID"}</span>
                  <strong className="complaint-detail-value">{detail.id}</strong>
                </div>
                <div className="complaint-detail-field">
                  <span className="complaint-detail-label">{language === "tr" ? "Şikayet Tarihi" : "Complaint Date"}</span>
                  <strong className="complaint-detail-value">{complaintDate}</strong>
                </div>
                <div className="complaint-detail-field complaint-detail-field--wide">
                  <span className="complaint-detail-label">{language === "tr" ? "Şikayetçi" : "Complainant"}</span>
                  <strong className="complaint-detail-value">{complainantLabel}</strong>
                </div>
                <div className="complaint-detail-field complaint-detail-field--wide">
                  <span className="complaint-detail-label">{language === "tr" ? "Şikayet Edilen" : "Complained Against"}</span>
                  <strong className="complaint-detail-value">{complainedAgainstLabel}</strong>
                </div>
              </div>

              <div className="complaint-detail-divider" />

              <div className="complaint-tree">
                <div className="complaint-tree-heading">{language === "tr" ? "Şikayetler" : "Complaints"}</div>
                <div className="complaint-tree-node complaint-tree-node--category">
                  <span className="complaint-tree-branch" aria-hidden="true" />
                  <span className="complaint-tree-folder" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" role="presentation">
                      <path d="M3.5 7.5a2 2 0 0 1 2-2h4l1.6 1.8h7.4a2 2 0 0 1 2 2V16a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span className="complaint-tree-text">{categoryLabel}</span>
                </div>
                <div className="complaint-tree-node complaint-tree-node--subject">
                  <span className="complaint-tree-branch complaint-tree-branch--last" aria-hidden="true" />
                  <span className="complaint-tree-file" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" role="presentation">
                      <path d="M7 3.8h6.6l3.4 3.4V20.2H7V3.8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                      <path d="M13.6 3.8v3.4H17" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span className="complaint-tree-text">{subjectLabel}</span>
                </div>
              </div>

              <div className="complaint-description-card">
                <span className="complaint-detail-label">{language === "tr" ? "Sebep / Açıklama" : "Reason / Description"}</span>
                <p>{detail.description ?? "-"}</p>
              </div>
            </div>

            <div className="complaint-notes-card">
              <p className="panel-meta">{language === "tr" ? "Notlar" : "Notes"}</p>
              <label>
                {language === "tr" ? "Yeni Not" : "New Note"}
                <textarea value={noteInput} onChange={(event) => setNoteInput(event.target.value)} rows={3} />
              </label>
              <div className="topbar-actions" style={{ marginTop: 10 }}>
                <button className="primary" type="button" disabled={savingNote} onClick={() => void saveNote()}>
                  {savingNote ? dict.common.loading : dict.actions.save}
                </button>
              </div>

              <div className="table-wrap" style={{ marginTop: 10 }}>
                <table>
                  <thead>
                    <tr>
                      <th>{language === "tr" ? "Not" : "Note"}</th>
                      <th>{language === "tr" ? "Yazan Yönetici" : "Admin"}</th>
                      <th>{language === "tr" ? "Tarih" : "Date"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notes.length === 0 ? (
                      <tr>
                        <td colSpan={3}>{dict.common.noRecords}</td>
                      </tr>
                    ) : (
                      notes.map((item) => (
                        <tr key={item.id}>
                          <td>{item.note}</td>
                          <td>{item.createdByAdminEmail ?? item.createdByAdminId}</td>
                          <td>{new Date(item.createdAt).toLocaleString(language === "tr" ? "tr-TR" : "en-US")}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
