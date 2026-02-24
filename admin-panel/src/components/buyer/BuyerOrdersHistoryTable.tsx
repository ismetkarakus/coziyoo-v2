import type { BuyerOrderRow, BuyerPagination } from "../../types/buyer";

function paymentLabel(status: string) {
  const normalized = status.toLowerCase();
  if (normalized.includes("fail") || normalized.includes("cancel") || normalized.includes("declin")) {
    return { text: "Başarısız", cls: "is-failed" };
  }
  if (normalized.includes("pending") || normalized.includes("wait")) {
    return { text: "Bekliyor", cls: "is-pending" };
  }
  return { text: "Başarılı", cls: "is-success" };
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(value);
}

export function BuyerOrdersHistoryTable({
  orders,
  pagination,
  onPageChange,
}: {
  orders: BuyerOrderRow[];
  pagination: BuyerPagination | null;
  onPageChange: (nextPage: number) => void;
}) {
  return (
    <section className="panel buyer-orders-table">
      <div className="panel-header">
        <h2>Aldığı Yemekler ve Ödeme Geçmişi</h2>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tarih / Saat</th>
              <th>Sipariş No</th>
              <th>Yemekler</th>
              <th>Tutar</th>
              <th>Ödeme Durumu</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr>
                <td colSpan={6}>Sipariş kaydı bulunamadı.</td>
              </tr>
            ) : (
              orders.map((order) => {
                const badge = paymentLabel(order.paymentStatus);
                return (
                  <tr key={order.orderId}>
                    <td>{new Date(order.createdAt).toLocaleString("tr-TR")}</td>
                    <td className="buyer-order-no">{order.orderNo}</td>
                    <td>
                      <div className="buyer-food-list">
                        {order.items.slice(0, 2).map((item) => (
                          <article key={item.orderItemId} className="buyer-food-item">
                            <span className="buyer-food-image-wrap">
                              {item.imageUrl ? <img src={item.imageUrl} alt={item.name} /> : <span>🍽</span>}
                            </span>
                            <span>{item.name} x{item.quantity}</span>
                          </article>
                        ))}
                      </div>
                    </td>
                    <td>{formatPrice(order.totalAmount)}</td>
                    <td>
                      <span className={`buyer-payment-badge ${badge.cls}`}>{badge.text}</span>
                    </td>
                    <td className="buyer-row-arrow">›</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="buyer-pagination">
        <button
          className="ghost"
          type="button"
          onClick={() => onPageChange(Math.max(1, (pagination?.page ?? 1) - 1))}
          disabled={!pagination || pagination.page <= 1}
        >
          ÖNCEKİ
        </button>
        <span>{pagination?.page ?? 1}</span>
        <button
          className="ghost"
          type="button"
          onClick={() => onPageChange(Math.min(pagination?.totalPages ?? 1, (pagination?.page ?? 1) + 1))}
          disabled={!pagination || (pagination.page >= pagination.totalPages)}
        >
          SONRAKİ
        </button>
        <span className="panel-meta">
          {pagination ? `${pagination.page}/${pagination.totalPages}` : "1/1"}
        </span>
      </div>
    </section>
  );
}
