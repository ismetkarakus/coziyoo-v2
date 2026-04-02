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
  orderSummary?: {
    buyerName: string;
    sellerName: string;
    deliveryType: "pickup" | "delivery" | null;
    deliveryAddress: { city?: string; district?: string; line?: string } | null;
    items: Array<{ foodId: string; foodName: string | null; quantity: number }>;
  };
};

type ComplaintNote = {
  id: string;
  complaintId: string;
  note: string;
  createdByAdminId: string;
  createdByAdminEmail: string | null;
  createdAt: string;
};

function normalizeDeliveryType(value: unknown): "pickup" | "delivery" | "" {
  const normalized = String(value ?? "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (!normalized) return "";
  if (normalized.includes("pickup") || normalized.includes("gel al")) return "pickup";
  if (normalized.includes("delivery") || normalized.includes("teslimat")) return "delivery";
  const hasRestaurantToken = normalized.includes("restaurant") || normalized.includes("restoran") || normalized.includes("restorandan");
  if (hasRestaurantToken) {
    if (normalized.includes("teslim")) return "delivery";
    return "pickup";
  }
  return "";
}

export default function InvestigationComplaintDetailPage({ language, complaintId, onClose }: { language: Language; complaintId: string; onClose?: () => void }) {
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
  const descriptionText = detail?.description?.trim() || (language === "tr" ? "Açıklama girilmemiş" : "No description provided");
  const currentAdminLabel = currentAdmin?.email ?? dict.investigation.unassigned;
  const orderItemsText = (detail?.orderSummary?.items ?? [])
    .map((item) => `${item.foodName ?? (language === "tr" ? "Yemek" : "Food")} x${item.quantity}`)
    .join(", ");
  const orderAddress = detail?.orderSummary?.deliveryAddress as Record<string, unknown> | null | undefined;
  const orderAddressText = orderAddress
    ? [
      String(orderAddress.addressLine ?? "").trim(),
      String(orderAddress.line ?? "").trim(),
      String(orderAddress.neighborhood ?? "").trim(),
      String(orderAddress.district ?? "").trim(),
      String(orderAddress.city ?? "").trim(),
      String(orderAddress.title ?? "").trim(),
    ].filter(Boolean).join(", ")
    : null;
  const orderDeliveryType = normalizeDeliveryType(detail?.orderSummary?.deliveryType);

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
      const body = await parseJson<{ data?: { status: ComplaintStatus; priority: ComplaintDetail["priority"] } } & ApiError>(response);
      if (response.status !== 200 || !body.data) {
        setError(body.error?.message ?? dict.investigation.requestFailed);
        return;
      }
      setDetail((prev) => (prev ? { ...prev, status: body.data!.status, priority: body.data!.priority } : prev));
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

  const userPathFor = (type: "buyer" | "seller", userId: string) => (
    type === "buyer" ? `/app/buyers/${userId}` : `/app/sellers/${userId}`
  );

  const statusOptions = ["open", "in_review", "resolved", "closed"] as ComplaintStatus[];
  const priorityOptions = ["low", "medium", "high", "urgent"] as ComplaintDetail["priority"][];

  return (
    <div className="app investigation-page">
      <header className="topbar complaint-detail-topbar">
        <div className="back-nav complaint-detail-back-nav">
          <button className="ghost back-nav-btn" type="button" onClick={() => onClose ? onClose() : navigate("/app/investigation")}>← {dict.actions.prev}</button>
          <div className="complaint-detail-heading">
            <h1>{dict.investigation.detailTitle}</h1>
          </div>
        </div>
      </header>

      <section className="panel">
        {loading ? <p className="panel-meta">{dict.common.loading}</p> : null}
        {error ? <div className="alert">{error}</div> : null}

        {detail ? (
          <div className="complaint-compact-card">
            <div className="complaint-summary-ticket-row">
              <span className="complaint-ticket-no">#{detail.ticketNo}</span>
              <span className="complaint-ticket-date">{complaintDate}</span>
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

            <div className="complaint-choice-groups">
              <div className="complaint-choice-group">
                <span className="complaint-badge-label">{dict.investigation.complaintStatusLabel}</span>
                <div className="complaint-choice-list">
                  {statusOptions.map((status) => (
                    <button
                      key={status}
                      type="button"
                      className={`complaint-choice-chip status-${status} ${detail.status === status ? "is-active" : ""}`.trim()}
                      disabled={savingStatus || detail.status === status}
                      onClick={() => void updateStatus(status)}
                    >
                      {statusText(status)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="complaint-choice-group">
                <span className="complaint-badge-label">{dict.investigation.priorityLabel}</span>
                <div className="complaint-choice-list">
                  {priorityOptions.map((priority) => (
                    <button
                      key={priority}
                      type="button"
                      className={`complaint-choice-chip priority-${priority} ${detail.priority === priority ? "is-active" : ""}`.trim()}
                      disabled={savingPriority || detail.priority === priority}
                      onClick={() => void updatePriority(priority)}
                    >
                      {priorityText(priority)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="complaint-summary-divider" />

            <div className="complaint-people-inline">
              <button
                className="complaint-person-inline"
                type="button"
                onClick={() => navigate(userPathFor(detail.complainantType, detail.complainantUserId))}
              >
                <span className="complaint-detail-label">{dict.investigation.complainant}</span>
                <strong>{detail.complainantName}</strong>
                <span>{detail.complainantEmail ?? detail.complainantUserId}</span>
              </button>
              <button
                className="complaint-person-inline"
                type="button"
                onClick={() => navigate(userPathFor(detail.complainedAgainstType, detail.complainedAgainstUserId))}
              >
                <span className="complaint-detail-label">{dict.investigation.complainedAgainst}</span>
                <strong>{detail.complainedAgainstName}</strong>
                <span>{detail.complainedAgainstEmail ?? detail.complainedAgainstUserId}</span>
              </button>
            </div>

            <div className="complaint-summary-divider" />

            <div className="complaint-description-header">
              <div className="complaint-description-meta">
                <div className="complaint-description-row">
                  <span className="complaint-detail-label">{language === "tr" ? "Sipariş No" : "Order No"}</span>
                  <span className="complaint-description-value">{detail.orderNo}</span>
                </div>
                <div className="complaint-description-row">
                  <span className="complaint-detail-label">{language === "tr" ? "Alıcı" : "Buyer"}</span>
                  <span className="complaint-description-value">{detail.orderSummary?.buyerName ?? "-"}</span>
                </div>
                <div className="complaint-description-row">
                  <span className="complaint-detail-label">{language === "tr" ? "Satıcı" : "Seller"}</span>
                  <span className="complaint-description-value">{detail.orderSummary?.sellerName ?? "-"}</span>
                </div>
                <div className="complaint-description-row">
                  <span className="complaint-detail-label">{language === "tr" ? "Yemekler" : "Foods"}</span>
                  <span className="complaint-description-value">{orderItemsText || "-"}</span>
                </div>
                <div className="complaint-description-row">
                  <span className="complaint-detail-label">{language === "tr" ? "Teslimat" : "Delivery"}</span>
                  <span className="complaint-description-value">
                    {orderDeliveryType === "pickup"
                      ? "Gel Al"
                      : orderAddressText || (language === "tr" ? "Adres bilgisi yok" : "No address")}
                  </span>
                </div>
              </div>
            </div>

            <div className="complaint-summary-divider" />

            <div className="complaint-description-header">
              <div className="complaint-description-meta">
                <div className="complaint-description-row">
                  <span className="complaint-detail-label">{dict.investigation.complaintCategory}</span>
                  <span className="complaint-description-value">{categoryLabel}</span>
                </div>
              </div>
            </div>
            <span className="complaint-detail-label complaint-description-label">{dict.investigation.reasonDescription}</span>
            <p className="complaint-description-body">{descriptionText}</p>

            <div className="complaint-summary-divider" />

            <div className="complaint-notes-compact">
              <div className="complaint-notes-thread">
                {notes.length === 0 ? (
                  <p className="complaint-empty-notes">{dict.investigation.emptyNotes}</p>
                ) : (
                  notes.map((item) => {
                    const isOwn = (currentAdmin?.id && item.createdByAdminId === currentAdmin.id)
                      || (currentAdmin?.email && item.createdByAdminEmail === currentAdmin.email);
                    return (
                      <div key={item.id} className={`complaint-note-item ${isOwn ? "complaint-note-item--outgoing" : "complaint-note-item--incoming"}`}>
                        <div className="complaint-note-meta">
                          <span className="complaint-note-author">{item.createdByAdminEmail ?? item.createdByAdminId}</span>
                          <span className="complaint-note-date">
                            {new Date(item.createdAt).toLocaleString(language === "tr" ? "tr-TR" : "en-US")}
                          </span>
                        </div>
                        <p className="complaint-note-text">{item.note}</p>
                      </div>
                    );
                  })
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
        ) : null}
      </section>
    </div>
  );
}
