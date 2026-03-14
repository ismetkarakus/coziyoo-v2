import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { request, parseJson } from "../lib/api";
import { formatCurrency, formatDateTime } from "../lib/format";
import type { Language, ApiError } from "../types/core";

type QueueTotals = {
  compliance: number;
  complaints: number;
  disputes: number;
  payments: number;
};

type ComplianceQueueRow = {
  id: string;
  sellerId: string;
  sellerName: string;
  documentCode: string;
  documentName: string;
  status: string;
  createdAt: string;
  uploadedAt: string | null;
};

type ComplaintQueueRow = {
  id: string;
  orderId: string;
  buyerName: string;
  subject: string;
  priority: "low" | "medium" | "high" | "urgent";
  status: "open" | "in_review";
  createdAt: string;
};

type DisputeQueueRow = {
  id: string;
  orderId: string;
  buyerName: string;
  sellerName: string;
  reasonCode: string | null;
  status: "opened" | "under_review";
  createdAt: string;
};

type PaymentQueueRow = {
  id: string;
  buyerName: string;
  sellerName: string;
  totalAmount: number;
  status: string;
  createdAt: string;
};

type ReviewQueuePayload = {
  totals: QueueTotals;
  compliance: ComplianceQueueRow[];
  complaints: ComplaintQueueRow[];
  disputes: DisputeQueueRow[];
  payments: PaymentQueueRow[];
  updatedAt: string;
};

function statusMeta(language: Language, status: string): { label: string; cls: string } {
  if (status === "uploaded") return { label: language === "tr" ? "Yüklendi" : "Uploaded", cls: "is-pending" };
  if (status === "open") return { label: language === "tr" ? "Açık" : "Open", cls: "is-pending" };
  if (status === "in_review") return { label: language === "tr" ? "İnceleniyor" : "In Review", cls: "is-approved" };
  if (status === "opened") return { label: language === "tr" ? "Açıldı" : "Opened", cls: "is-pending" };
  if (status === "under_review") return { label: language === "tr" ? "İnceleniyor" : "In Review", cls: "is-approved" };
  if (status === "awaiting_payment") return { label: language === "tr" ? "Ödeme Bekliyor" : "Awaiting Payment", cls: "is-warning" };
  if (status === "preparing") return { label: language === "tr" ? "Hazırlanıyor" : "Preparing", cls: "is-warning" };
  if (status === "ready") return { label: language === "tr" ? "Hazır" : "Ready", cls: "is-approved" };
  if (status === "in_delivery") return { label: language === "tr" ? "Yolda" : "In Delivery", cls: "is-approved" };
  if (status === "delivered") return { label: language === "tr" ? "Teslim Edildi" : "Delivered", cls: "is-success" };
  if (status === "completed") return { label: language === "tr" ? "Tamamlandı" : "Completed", cls: "is-success" };
  return { label: status, cls: "is-neutral" };
}

function priorityLabel(language: Language, priority: ComplaintQueueRow["priority"]): string {
  if (language !== "tr") return priority;
  if (priority === "low") return "Düşük";
  if (priority === "medium") return "Orta";
  if (priority === "high") return "Yüksek";
  return "Acil";
}

function SummaryCard({ title, value, tone }: { title: string; value: number; tone: string }) {
  return (
    <article className={`panel review-queue-summary-card is-${tone}`}>
      <span className="panel-meta">{title}</span>
      <strong>{value}</strong>
    </article>
  );
}

export default function ReviewQueuePage({ language }: { language: Language }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [data, setData] = useState<ReviewQueuePayload | null>(null);

  useEffect(() => {
    const loadQueue = async () => {
      setLoading(true);
      setMessage(null);
      try {
        const response = await request("/v1/admin/dashboard/review-queue");
        const body = await parseJson<{ data?: ReviewQueuePayload } & ApiError>(response);
        if (response.status !== 200 || !body.data) {
          setMessage(body.error?.message ?? (language === "tr" ? "Bekleyen işler yüklenemedi." : "Review queue could not be loaded."));
          return;
        }
        setData(body.data);
      } catch {
        setMessage(language === "tr" ? "Bekleyen işler yüklenemedi." : "Review queue could not be loaded.");
      } finally {
        setLoading(false);
      }
    };

    void loadQueue();
  }, [language]);

  return (
    <div className="app review-queue-page">
      <header className="topbar">
        <div>
          <h1>{language === "tr" ? "Bekleyen İşler" : "Review Queue"}</h1>
          <p className="subtext">
            {language === "tr"
              ? "Uygunluk, ödeme, itiraz ve şikayet bekleyen kayıtlarını tek ekranda izleyin."
              : "Track pending compliance, payment, dispute, and complaint records in one place."}
          </p>
        </div>
        <div className="topbar-actions">
          <button className="ghost" type="button" onClick={() => window.location.reload()}>
            {language === "tr" ? "Yenile" : "Refresh"}
          </button>
        </div>
      </header>

      {message ? <div className="alert">{message}</div> : null}

      <section className="review-queue-summary-grid">
        <SummaryCard title={language === "tr" ? "Onay Bekleyen Belgeler" : "Pending Compliance Documents"} value={data?.totals.compliance ?? 0} tone="warning" />
        <SummaryCard title={language === "tr" ? "Açık Şikayet" : "Open Complaints"} value={data?.totals.complaints ?? 0} tone="danger" />
        <SummaryCard title={language === "tr" ? "Ödeme İtirazı" : "Payment Disputes"} value={data?.totals.disputes ?? 0} tone="approved" />
        <SummaryCard title={language === "tr" ? "Ödeme Bekleyen" : "Pending Payments"} value={data?.totals.payments ?? 0} tone="neutral" />
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>{language === "tr" ? "Onay Bekleyen Belgeler" : "Pending Compliance Documents"}</h2>
          <span className="panel-meta">{data?.updatedAt ? formatDateTime(data.updatedAt) : "-"}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{language === "tr" ? "Satıcı" : "Seller"}</th>
                <th>{language === "tr" ? "Doküman" : "Document"}</th>
                <th>{language === "tr" ? "Yüklenme" : "Uploaded"}</th>
                <th>{language === "tr" ? "Durum" : "Status"}</th>
                <th>{language === "tr" ? "Aksiyon" : "Action"}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5}>{language === "tr" ? "Yükleniyor..." : "Loading..."}</td></tr>
              ) : (data?.compliance.length ?? 0) === 0 ? (
                <tr><td colSpan={5}>{language === "tr" ? "Onay bekleyen belge yok." : "No pending compliance documents."}</td></tr>
              ) : data?.compliance.map((row) => {
                const meta = statusMeta(language, row.status);
                return (
                  <tr key={row.id}>
                    <td>{row.sellerName}</td>
                    <td>{`${row.documentName} (${row.documentCode})`}</td>
                    <td>{formatDateTime(row.uploadedAt ?? row.createdAt)}</td>
                    <td><span className={`status-pill ${meta.cls}`}>{meta.label}</span></td>
                    <td><button className="ghost" type="button" onClick={() => navigate(`/app/sellers/${row.sellerId}`)}>{language === "tr" ? "Aç" : "Open"}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="review-queue-grid">
        <section className="panel">
          <div className="panel-header">
            <h2>{language === "tr" ? "Şikayetler" : "Complaints"}</h2>
            <span className="panel-meta">{data?.totals.complaints ?? 0}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{language === "tr" ? "Alıcı" : "Buyer"}</th>
                  <th>{language === "tr" ? "Konu" : "Subject"}</th>
                  <th>{language === "tr" ? "Öncelik" : "Priority"}</th>
                  <th>{language === "tr" ? "Durum" : "Status"}</th>
                  <th>{language === "tr" ? "Aksiyon" : "Action"}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5}>{language === "tr" ? "Yükleniyor..." : "Loading..."}</td></tr>
                ) : (data?.complaints.length ?? 0) === 0 ? (
                  <tr><td colSpan={5}>{language === "tr" ? "Bekleyen şikayet yok." : "No pending complaints."}</td></tr>
                ) : data?.complaints.map((row) => {
                  const meta = statusMeta(language, row.status);
                  return (
                    <tr key={row.id}>
                      <td>{row.buyerName}</td>
                      <td>{row.subject}</td>
                      <td>{priorityLabel(language, row.priority)}</td>
                      <td><span className={`status-pill ${meta.cls}`}>{meta.label}</span></td>
                      <td><button className="ghost" type="button" onClick={() => navigate(`/app/investigation/${row.id}`)}>{language === "tr" ? "Detay" : "Detail"}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>{language === "tr" ? "Ödeme İtirazları" : "Payment Disputes"}</h2>
            <span className="panel-meta">{data?.totals.disputes ?? 0}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{language === "tr" ? "Sipariş" : "Order"}</th>
                  <th>{language === "tr" ? "Alıcı / Satıcı" : "Buyer / Seller"}</th>
                  <th>{language === "tr" ? "Neden" : "Reason"}</th>
                  <th>{language === "tr" ? "Durum" : "Status"}</th>
                  <th>{language === "tr" ? "Aksiyon" : "Action"}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5}>{language === "tr" ? "Yükleniyor..." : "Loading..."}</td></tr>
                ) : (data?.disputes.length ?? 0) === 0 ? (
                  <tr><td colSpan={5}>{language === "tr" ? "Açık itiraz yok." : "No open disputes."}</td></tr>
                ) : data?.disputes.map((row) => {
                  const meta = statusMeta(language, row.status);
                  return (
                    <tr key={row.id}>
                      <td>{row.orderId.slice(0, 8)}</td>
                      <td>{`${row.buyerName} / ${row.sellerName}`}</td>
                      <td>{row.reasonCode ?? "-"}</td>
                      <td><span className={`status-pill ${meta.cls}`}>{meta.label}</span></td>
                      <td><button className="ghost" type="button" onClick={() => navigate("/app/entities/paymentDisputeCases")}>{language === "tr" ? "Liste" : "List"}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>{language === "tr" ? "Ödeme Bekleyen Siparişler" : "Pending Payment Orders"}</h2>
          <span className="panel-meta">{data?.totals.payments ?? 0}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{language === "tr" ? "Sipariş" : "Order"}</th>
                <th>{language === "tr" ? "Alıcı" : "Buyer"}</th>
                <th>{language === "tr" ? "Satıcı" : "Seller"}</th>
                <th>{language === "tr" ? "Tutar" : "Amount"}</th>
                <th>{language === "tr" ? "Durum" : "Status"}</th>
                <th>{language === "tr" ? "Aksiyon" : "Action"}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6}>{language === "tr" ? "Yükleniyor..." : "Loading..."}</td></tr>
              ) : (data?.payments.length ?? 0) === 0 ? (
                <tr><td colSpan={6}>{language === "tr" ? "Ödeme bekleyen sipariş yok." : "No pending payment orders."}</td></tr>
              ) : data?.payments.map((row) => {
                const meta = statusMeta(language, row.status);
                return (
                  <tr key={row.id}>
                    <td>{row.id.slice(0, 8)}</td>
                    <td>{row.buyerName}</td>
                    <td>{row.sellerName}</td>
                    <td>{formatCurrency(row.totalAmount, language)}</td>
                    <td><span className={`status-pill ${meta.cls}`}>{meta.label}</span></td>
                    <td><button className="ghost" type="button" onClick={() => navigate("/app/orders")}>{language === "tr" ? "Liste" : "List"}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
