import { Pager } from "../ui";
import { formatCurrency, formatTableDateTime } from "../../lib/format";
import { paymentBadge } from "../../lib/status";
import type { BuyerOrderRow, BuyerPagination } from "../../types/buyer";

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
                const badge = paymentBadge(order.paymentStatus);
                return (
                  <tr key={order.orderId}>
                    <td>{formatTableDateTime(order.createdAt)}</td>
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
                    <td>{formatCurrency(order.totalAmount, "tr")}</td>
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
      <Pager
        page={pagination?.page ?? 1}
        totalPages={pagination?.totalPages ?? 1}
        summary={pagination ? `Toplam: ${pagination.total} | Sayfa ${pagination.page} / ${pagination.totalPages}` : "Toplam: 0 | Sayfa 1 / 1"}
        prevLabel="ÖNCEKİ"
        nextLabel="SONRAKİ"
        onPageChange={onPageChange}
        onPrev={() => onPageChange(Math.max(1, (pagination?.page ?? 1) - 1))}
        onNext={() => onPageChange(Math.min(pagination?.totalPages ?? 1, (pagination?.page ?? 1) + 1))}
      />
    </section>
  );
}
