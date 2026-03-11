import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  const navigate = useNavigate();
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
          <h1>{language === "tr" ? "Şikayet Detay" : "Complaint Detail"}</h1>
          <p className="subtext">{language === "tr" ? "Şikayetin tüm detaylarını inceleyin." : "Inspect all complaint details."}</p>
        </div>
        <div className="topbar-actions">
          <button className="ghost" type="button" onClick={() => navigate("/app/investigation")}>{language === "tr" ? "Listeye Dön" : "Back to list"}</button>
        </div>
      </header>

      <section className="panel">
        {loading ? <p className="panel-meta">{dict.common.loading}</p> : null}
        {error ? <div className="alert">{error}</div> : null}

        {detail ? (
          <>
            <div className="form-grid">
              <label>
                {language === "tr" ? "Şikayet ID" : "Complaint ID"}
                <input value={detail.id} readOnly />
              </label>
              <label>
                {language === "tr" ? "Sipariş Numarası" : "Order No"}
                <input value={detail.orderNo} readOnly />
              </label>
              <label>
                {language === "tr" ? "Şikayetçi" : "Complainant"}
                <input value={`${detail.complainantBuyerName}${detail.complainantBuyerEmail ? ` (${detail.complainantBuyerEmail})` : ""}`} readOnly />
              </label>
              <label>
                {language === "tr" ? "Şikayet Edilen" : "Complained Against"}
                <input value={`${detail.sellerName}${detail.sellerEmail ? ` (${detail.sellerEmail})` : ""}`} readOnly />
              </label>
              <label>
                {language === "tr" ? "Şikayet Kategorisi" : "Complaint Category"}
                <input value={detail.categoryName ?? "-"} readOnly />
              </label>
              <label>
                {language === "tr" ? "Konu" : "Subject"}
                <input value={detail.subject} readOnly />
              </label>
              <label>
                {language === "tr" ? "Sebep / Açıklama" : "Reason / Description"}
                <textarea value={detail.description ?? "-"} readOnly rows={3} />
              </label>
              <label>
                {language === "tr" ? "Şikayet Tarihi" : "Complaint Date"}
                <input value={new Date(detail.createdAt).toLocaleString(language === "tr" ? "tr-TR" : "en-US")} readOnly />
              </label>
            </div>

            <div style={{ marginTop: 12 }}>
              <p className="panel-meta">{language === "tr" ? "Şikayet Durumu" : "Complaint Status"}</p>
              <div className="topbar-actions">
                {(["open", "in_review", "resolved", "closed"] as ComplaintStatus[]).map((status) => (
                  <button
                    key={status}
                    className={detail.status === status ? "primary" : "ghost"}
                    type="button"
                    disabled={savingStatus}
                    onClick={() => void updateStatus(status)}
                  >
                    {statusText(status)}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
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
