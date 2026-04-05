import { useEffect, useMemo, useState } from "react";
import { parseJson, request } from "../lib/api";
import { formatCurrency, formatTableDateTime, toDisplayId } from "../lib/format";
import { deliveryTypeLabel, orderStatusLabel, sellerDecisionStateLabel } from "../lib/status";
import type { Language, ApiError } from "../types/core";

type OrderFlowRow = {
  id: string;
  buyer_id?: string;
  seller_id?: string;
  status?: string;
  total_price?: number | string;
  requested_delivery_type?: string;
  active_delivery_type?: string;
  seller_decision_state?: string;
  seller_eta_minutes?: number | string | null;
  seller_promised_at?: string | null;
  payment_captured_at?: string | null;
  created_at?: string;
};

export default function OrderFlowAdminPage({ language }: { language: Language }) {
  const [rows, setRows] = useState<OrderFlowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams({
      page: "1",
      pageSize: "60",
      sortBy: "created_at",
      sortDir: "desc",
    });
    request(`/v1/admin/metadata/tables/orders/records?${query.toString()}`)
      .then(async (response) => {
        if (response.status !== 200) {
          const body = await parseJson<ApiError>(response);
          setError(body.error?.message ?? "Sipariş akışı yüklenemedi.");
          return;
        }
        const body = await parseJson<{ data?: { rows?: OrderFlowRow[] } }>(response);
        setRows(Array.isArray(body.data?.rows) ? body.data!.rows! : []);
      })
      .catch(() => setError("Sipariş akışı isteği başarısız."))
      .finally(() => setLoading(false));
  }, []);

  const summary = useMemo(() => {
    const next = {
      waitingApproval: 0,
      revised: 0,
      approved: 0,
      deliveryActive: 0,
      paymentCaptured: 0,
      volume: 0,
    };
    for (const row of rows) {
      const decision = String(row.seller_decision_state ?? "").toLowerCase();
      const activeDeliveryType = String(row.active_delivery_type ?? row.requested_delivery_type ?? "").toLowerCase();
      if (decision === "pending") next.waitingApproval += 1;
      if (decision === "revised") next.revised += 1;
      if (decision === "approved") next.approved += 1;
      if (activeDeliveryType === "delivery") next.deliveryActive += 1;
      if (row.payment_captured_at) next.paymentCaptured += 1;
      const total = Number(row.total_price ?? 0);
      next.volume += Number.isFinite(total) ? total : 0;
    }
    return next;
  }, [rows]);

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>{language === "tr" ? "Sipariş Akışı Yönetimi" : "Order Flow Ops"}</h1>
          <p className="subtext">
            {language === "tr"
              ? "Yeni seller-driven sipariş modelini izlemek ve yönetim ekranını kademeli kurmak için ilk taslak."
              : "Initial console for the new seller-driven order flow."}
          </p>
        </div>
      </header>

      <section className="panel order-flow-admin-page">
        <div className="order-flow-admin-grid">
          <article className="review-queue-summary-card is-warning">
            <span className="panel-meta">{language === "tr" ? "Karar Bekleyen" : "Waiting approval"}</span>
            <strong>{summary.waitingApproval}</strong>
          </article>
          <article className="review-queue-summary-card is-neutral">
            <span className="panel-meta">{language === "tr" ? "Plan Güncellenen" : "Plan revised"}</span>
            <strong>{summary.revised}</strong>
          </article>
          <article className="review-queue-summary-card is-success">
            <span className="panel-meta">{language === "tr" ? "Onaylanan" : "Approved"}</span>
            <strong>{summary.approved}</strong>
          </article>
          <article className="review-queue-summary-card is-neutral">
            <span className="panel-meta">{language === "tr" ? "Teslimatlı Plan" : "Delivery plan"}</span>
            <strong>{summary.deliveryActive}</strong>
          </article>
          <article className="review-queue-summary-card is-success">
            <span className="panel-meta">{language === "tr" ? "Ödeme Alınan" : "Payment captured"}</span>
            <strong>{summary.paymentCaptured}</strong>
          </article>
          <article className="review-queue-summary-card is-neutral">
            <span className="panel-meta">{language === "tr" ? "Son 60 Sipariş Hacmi" : "Recent GMV"}</span>
            <strong>{formatCurrency(summary.volume, language)}</strong>
          </article>
        </div>

        <div className="records-order-section">
          <h4>{language === "tr" ? "Yeni Akış Kuyruğu" : "New flow queue"}</h4>
          <p className="panel-meta">
            {language === "tr"
              ? "Bu ekran yeni sistem için ilk operasyon yüzeyi. Sonraki adımda karar detayları ve teslimat kodu istisnaları da buraya taşınabilir."
              : "Initial surface for the new flow. Next step can bring decision details and delivery PIN exceptions here."}
          </p>
          {error ? <div className="alert">{error}</div> : null}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{language === "tr" ? "Sipariş" : "Order"}</th>
                  <th>{language === "tr" ? "Alıcı / Satıcı" : "Buyer / Seller"}</th>
                  <th>{language === "tr" ? "Plan" : "Plan"}</th>
                  <th>{language === "tr" ? "Durum" : "Status"}</th>
                  <th>{language === "tr" ? "Ödeme" : "Payment"}</th>
                  <th>{language === "tr" ? "Tutar" : "Amount"}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6}>{language === "tr" ? "Yükleniyor..." : "Loading..."}</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={6}>{language === "tr" ? "Kayıt bulunamadı." : "No records found."}</td></tr>
                ) : rows.map((row) => {
                  const effectiveDeliveryType = row.active_delivery_type ?? row.requested_delivery_type;
                  return (
                    <tr key={row.id}>
                      <td>
                        <div className="buyer-login-cell">
                          <strong>{toDisplayId(row.id)}</strong>
                          <small>{row.created_at ? formatTableDateTime(row.created_at) : "-"}</small>
                        </div>
                      </td>
                      <td>
                        <div className="buyer-login-cell">
                          <strong>{row.buyer_id ? toDisplayId(row.buyer_id) : "-"}</strong>
                          <small>{row.seller_id ? toDisplayId(row.seller_id) : "-"}</small>
                        </div>
                      </td>
                      <td>
                        <div className="buyer-login-cell">
                          <strong>{deliveryTypeLabel(effectiveDeliveryType)}</strong>
                          <small>
                            {`${sellerDecisionStateLabel(row.seller_decision_state)}${row.seller_promised_at ? ` • ${formatTableDateTime(row.seller_promised_at)}` : ""}${row.seller_eta_minutes ? ` • ${row.seller_eta_minutes} dk` : ""}`}
                          </small>
                        </div>
                      </td>
                      <td>{orderStatusLabel(String(row.status ?? ""), effectiveDeliveryType)}</td>
                      <td>{row.payment_captured_at ? (language === "tr" ? "Ödeme Alındı" : "Captured") : (language === "tr" ? "Bekliyor" : "Pending")}</td>
                      <td>{formatCurrency(Number(row.total_price ?? 0), language)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
