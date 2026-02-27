import type { BuyerOrderRow } from "../../types/buyer";

function toRelativeDays(iso: string | null, missingText: string): string {
  if (!iso) return missingText;
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
  if (days === 0) return "Bugün";
  if (days === 1) return "1 gün önce";
  return `${days} gün önce`;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(value);
}

export function BuyerSummaryMetricsCard({ orders, missingText = "karşılık bulunamadı" }: { orders: BuyerOrderRow[]; missingText?: string }) {
  const latest = orders[0] ?? null;
  const totalSpent = orders.reduce((sum, row) => sum + row.totalAmount, 0);
  const latestOrderNo = latest?.orderNo ?? missingText;
  const latestAt = latest ? toRelativeDays(latest.createdAt, missingText) : missingText;

  return (
    <section className="panel buyer-summary-card">
      <div className="panel-header">
        <h2>İletişim Bilgisi & Adres</h2>
      </div>
      <div className="buyer-summary-grid">
        <article>
          <p>Tarih / Saat</p>
          <h3>{latest ? new Date(latest.createdAt).toLocaleString("tr-TR") : missingText}</h3>
        </article>
        <article>
          <p>Sipariş No</p>
          <h3>{latestOrderNo}</h3>
        </article>
        <article>
          <p>Son Sipariş</p>
          <h3>{latestAt}</h3>
          <small>{formatCurrency(totalSpent)}</small>
        </article>
      </div>
    </section>
  );
}
