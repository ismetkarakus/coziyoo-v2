import type { BuyerOrderRow, BuyerSummaryMetrics } from "../../types/buyer";

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

function trendMeta(current: number, previous: number) {
  if (current > previous) return { arrow: "▲", className: "is-up" as const };
  if (current < previous) return { arrow: "▼", className: "is-down" as const };
  return { arrow: "→", className: "is-flat" as const };
}

export function BuyerSummaryMetricsCard({
  orders,
  summary,
  missingText = "karşılık bulunamadı",
}: {
  orders: BuyerOrderRow[];
  summary: BuyerSummaryMetrics | null;
  missingText?: string;
}) {
  const latest = orders[0] ?? null;
  const latestOrderNo = latest?.orderNo ?? missingText;
  const latestAt = latest ? toRelativeDays(latest.createdAt, missingText) : missingText;
  const orderTrend = trendMeta(summary?.monthlyOrderCountCurrent ?? 0, summary?.monthlyOrderCountPrevious ?? 0);
  const spentTrend = trendMeta(summary?.monthlySpentCurrent ?? 0, summary?.monthlySpentPrevious ?? 0);

  return (
    <section className="panel buyer-summary-card">
      <div className="panel-header">
        <h2>Alıcı Özet Metrikleri</h2>
      </div>
      <div className="buyer-summary-grid">
        <article>
          <p>Toplam Şikayet</p>
          <h3>{summary ? summary.complaintTotal : missingText}</h3>
          <small>{`Çözülen: ${summary?.complaintResolved ?? 0} • Çözülmeyen: ${summary?.complaintUnresolved ?? 0}`}</small>
        </article>
        <article>
          <p>Toplam Harcama</p>
          <h3>{summary ? formatCurrency(summary.totalSpent) : missingText}</h3>
          <small className={`buyer-trend ${spentTrend.className}`}>
            {`${spentTrend.arrow} Son 30g: ${formatCurrency(summary?.monthlySpentCurrent ?? 0)} • Önceki 30g: ${formatCurrency(summary?.monthlySpentPrevious ?? 0)}`}
          </small>
        </article>
        <article>
          <p>Sipariş Sayısı</p>
          <h3>{summary ? summary.totalOrders : missingText}</h3>
          <small className={`buyer-trend ${orderTrend.className}`}>
            {`${orderTrend.arrow} Son 30g: ${summary?.monthlyOrderCountCurrent ?? 0} • Önceki 30g: ${summary?.monthlyOrderCountPrevious ?? 0}`}
          </small>
        </article>
        <article>
          <p>Son Sipariş No</p>
          <h3>{latestOrderNo}</h3>
          <small>{latestAt}</small>
        </article>
      </div>
    </section>
  );
}
