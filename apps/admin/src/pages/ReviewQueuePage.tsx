import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { request, parseJson } from "../lib/api";
import { DICTIONARIES } from "../lib/i18n";
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
  const dict = DICTIONARIES[language];
  if (status === "uploaded") return { label: dict.reviewQueue.uploadedStatus, cls: "is-pending" };
  if (status === "open") return { label: dict.reviewQueue.openStatus, cls: "is-pending" };
  if (status === "in_review") return { label: dict.reviewQueue.inReviewStatus, cls: "is-approved" };
  if (status === "opened") return { label: dict.reviewQueue.openedStatus, cls: "is-pending" };
  if (status === "under_review") return { label: dict.reviewQueue.inReviewStatus, cls: "is-approved" };
  if (status === "awaiting_payment") return { label: dict.reviewQueue.awaitingPaymentStatus, cls: "is-warning" };
  if (status === "preparing") return { label: dict.reviewQueue.preparingStatus, cls: "is-warning" };
  if (status === "ready") return { label: dict.reviewQueue.readyStatus, cls: "is-approved" };
  if (status === "in_delivery") return { label: dict.reviewQueue.inDeliveryStatus, cls: "is-approved" };
  if (status === "delivered") return { label: dict.reviewQueue.deliveredStatus, cls: "is-success" };
  if (status === "completed") return { label: dict.reviewQueue.completedStatus, cls: "is-success" };
  return { label: status, cls: "is-neutral" };
}

function priorityLabel(language: Language, priority: ComplaintQueueRow["priority"]): string {
  const dict = DICTIONARIES[language];
  if (priority === "low") return dict.reviewQueue.priorityLow;
  if (priority === "medium") return dict.reviewQueue.priorityMedium;
  if (priority === "high") return dict.reviewQueue.priorityHigh;
  return dict.reviewQueue.priorityUrgent;
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
  const dict = DICTIONARIES[language];
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
          setMessage(body.error?.message ?? dict.reviewQueue.loadFailed);
          return;
        }
        setData(body.data);
      } catch {
        setMessage(dict.reviewQueue.loadFailed);
      } finally {
        setLoading(false);
      }
    };

    void loadQueue();
  }, [dict.reviewQueue.loadFailed]);

  return (
    <div className="app review-queue-page">
      <header className="topbar">
        <div>
          <h1>{dict.reviewQueue.title}</h1>
          <p className="subtext">{dict.reviewQueue.subtitle}</p>
        </div>
        <div className="topbar-actions">
          <button className="ghost" type="button" onClick={() => window.location.reload()}>
            {dict.actions.refresh}
          </button>
        </div>
      </header>

      {message ? <div className="alert">{message}</div> : null}

      <section className="review-queue-summary-grid">
        <SummaryCard title={dict.reviewQueue.pendingComplianceDocs} value={data?.totals.compliance ?? 0} tone="warning" />
        <SummaryCard title={dict.reviewQueue.openComplaints} value={data?.totals.complaints ?? 0} tone="danger" />
        <SummaryCard title={dict.reviewQueue.paymentDisputes} value={data?.totals.disputes ?? 0} tone="approved" />
        <SummaryCard title={dict.reviewQueue.pendingPayments} value={data?.totals.payments ?? 0} tone="neutral" />
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>{dict.reviewQueue.pendingComplianceDocs}</h2>
          <span className="panel-meta">{data?.updatedAt ? formatDateTime(data.updatedAt) : "-"}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{dict.reviewQueue.seller}</th>
                <th>{dict.reviewQueue.document}</th>
                <th>{dict.reviewQueue.uploaded}</th>
                <th>{dict.reviewQueue.status}</th>
                <th>{dict.reviewQueue.action}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5}>{dict.common.loading}</td></tr>
              ) : (data?.compliance.length ?? 0) === 0 ? (
                <tr><td colSpan={5}>{dict.reviewQueue.noPendingComplianceDocs}</td></tr>
              ) : data?.compliance.map((row) => {
                const meta = statusMeta(language, row.status);
                return (
                  <tr key={row.id}>
                    <td>{row.sellerName}</td>
                    <td>{`${row.documentName} (${row.documentCode})`}</td>
                    <td>{formatDateTime(row.uploadedAt ?? row.createdAt)}</td>
                    <td><span className={`status-pill ${meta.cls}`}>{meta.label}</span></td>
                    <td><button className="ghost" type="button" onClick={() => navigate(`/app/sellers/${row.sellerId}`)}>{dict.reviewQueue.open}</button></td>
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
            <h2>{dict.reviewQueue.complaints}</h2>
            <span className="panel-meta">{data?.totals.complaints ?? 0}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{dict.reviewQueue.buyer}</th>
                  <th>{dict.reviewQueue.subject}</th>
                  <th>{dict.reviewQueue.priority}</th>
                  <th>{dict.reviewQueue.status}</th>
                  <th>{dict.reviewQueue.action}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5}>{dict.common.loading}</td></tr>
                ) : (data?.complaints.length ?? 0) === 0 ? (
                  <tr><td colSpan={5}>{dict.reviewQueue.noPendingComplaints}</td></tr>
                ) : data?.complaints.map((row) => {
                  const meta = statusMeta(language, row.status);
                  return (
                    <tr key={row.id}>
                      <td>{row.buyerName}</td>
                      <td>{row.subject}</td>
                      <td>{priorityLabel(language, row.priority)}</td>
                      <td><span className={`status-pill ${meta.cls}`}>{meta.label}</span></td>
                      <td><button className="ghost" type="button" onClick={() => navigate(`/app/investigation/${row.id}`)}>{dict.reviewQueue.detail}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>{dict.reviewQueue.paymentDisputes}</h2>
            <span className="panel-meta">{data?.totals.disputes ?? 0}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{dict.reviewQueue.order}</th>
                  <th>{dict.reviewQueue.buyerSeller}</th>
                  <th>{dict.reviewQueue.reason}</th>
                  <th>{dict.reviewQueue.status}</th>
                  <th>{dict.reviewQueue.action}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5}>{dict.common.loading}</td></tr>
                ) : (data?.disputes.length ?? 0) === 0 ? (
                  <tr><td colSpan={5}>{dict.reviewQueue.noOpenDisputes}</td></tr>
                ) : data?.disputes.map((row) => {
                  const meta = statusMeta(language, row.status);
                  return (
                    <tr key={row.id}>
                      <td>{row.orderId.slice(0, 8)}</td>
                      <td>{`${row.buyerName} / ${row.sellerName}`}</td>
                      <td>{row.reasonCode ?? "-"}</td>
                      <td><span className={`status-pill ${meta.cls}`}>{meta.label}</span></td>
                      <td><button className="ghost" type="button" onClick={() => navigate("/app/entities/paymentDisputeCases")}>{dict.reviewQueue.list}</button></td>
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
          <h2>{dict.reviewQueue.pendingPaymentOrders}</h2>
          <span className="panel-meta">{data?.totals.payments ?? 0}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{dict.reviewQueue.order}</th>
                <th>{dict.reviewQueue.buyer}</th>
                <th>{dict.reviewQueue.seller}</th>
                <th>{dict.reviewQueue.amount}</th>
                <th>{dict.reviewQueue.status}</th>
                <th>{dict.reviewQueue.action}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6}>{dict.common.loading}</td></tr>
              ) : (data?.payments.length ?? 0) === 0 ? (
                <tr><td colSpan={6}>{dict.reviewQueue.noPendingPaymentOrders}</td></tr>
              ) : data?.payments.map((row) => {
                const meta = statusMeta(language, row.status);
                return (
                  <tr key={row.id}>
                    <td>{row.id.slice(0, 8)}</td>
                    <td>{row.buyerName}</td>
                    <td>{row.sellerName}</td>
                    <td>{formatCurrency(row.totalAmount, language)}</td>
                    <td><span className={`status-pill ${meta.cls}`}>{meta.label}</span></td>
                    <td><button className="ghost" type="button" onClick={() => navigate("/app/orders")}>{dict.reviewQueue.list}</button></td>
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
