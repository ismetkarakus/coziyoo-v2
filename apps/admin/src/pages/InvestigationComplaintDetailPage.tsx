import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { request, parseJson } from "../lib/api";
import { getAdmin } from "../lib/auth";
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
  const navigate = useNavigate();
  const dict = DICTIONARIES[language];
  const currentAdmin = getAdmin();
  const noteInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [detail, setDetail] = useState<ComplaintDetail | null>(null);
  const [notes, setNotes] = useState<ComplaintNote[]>([]);
  const [noteInput, setNoteInput] = useState("");
  const [replyToNote, setReplyToNote] = useState<ComplaintNote | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [savingPriority, setSavingPriority] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<"idle" | "copied" | "failed">("idle");
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
  const categoryLabel = detail?.categoryName ?? dict.investigation.noCategory;
  const currentAdminLabel = currentAdmin?.email ?? dict.investigation.unassigned;

  useEffect(() => {
    if (copyFeedback === "idle") return;
    const timeout = window.setTimeout(() => setCopyFeedback("idle"), 1800);
    return () => window.clearTimeout(timeout);
  }, [copyFeedback]);

  useEffect(() => {
    const textarea = noteInputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [noteInput]);

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

  async function saveNote() {
    if (!detail || savingNote) return;
    const rawNote = noteInput.trim();
    if (!rawNote) return;
    const note = replyToNote
      ? `${language === "tr" ? "Ek not" : "Addendum"} • ${replyToNote.createdByAdminEmail ?? replyToNote.createdByAdminId} • ${new Date(replyToNote.createdAt).toLocaleString(language === "tr" ? "tr-TR" : "en-US")}\n${rawNote}`
      : rawNote;
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
      setReplyToNote(null);
      const notesRes = await request(`/v1/admin/investigations/complaints/${detail.id}/notes`);
      const notesBody = await parseJson<{ data?: ComplaintNote[] } & ApiError>(notesRes);
      if (notesRes.status === 200 && notesBody.data) setNotes(notesBody.data);
    } catch {
      setError(dict.investigation.requestFailed);
    } finally {
      setSavingNote(false);
    }
  }

  async function copyComplaintId() {
    if (!detail) return;
    try {
      await navigator.clipboard.writeText(detail.id);
      setCopyFeedback("copied");
    } catch {
      setCopyFeedback("failed");
    }
  }

  const userPathFor = (type: "buyer" | "seller", userId: string) => (
    type === "buyer" ? `/app/buyers/${userId}` : `/app/sellers/${userId}`
  );

  const statusOptions = ["open", "in_review", "resolved", "closed"] as ComplaintStatus[];
  const priorityOptions = ["low", "medium", "high", "urgent"] as ComplaintDetail["priority"][];

  return (
    <div className="app investigation-page">
      <header className="topbar complaint-detail-topbar">
        <div className="complaint-detail-heading">
          <h1>{dict.investigation.detailTitle}</h1>
        </div>
      </header>

      <section className="panel">
        {loading ? <p className="panel-meta">{dict.common.loading}</p> : null}
        {error ? <div className="alert">{error}</div> : null}

        {detail ? (
          <div className="complaint-ticket-layout complaint-ticket-layout--refresh complaint-ticket-layout--single">
            <div className="complaint-ticket-main">
              <div className="complaint-summary-card">
                <div className="complaint-summary-meta">
                  <div className="complaint-summary-ticket-row">
                    <span className="complaint-ticket-no">#{detail.ticketNo}</span>
                    <span className="complaint-badge-label">{dict.investigation.complaintStatusLabel}</span>
                    <select
                      className={`complaint-badge complaint-badge-select status-${detail.status}`}
                      value={detail.status}
                      disabled={savingStatus}
                      onChange={(event) => void updateStatus(event.target.value as ComplaintStatus)}
                    >
                      {statusOptions.map((status) => (
                        <option key={status} value={status}>{statusText(status)}</option>
                      ))}
                    </select>
                    <span className="complaint-badge-label">{dict.investigation.priorityLabel}</span>
                    <select
                      className={`complaint-badge complaint-badge-select priority-${detail.priority}`}
                      value={detail.priority}
                      disabled={savingPriority}
                      onChange={(event) => void updatePriority(event.target.value as ComplaintDetail["priority"])}
                    >
                      {priorityOptions.map((priority) => (
                        <option key={priority} value={priority}>{priorityText(priority)}</option>
                      ))}
                    </select>
                    <div className="complaint-quick-actions-inline complaint-quick-actions-inline--header">
                      <div className="complaint-quick-action-item">
                        <span className="complaint-quick-action-head">
                          <span className="complaint-detail-label">{dict.investigation.assignedAdmin}</span>
                        </span>
                        <div className="complaint-quick-action-value">
                          {currentAdminLabel}
                        </div>
                      </div>
                    </div>
                  </div>
                  <h2 className="complaint-ticket-subject">{detail.subject}</h2>
                </div>

                <div className="complaint-summary-divider" />

                <div className="complaint-summary-info-grid">
                  <div className="complaint-summary-info">
                    <span className="complaint-detail-label">{dict.investigation.complaintId}</span>
                    <div className="complaint-copy-row">
                      <strong className="complaint-summary-info-value">{detail.id}</strong>
                      <button
                        className="inline-copy complaint-copy-btn"
                        type="button"
                        aria-label={copyFeedback === "copied" ? dict.investigation.copied : dict.investigation.copyId}
                        title={copyFeedback === "copied" ? dict.investigation.copied : dict.investigation.copyId}
                        onClick={() => void copyComplaintId()}
                      >
                        {copyFeedback === "copied" ? (
                          <svg viewBox="0 0 20 20" fill="none" role="presentation">
                            <path d="M4.5 10.2l3.2 3.2 7.8-7.8" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 20 20" fill="none" role="presentation">
                            <rect x="7" y="3.5" width="9.5" height="11.5" rx="2" stroke="currentColor" strokeWidth="1.7" />
                            <path d="M5.5 7H5a1.5 1.5 0 0 0-1.5 1.5V15A1.5 1.5 0 0 0 5 16.5h6.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="complaint-summary-info">
                    <span className="complaint-detail-label">{dict.investigation.complaintDate}</span>
                    <strong className="complaint-summary-info-value">{complaintDate}</strong>
                  </div>
                </div>
              </div>

              <div className="complaint-person-grid">
                <button
                  className="complaint-person-card"
                  type="button"
                  onClick={() => navigate(userPathFor(detail.complainantType, detail.complainantUserId))}
                >
                  <span className="complaint-person-label">{dict.investigation.complainant}</span>
                  <div className="complaint-person-body">
                    <span className={`complaint-person-avatar type-${detail.complainantType}`}>
                      {detail.complainantName.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="complaint-person-copy">
                      <strong>{detail.complainantName}</strong>
                      <span>{detail.complainantEmail ?? detail.complainantUserId}</span>
                    </div>
                  </div>
                </button>

                <button
                  className="complaint-person-card"
                  type="button"
                  onClick={() => navigate(userPathFor(detail.complainedAgainstType, detail.complainedAgainstUserId))}
                >
                  <span className="complaint-person-label">{dict.investigation.complainedAgainst}</span>
                  <div className="complaint-person-body">
                    <span className={`complaint-person-avatar type-${detail.complainedAgainstType}`}>
                      {detail.complainedAgainstName.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="complaint-person-copy">
                      <strong>{detail.complainedAgainstName}</strong>
                      <span>{detail.complainedAgainstEmail ?? detail.complainedAgainstUserId}</span>
                    </div>
                  </div>
                </button>
              </div>

              <div className="complaint-content-card complaint-description-card">
                <div className="panel-header complaint-description-header">
                  <h2>{dict.investigation.reasonDescription}</h2>
                  <div className="complaint-description-category">
                    <span className="complaint-detail-label">{dict.investigation.complaintCategory}</span>
                    <span className="complaint-tag">{categoryLabel}</span>
                  </div>
                </div>
                <p>{detail.description ?? "-"}</p>
              </div>

              <div className="complaint-content-card complaint-ticket-thread">
                <div className="complaint-notes-thread">
                  {notes.length === 0 ? (
                    <p className="complaint-empty-notes">{dict.investigation.emptyNotes}</p>
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

                {replyToNote ? (
                  <div className="complaint-note-replying">
                    <span>
                      {language === "tr" ? "Ek yapılacak not:" : "Adding to note:"} {replyToNote.createdByAdminEmail ?? replyToNote.createdByAdminId}
                    </span>
                    <button className="ghost" type="button" onClick={() => setReplyToNote(null)}>
                      {language === "tr" ? "Vazgeç" : "Cancel"}
                    </button>
                  </div>
                ) : null}

                <label className="complaint-field-block">
                  <span className="complaint-detail-label">
                    {replyToNote ? (language === "tr" ? "Ek not ekle" : "Add addendum") : dict.investigation.newNote}
                  </span>
                  <textarea
                    ref={noteInputRef}
                    className="complaint-note-input complaint-note-input--compact"
                    value={noteInput}
                    onChange={(event) => setNoteInput(event.target.value)}
                    rows={1}
                    placeholder={dict.investigation.notePlaceholder}
                  />
                </label>
                <div className="topbar-actions">
                  <button className="primary" type="button" disabled={savingNote} onClick={() => void saveNote()}>
                    {savingNote ? dict.common.loading : dict.investigation.addNote}
                  </button>
                </div>
              </div>

            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
