import { type ReactNode, useEffect, useMemo, useState } from "react";
import { request, parseJson } from "../lib/api";
import { Pager } from "../components/ui";
import { DICTIONARIES } from "../lib/i18n";
import { fmt, toDisplayId, formatTableHeader, formatCurrency } from "../lib/format";
import { renderCell } from "../lib/table";
import type { Language, ApiError } from "../types/core";

export default function RecordsPage({ language, tableKey }: { language: Language; tableKey: "orders" | "foods" }) {
  const dict = DICTIONARIES[language];
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [userNameById, setUserNameById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<{ total: number; totalPages: number } | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Record<string, unknown> | null>(null);
  const [selectedOrderItems, setSelectedOrderItems] = useState<Record<string, unknown>[]>([]);
  const [selectedOrderItemsColumns, setSelectedOrderItemsColumns] = useState<string[]>([]);
  const [orderItemsLoading, setOrderItemsLoading] = useState(false);
  const pageSize = 20;

  const pageTitle = tableKey === "orders" ? dict.menu.orders : dict.menu.foods;
  const subtitle =
    language === "tr"
      ? tableKey === "orders"
        ? "Veritabanındaki sipariş kayıtlarını görüntüleyin."
        : "Veritabanındaki yemek kayıtlarını görüntüleyin."
      : tableKey === "orders"
        ? "Browse order records from the database."
        : "Browse food records from the database.";

  const orderColumns = useMemo(() => {
    if (tableKey !== "orders") return columns;
    const hiddenOrderColumns = new Set([
      "id",
      "updated_at",
      "requested_at",
      "estimated_delivery_time",
      "delivery_address_json",
    ]);
    const filtered = columns.filter((column) => !hiddenOrderColumns.has(column));
    const preferred = ["created_at", "buyer_id", "seller_id", "status", "payment_completed"];
    const used = new Set<string>();
    const ordered: string[] = [];
    for (const name of preferred) {
      if (filtered.includes(name)) {
        ordered.push(name);
        used.add(name);
      }
    }
    for (const name of filtered) {
      if (!used.has(name)) ordered.push(name);
    }
    return ordered;
  }, [columns, tableKey]);

  const orderColumnLabel = (column: string): string => {
    if (language === "tr") {
      const trLabels: Record<string, string> = {
        __display_id: "Görünen ID",
        id: "Sipariş ID",
        created_at: "Tarih",
        updated_at: "Güncelleme",
        requested_at: "Talep Tarihi",
        buyer_id: "Alıcı",
        seller_id: "Satıcı",
        status: "Durum",
        payment_completed: "Ödeme",
        delivery_type: "Teslimat Tipi",
        total_price: "Toplam Tutar",
        estimated_delivery_time: "Tahmini Teslimat",
        delivery_address_json: "Teslimat Adresi",
      };
      if (trLabels[column]) return trLabels[column];
    }
    if (column === "__display_id") return "Display ID";
    if (column === "created_at") return "Date";
    if (column === "buyer_id") return "Buyer";
    if (column === "seller_id") return "Seller";
    if (column === "payment_completed") return "Payment";
    return formatTableHeader(column);
  };

  const formatOrderCreatedAt = (value: unknown): string => {
    const iso = String(value ?? "");
    const timestamp = Date.parse(iso);
    if (Number.isNaN(timestamp)) return "-";
    const date = new Date(timestamp);
    const now = new Date();
    const isToday =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();
    if (isToday) {
      const diffMs = Math.max(0, now.getTime() - timestamp);
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return language === "tr" ? "az önce" : "just now";
      if (diffMin < 60) return language === "tr" ? `${diffMin} dk önce` : `${diffMin} min ago`;
      const diffHours = Math.floor(diffMin / 60);
      return language === "tr" ? `${diffHours} saat önce` : `${diffHours} hours ago`;
    }
    const pad2 = (num: number) => String(num).padStart(2, "0");
    return `${pad2(date.getDate())}-${pad2(date.getMonth() + 1)}-${date.getFullYear()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  };

  const orderStatusMeta = (rawStatus: unknown): { label: string; note: string; toneClass: string } => {
    const status = String(rawStatus ?? "").trim().toLowerCase();
    const isTr = language === "tr";
    const map: Record<string, { label: string; note: string; toneClass: string }> = {
      pending_seller_approval: {
        label: isTr ? "Onay bekliyor" : "Pending approval",
        note: isTr ? "Satıcı onayı bekleniyor" : "Waiting for seller approval",
        toneClass: "is-pending",
      },
      seller_approved: {
        label: isTr ? "Onaylandı" : "Approved",
        note: isTr ? "Satıcı tarafından onaylandı" : "Approved by seller",
        toneClass: "is-approved",
      },
      awaiting_payment: {
        label: isTr ? "Ödeme bekliyor" : "Awaiting payment",
        note: isTr ? "Ödeme adımı bekleniyor" : "Waiting for payment",
        toneClass: "is-pending",
      },
      paid: {
        label: isTr ? "Ödendi" : "Paid",
        note: isTr ? "Ödeme tamamlandı" : "Payment completed",
        toneClass: "is-paid",
      },
      preparing: {
        label: isTr ? "Hazırlanıyor" : "Preparing",
        note: isTr ? "Sipariş hazırlanıyor" : "Order is being prepared",
        toneClass: "is-pending",
      },
      ready: {
        label: isTr ? "Teslime hazır" : "Ready",
        note: isTr ? "Teslimata çıkmayı bekliyor" : "Waiting for delivery pickup",
        toneClass: "is-approved",
      },
      in_delivery: {
        label: isTr ? "Teslimatta" : "In delivery",
        note: isTr ? "Teslimat bekliyor" : "Out for delivery",
        toneClass: "is-delivery",
      },
      delivered: {
        label: isTr ? "Teslim edildi" : "Delivered",
        note: isTr ? "Teslimat tamamlandı" : "Delivery completed",
        toneClass: "is-done",
      },
      completed: {
        label: isTr ? "Tamamlandı" : "Completed",
        note: isTr ? "Sipariş kapanışı yapıldı" : "Order completed",
        toneClass: "is-done",
      },
    };
    return map[status] ?? {
      label: status ? status.replace(/_/g, " ") : dict.common.counterpartNotFound,
      note: isTr ? "Durum notu bulunamadı" : "Status note not found",
      toneClass: "is-pending",
    };
  };

  const renderRecordsCell = (column: string, value: unknown): ReactNode => {
    if (tableKey !== "orders") return renderCell(value, column);

    if (column === "__display_id") {
      return toDisplayId(value);
    }

    if (column === "created_at") {
      return formatOrderCreatedAt(value);
    }

    if (column === "buyer_id" || column === "seller_id") {
      const raw = String(value ?? "").trim();
      if (!raw) return "-";
      return userNameById[raw] ?? raw;
    }

    if (column === "status") {
      const meta = orderStatusMeta(value);
      return <span className={`status-pill order-status-pill ${meta.toneClass}`}>{meta.label}</span>;
    }

    if (column === "payment_completed") {
      const done = value === true || String(value).toLowerCase() === "true";
      return (
        <span className={`status-pill ${done ? "is-success" : "is-warning"}`}>
          {done ? (language === "tr" ? "Tamamlandı" : "Completed") : (language === "tr" ? "Bekliyor" : "Pending")}
        </span>
      );
    }

    if (column === "delivery_type") {
      const raw = String(value ?? "").trim().toLowerCase();
      if (language === "tr") {
        if (raw === "delivery") return "Adrese Teslim";
        if (raw === "pickup") return "Elden Teslim";
      } else {
        if (raw === "delivery") return "Home Delivery";
        if (raw === "pickup") return "Pickup";
      }
      return raw || "-";
    }

    if (column === "total_price") {
      const amount = Number(value ?? 0);
      if (Number.isFinite(amount)) return formatCurrency(amount, language);
    }

    return renderCell(value, column);
  };

  const orderCellText = (column: string, value: unknown): string => {
    if (column === "__display_id") return toDisplayId(value);
    if (column === "created_at" || column.endsWith("_at")) return formatOrderCreatedAt(value);
    if (column === "buyer_id" || column === "seller_id") {
      const raw = String(value ?? "").trim();
      if (!raw) return "-";
      return userNameById[raw] ?? raw;
    }
    if (column === "status") return orderStatusMeta(value).label;
    if (column === "payment_completed") {
      const done = value === true || String(value).toLowerCase() === "true";
      return done ? (language === "tr" ? "Tamamlandı" : "Completed") : language === "tr" ? "Bekliyor" : "Pending";
    }
    if (column === "delivery_type") {
      const raw = String(value ?? "").trim().toLowerCase();
      if (language === "tr") {
        if (raw === "delivery") return "Adrese Teslim";
        if (raw === "pickup") return "Elden Teslim";
      } else {
        if (raw === "delivery") return "Home Delivery";
        if (raw === "pickup") return "Pickup";
      }
      return raw || "-";
    }
    if (column === "total_price") {
      const amount = Number(value ?? 0);
      if (Number.isFinite(amount)) return formatCurrency(amount, language);
    }
    if (value === null || value === undefined || value === "") return "-";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };

  async function openOrderDetails(row: Record<string, unknown>) {
    const orderId = String(row.id ?? "").trim();
    if (!orderId) return;
    setSelectedOrder(row);
    setSelectedOrderItems([]);
    setSelectedOrderItemsColumns([]);
    setOrderItemsLoading(true);
    try {
      const query = new URLSearchParams({
        page: "1",
        pageSize: "100",
        sortDir: "desc",
        search: orderId,
      });
      const response = await request(`/v1/admin/metadata/tables/orderItems/records?${query.toString()}`);
      if (response.status !== 200) return;
      const body = await parseJson<{
        data: { rows: Array<Record<string, unknown>>; columns: string[] };
      }>(response);
      const rows = (body.data.rows ?? []).filter((item) => String(item.order_id ?? "") === orderId);
      setSelectedOrderItems(rows);
      setSelectedOrderItemsColumns(body.data.columns ?? []);
    } finally {
      setOrderItemsLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    setError(null);

    const query = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sortDir: "desc",
      ...(search ? { search } : {}),
    });

    request(`/v1/admin/metadata/tables/${tableKey}/records?${query.toString()}`)
      .then(async (response) => {
        if (response.status !== 200) {
          const body = await parseJson<ApiError>(response);
          setError(body.error?.message ?? dict.entities.loadRecordsFailed);
          setLoading(false);
          return;
        }

        const body = await parseJson<{
          data: {
            rows: Array<Record<string, unknown>>;
            columns: string[];
          };
          pagination: {
            total: number;
            totalPages: number;
          };
        }>(response);

        setRows(body.data.rows);
        setColumns(body.data.columns);
        setPagination({ total: body.pagination.total, totalPages: body.pagination.totalPages });
        setLoading(false);
      })
      .catch(() => {
        setError(dict.entities.recordsRequestFailed);
        setLoading(false);
      });
  }, [dict.entities.loadRecordsFailed, dict.entities.recordsRequestFailed, page, pageSize, search, tableKey]);

  useEffect(() => {
    if (tableKey !== "orders") return;
    const missingIds = Array.from(
      new Set(
        rows
          .flatMap((row) => [String(row.buyer_id ?? ""), String(row.seller_id ?? "")])
          .map((id) => id.trim())
          .filter((id) => id && !userNameById[id])
      )
    );
    if (missingIds.length === 0) return;
    let active = true;
    Promise.all(
      missingIds.map(async (id) => {
        try {
          const response = await request(`/v1/admin/users/${id}`);
          if (response.status !== 200) return [id, id] as const;
          const body = await parseJson<{ data?: { displayName?: string | null; email?: string | null } }>(response);
          return [id, body.data?.displayName || body.data?.email || id] as const;
        } catch {
          return [id, id] as const;
        }
      })
    ).then((pairs) => {
      if (!active) return;
      setUserNameById((prev) => {
        const next = { ...prev };
        for (const [id, label] of pairs) next[id] = label;
        return next;
      });
    });
    return () => {
      active = false;
    };
  }, [rows, tableKey, userNameById]);

  return (
    <div className="app">
      <header className="topbar topbar-with-centered-search">
        <div>
          <p className="eyebrow">{dict.entities.eyebrow}</p>
          <h1>{pageTitle}</h1>
          <p className="subtext">{subtitle}</p>
        </div>
        <div className="topbar-search-center">
          <div className="users-search-wrap users-search-wrap--compact">
            <span className="users-search-icon" aria-hidden="true">
              <svg className="users-search-icon-svg" viewBox="0 0 24 24" fill="none" role="presentation">
                <circle cx="11" cy="11" r="7.2" stroke="currentColor" strokeWidth="2" />
                <path d="M16.7 16.7L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>
            <input
              className="users-search-input users-search-input--compact"
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
            />
            {search.trim().length > 0 ? (
              <button
                className="users-search-clear"
                type="button"
                aria-label={language === "tr" ? "Aramayı temizle" : "Clear search"}
                onClick={() => {
                  setPage(1);
                  setSearch("");
                }}
              >
                ×
              </button>
            ) : null}
          </div>
        </div>
        <div className="topbar-actions">
        </div>
      </header>
      <section className="panel">
        {error ? <div className="alert">{error}</div> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {(tableKey === "orders" ? ["__display_id", ...orderColumns] : orderColumns).map((column) => (
                  <th key={column}>{tableKey === "orders" ? orderColumnLabel(column) : formatTableHeader(column)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={Math.max((tableKey === "orders" ? orderColumns.length + 1 : orderColumns.length), 1)}>{dict.common.loading}</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={Math.max((tableKey === "orders" ? orderColumns.length + 1 : orderColumns.length), 1)}>{dict.common.noRecords}</td>
                </tr>
              ) : (
                rows.map((row, index) => (
                  <tr
                    key={`${tableKey}-${index}`}
                    className={tableKey === "orders" ? "records-order-row" : undefined}
                    onClick={tableKey === "orders" ? () => void openOrderDetails(row) : undefined}
                  >
                    {(tableKey === "orders" ? ["__display_id", ...orderColumns] : orderColumns).map((column) => (
                      <td key={`${index}-${column}`}>
                        {renderRecordsCell(column, column === "__display_id" ? row.id : row[column])}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pager
          page={page}
          totalPages={pagination?.totalPages ?? 1}
          summary={fmt(dict.common.paginationSummary, { total: pagination?.total ?? 0, page, totalPages: Math.max(pagination?.totalPages ?? 1, 1) })}
          prevLabel={dict.actions.prev}
          nextLabel={dict.actions.next}
          onPrev={() => setPage((prev) => prev - 1)}
          onNext={() => setPage((prev) => prev + 1)}
        />
      </section>
      {selectedOrder ? (
        <div className="buyer-ops-modal-backdrop" onClick={() => setSelectedOrder(null)}>
          <div className="buyer-ops-modal records-order-modal" onClick={(event) => event.stopPropagation()}>
            <h3>{language === "tr" ? "Sipariş Detayı" : "Order Details"}</h3>
            <div className="records-order-grid">
              {Object.entries(selectedOrder).map(([key, value]) => (
                <div key={key}>
                  <span className="panel-meta">{orderColumnLabel(key)}</span>
                  <strong>{orderCellText(key, value)}</strong>
                </div>
              ))}
            </div>
            <div>
              <h4>{language === "tr" ? "Sipariş Kalemleri" : "Order Items"}</h4>
              {orderItemsLoading ? (
                <p className="panel-meta">{dict.common.loading}</p>
              ) : selectedOrderItems.length === 0 ? (
                <p className="panel-meta">{language === "tr" ? "Kalem bulunamadı." : "No items found."}</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {selectedOrderItemsColumns.map((column) => (
                          <th key={column}>{orderColumnLabel(column)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {selectedOrderItems.map((row, index) => (
                        <tr key={`order-item-${index}`}>
                          {selectedOrderItemsColumns.map((column) => (
                            <td key={`${index}-${column}`}>{orderCellText(column, row[column])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="buyer-ops-modal-actions">
              <button className="primary" type="button" onClick={() => setSelectedOrder(null)}>
                {language === "tr" ? "Kapat" : "Close"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
