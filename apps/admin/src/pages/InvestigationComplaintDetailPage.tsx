import { useEffect, useState } from "react";
import { request, parseJson } from "../lib/api";
import { DICTIONARIES } from "../lib/i18n";
import type { Language, ApiError } from "../types/core";

type ComplaintStatus = "open" | "in_review" | "resolved" | "closed";

type ComplaintDetail = {
  id: string;
  ticketNo: number;
  orderId: string;
  orderNo: string;
  complainantType: "buyer" | "seller";
  complainantUserId: string;
  complainantName: string;
  complainantEmail: string | null;
  complainedAgainstType: "buyer" | "seller";
  complainedAgainstUserId: string;
  complainedAgainstName: string;
  complainedAgainstEmail: string | null;
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
  const [savingPriority, setSavingPriority] = useState(false);
  const [resolutionNoteInput, setResolutionNoteInput] = useState("");
  const [savingResolutionNote, setSavingResolutionNote] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const statusText = (status: ComplaintStatus) => {
    if (status === "open") return dict.investigation.complaintStatusOpen;
    if (status === "in_review") return dict.investigation.complaintStatusInReview;
    if (status === "resolved") return dict.investigation.complaintStatusResolved;
    return dict.investigation.complaintStatusClosed;
  };

  const priorityText = (p: ComplaintDetail["priority"]) => {
    if (p === "low") return dict.reviewQueue.priorityLow;
    if (p === "medium") return dict.reviewQueue.priorityMedium;
    if (p === "high") return dict.reviewQueue.priorityHigh;
    return dict.reviewQueue.priorityUrgent;
  };

  const complaintDate = detail ? new Date(detail.createdAt).toLocaleString(language === "tr" ? "tr-TR" : "en-US") : "";
  const complainantLabel = detail
    ? `${detail.complainantName}${detail.complainantEmail ? ` (${detail.complainantEmail})` : ""}`
    : "";
  const complainedAgainstLabel = detail
    ? `${detail.complainedAgainstName}${detail.complainedAgainstEmail ? ` (${detail.complainedAgainstEmail})` : ""}`
    : "";
  const categoryLabel = detail?.categoryName ?? dict.investigation.noCategory;
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
      setResolutionNoteInput(detailBody.data.resolutionNote ?? "");
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

  async function updatePriority(p: ComplaintDetail["priority"]) {
    if (!detail || savingPriority) return;
    setSavingPriority(true);
    setError(null);
    try {
      const response = await request(`/v1/admin/investigations/complaints/${detail.id}`, {
        method: "PATCH",
        body: JSON.stringify({ priority: p }),
      });
      const body = await parseJson<{ data?: { priority: ComplaintDetail["priority"] } } & ApiError>(response);
      if (response.status !== 200 || !body.data) {
        setError(body.error?.message ?? dict.investigation.requestFailed);
        return;
      }
      setDetail((prev) => (prev ? { ...prev, priority: body.data!.priority } : prev));
    } catch {
      setError(dict.investigation.requestFailed);
    } finally {
      setSavingPriority(false);
    }
  }

  async function saveResolutionNote() {
    if (!detail || savingResolutionNote) return;
    setSavingResolutionNote(true);
    setError(null);
    try {
      const response = await request(`/v1/admin/investigations/complaints/${detail.id}`, {
        method: "PATCH",
        body: JSON.stringify({ resolutionNote: resolutionNoteInput }),
      });
      const body = await parseJson<{ data?: { resolutionNote: string | null } } & ApiError>(response);
      if (response.status !== 200 || !body.data) {
        setError(body.error?.message ?? dict.investigation.requestFailed);
        return;
      }
      setDetail((prev) => (prev ? { ...prev, resolutionNote: body.data!.resolutionNote } : prev));
    } catch {
      setError(dict.investigation.requestFailed);
    } finally {
      setSavingResolutionNote(false);
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
          <h1>{dict.investigation.detailTitle}</h1>
          <p className="subtext">{dict.investigation.detailSubtitle}</p>
        </div>
      </header>

      <section className="panel">
        {loading ? <p className="panel-meta">{dict.common.loading}</p> : null}
        {error ? <div className="alert">{error}</div> : null}

        {detail ? (
          <div className="complaint-ticket-layout">
            {/* Left column */}
            <div className="complaint-ticket-main">
              {/* Header */}
              <div className="complaint-ticket-header">
                <span className="complaint-ticket-no">#{detail.ticketNo}</span>
                <h2 className="complaint-ticket-subject">{detail.subject}</h2>
              </div>

              {/* Status strip */}
              <div className="complaint-status-strip">
                <div className="complaint-status-strip-label">{dict.investigation.complaintStatusLabel}</div>
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

              {/* Metadata grid */}
              <div className="complaint-detail-grid">
                <div className="complaint-detail-field">
                  <span className="complaint-detail-label">{dict.investigation.complaintId}</span>
                  <strong className="complaint-detail-value">{detail.id}</strong>
                </div>
                <div className="complaint-detail-field">
                  <span className="complaint-detail-label">{dict.investigation.complaintDate}</span>
                  <strong className="complaint-detail-value">{complaintDate}</strong>
                </div>
                <div className="complaint-detail-field complaint-detail-field--wide">
                  <span className="complaint-detail-label">{dict.investigation.complainant}</span>
                  <strong className="complaint-detail-value">{complainantLabel}</strong>
                </div>
                <div className="complaint-detail-field complaint-detail-field--wide">
                  <span className="complaint-detail-label">{dict.investigation.complainedAgainst}</span>
                  <strong className="complaint-detail-value">{complainedAgainstLabel}</strong>
                </div>
              </div>

              {/* Priority selector */}
              <div className="complaint-detail-field" style={{ marginTop: 16 }}>
                <span className="complaint-detail-label">{dict.investigation.priorityLabel}</span>
                <div className="complaint-priority-buttons" style={{ marginTop: 8 }}>
                  {(["low", "medium", "high", "urgent"] as ComplaintDetail["priority"][]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      disabled={savingPriority}
                      className={`complaint-priority-btn priority-${p}${detail.priority === p ? " is-active" : ""}`}
                      onClick={() => void updatePriority(p)}
                    >
                      {priorityText(p)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Assigned admin */}
              <div className="complaint-detail-field" style={{ marginTop: 14 }}>
                <span className="complaint-detail-label">{dict.investigation.assignedAdmin}</span>
                <strong className="complaint-detail-value">
                  {detail.assignedAdminEmail ?? dict.investigation.unassigned}
                </strong>
              </div>

              <div className="complaint-detail-divider" style={{ marginTop: 20 }} />

              {/* Category + subject tree */}
              <div className="complaint-tree">
                <div className="complaint-tree-heading">{dict.investigation.complaints}</div>
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

              {/* Description */}
              <div className="complaint-description-card">
                <span className="complaint-detail-label">{dict.investigation.reasonDescription}</span>
                <p>{detail.description ?? "-"}</p>
              </div>

              {/* Resolution note (only when resolved or closed) */}
              {(detail.status === "resolved" || detail.status === "closed") ? (
                <div style={{ marginTop: 16 }}>
                  <label className="complaint-detail-label">{dict.investigation.resolutionNote}</label>
                  <textarea
                    value={resolutionNoteInput}
                    onChange={(event) => setResolutionNoteInput(event.target.value)}
                    rows={3}
                    style={{ marginTop: 8, width: "100%" }}
                  />
                  <div className="topbar-actions" style={{ marginTop: 8 }}>
                    <button className="primary" type="button" disabled={savingResolutionNote} onClick={() => void saveResolutionNote()}>
                      {savingResolutionNote ? dict.common.loading : dict.actions.save}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Right column — notes thread */}
            <div className="complaint-ticket-thread">
              <p className="panel-meta">{dict.investigation.notes}</p>

              <div className="complaint-notes-thread">
                {notes.length === 0 ? (
                  <p style={{ color: "var(--color-secondary-text)", fontSize: "var(--text-sm)" }}>{dict.common.noRecords}</p>
                ) : (
                  notes.map((item) => (
                    <div key={item.id} className="complaint-note-item">
                      <div className="complaint-note-meta">
                        <span className="complaint-note-author">{item.createdByAdminEmail ?? item.createdByAdminId}</span>
                        <span className="complaint-note-date">
                          {new Date(item.createdAt).toLocaleString(language === "tr" ? "tr-TR" : "en-US")}
                        </span>
                      </div>
                      <p className="complaint-note-text">{item.note}</p>
                    </div>
                  ))
                )}
              </div>

              <label>
                {dict.investigation.newNote}
                <textarea value={noteInput} onChange={(event) => setNoteInput(event.target.value)} rows={3} />
              </label>
              <div className="topbar-actions" style={{ marginTop: 10 }}>
                <button className="primary" type="button" disabled={savingNote} onClick={() => void saveNote()}>
                  {savingNote ? dict.common.loading : dict.actions.save}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
