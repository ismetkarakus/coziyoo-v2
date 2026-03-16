import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { request, parseJson } from "../lib/api";
import { Pager, ExcelExportButton, PrintButton, SortableHeader } from "../components/ui";
import { DICTIONARIES } from "../lib/i18n";
import { fmt, toDisplayId, formatTableHeader, formatCurrency } from "../lib/format";
import { printModalContent } from "../lib/print";
import { renderCell } from "../lib/table";
import type { Language, ApiError } from "../types/core";

export default function RecordsPage({ language, tableKey }: { language: Language; tableKey: "orders" | "foods" }) {
  const location = useLocation();
  const navigate = useNavigate();
  const dict = DICTIONARIES[language];
  const urlSearchQuery = tableKey === "orders" ? (new URLSearchParams(location.search).get("search") ?? "").trim() : "";
  const returnTo = tableKey === "orders" ? (new URLSearchParams(location.search).get("returnTo") ?? "").trim() : "";
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [userNameById, setUserNameById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(urlSearchQuery);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<{ total: number; totalPages: number } | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Record<string, unknown> | null>(null);
  const [selectedOrderItems, setSelectedOrderItems] = useState<Record<string, unknown>[]>([]);
  const [selectedOrderItemsColumns, setSelectedOrderItemsColumns] = useState<string[]>([]);
  const [foodNameById, setFoodNameById] = useState<Record<string, string>>({});
  const [orderItemsLoading, setOrderItemsLoading] = useState(false);
  const [copyFeedbackKey, setCopyFeedbackKey] = useState<"" | "order-id" | "uuid">("");
  const [selectedOrderMap, setSelectedOrderMap] = useState<Record<string, Record<string, unknown>>>({});
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const orderModalPrintRef = useRef<HTMLDivElement | null>(null);
  const pageSize = 20;

  const pageTitle = tableKey === "orders" ? dict.menu.orders : dict.menu.foods;
  const subtitle =
    tableKey === "orders" ? dict.records.subtitleOrders : dict.records.subtitleFoods;

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
  const selectedOrders = useMemo(() => Object.values(selectedOrderMap), [selectedOrderMap]);
  const displayColumns = useMemo(
    () => (tableKey === "orders" ? ["__display_id", ...orderColumns] : orderColumns),
    [orderColumns, tableKey]
  );
  const apiSortKeyFor = (column: string) => (column === "__display_id" ? "id" : column);
  const sortDirectionFor = (column: string): "asc" | "desc" => (sortBy === apiSortKeyFor(column) ? sortDir : "desc");
  const isSortActive = (column: string) => sortBy === apiSortKeyFor(column);
  const toggleServerSort = (column: string) => {
    const nextSortBy = apiSortKeyFor(column);
    setPage(1);
    setSortBy(nextSortBy);
    setSortDir((prev) => (sortBy === nextSortBy ? (prev === "desc" ? "asc" : "desc") : "desc"));
  };
  const allRowsSelected =
    tableKey === "orders" &&
    rows.length > 0 &&
    rows.every((row) => {
      const id = String(row.id ?? "").trim();
      return id.length > 0 && Boolean(selectedOrderMap[id]);
    });

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
        lot_id: "Lot ID",
        food_id: "Yemek ID",
        food_name: "Yemek Adı",
        quantity: "Adet",
        unit_price: "Birim Fiyat",
        line_total: "Satır Toplamı",
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

  const orderColumnLabelTr = (column: string): string => {
    const trLabels: Record<string, string> = {
      __display_id: "Görünen ID",
      id: "Sipariş ID",
      created_at: "Tarih",
      updated_at: "Güncelleme",
      requested_at: "Talep Tarihi",
      buyer_id: "Alıcı",
      seller_id: "Satıcı",
      status: "Durum",
      payment_completed: "Ödeme Durumu",
      delivery_type: "Teslimat Tipi",
      total_price: "Toplam Tutar",
      estimated_delivery_time: "Tahmini Teslimat",
      delivery_address_json: "Teslimat Adresi",
      order_id: "Sipariş ID",
      lot_id: "Lot ID",
      food_id: "Yemek ID",
      food_name: "Yemek Adı",
      quantity: "Adet",
      unit_price: "Birim Fiyat",
      line_total: "Satır Toplamı",
    };
    return trLabels[column] ?? formatTableHeader(column);
  };

  const orderItemColumnLabelTr = (column: string): string => {
    const trLabels: Record<string, string> = {
      food_id: "Yemek ID",
      food_name: "Yemek Adı",
      quantity: "Adet",
      unit_price: "Birim Fiyat",
      line_total: "Satır Toplamı",
      created_at: "Tarih",
      updated_at: "Güncelleme",
      lot_id: "Lot ID",
    };
    return trLabels[column] ?? orderColumnLabelTr(column);
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
      if (diffMin < 1) return dict.records.justNow;
      if (diffMin < 60) return `${diffMin} ${dict.records.minAgo}`;
      const diffHours = Math.floor(diffMin / 60);
      return `${diffHours} ${dict.records.hourAgo}`;
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
      cancelled: {
        label: isTr ? "İptal" : "Cancelled",
        note: isTr ? "Sipariş iptal edildi" : "Order cancelled",
        toneClass: "is-disabled",
      },
    };
    return map[status] ?? {
      label: status ? status.replace(/_/g, " ") : dict.common.counterpartNotFound,
      note: dict.records.statusNoteNotFound,
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
          {done ? dict.common.completed : dict.common.pending}
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

    if (column === "total_price" || column === "unit_price" || column === "line_total") {
      const amount = Number(value ?? 0);
      if (Number.isFinite(amount)) return formatCurrency(amount, language);
    }
    if (column === "food_name") {
      const id = String(value ?? "").trim();
      if (!id) return "-";
      return foodNameById[id] ?? toDisplayId(id);
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
      return done ? dict.common.completed : dict.common.pending;
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
    if (column === "total_price" || column === "unit_price" || column === "line_total") {
      const amount = Number(value ?? 0);
      if (Number.isFinite(amount)) return formatCurrency(amount, language);
    }
    if (column === "food_name") {
      const id = String(value ?? "").trim();
      if (!id) return "-";
      return foodNameById[id] ?? toDisplayId(id);
    }
    if (value === null || value === undefined || value === "") return "-";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };

  const formatDeliveryAddress = (value: unknown): string => {
    if (!value) return "-";
    const normalize = (input: unknown) => {
      if (!input || typeof input !== "object") return null;
      const row = input as Record<string, unknown>;
      const line = String(row.line ?? row.addressLine ?? "").trim();
      const district = String(row.district ?? "").trim();
      const city = String(row.city ?? "").trim();
      const postalCode = String(row.postalCode ?? row.postal_code ?? "").trim();
      const left = [line, district].filter(Boolean).join(", ");
      const right = [city, postalCode].filter(Boolean).join(", ");
      return [left, right].filter(Boolean).join(" / ").trim();
    };
    if (typeof value === "object") {
      return normalize(value) || "-";
    }
    const text = String(value).trim();
    if (!text) return "-";
    if (text.startsWith("{")) {
      try {
        const parsed = JSON.parse(text) as unknown;
        return normalize(parsed) || text;
      } catch {
        return text;
      }
    }
    return text;
  };

  const shortUuid = (value: unknown): string => {
    const text = String(value ?? "").trim();
    if (!text) return "-";
    if (text.length <= 18) return text;
    return `${text.slice(0, 8)}...${text.slice(-6)}`;
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
      setSelectedOrderItems(body.data.rows ?? []);
      setSelectedOrderItemsColumns(body.data.columns ?? []);
    } finally {
      setOrderItemsLoading(false);
    }
  }

  function toggleOrderSelection(row: Record<string, unknown>, checked: boolean) {
    const id = String(row.id ?? "").trim();
    if (!id) return;
    setSelectedOrderMap((prev) => {
      if (checked) return { ...prev, [id]: row };
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function toggleAllVisibleOrders(checked: boolean) {
    if (tableKey !== "orders") return;
    setSelectedOrderMap((prev) => {
      const next = { ...prev };
      for (const row of rows) {
        const id = String(row.id ?? "").trim();
        if (!id) continue;
        if (checked) next[id] = row;
        else delete next[id];
      }
      return next;
    });
  }

  function downloadSelectedOrdersAsExcel() {
    if (selectedOrders.length === 0) {
      setError(dict.records.atLeastOneOrder);
      return;
    }
    const exportColumns = ["__display_id", ...orderColumns];
    const headers = exportColumns.map((column) => orderColumnLabel(column));
    const rowsForExport = selectedOrders.map((row) =>
      exportColumns.map((column) => orderCellText(column, column === "__display_id" ? row.id : row[column]))
    );
    const escapeCsv = (value: string) => `"${value.replace(/"/g, "\"\"")}"`;
    const csv = [headers, ...rowsForExport].map((line) => line.map((cell) => escapeCsv(String(cell))).join(",")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `orders-selected-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadOpenOrderDetailAsExcel() {
    if (!selectedOrder) return;
    const baseFields = [
      "__display_id",
      "buyer_id",
      "seller_id",
      "status",
      "delivery_type",
      "payment_completed",
      "total_price",
      "created_at",
      "requested_at",
      "delivery_address_json",
    ] as const;
    const baseHeader = baseFields.map((key) => orderColumnLabel(key));
    const baseRow = baseFields.map((key) => orderCellText(key, key === "__display_id" ? selectedOrder.id : selectedOrder[key]));

    const itemColumnsForExport = selectedOrderItemsColumns.includes("food_id")
      ? [...selectedOrderItemsColumns, "food_name"]
      : selectedOrderItemsColumns;
    const itemHeaders = itemColumnsForExport.map((column) => orderColumnLabel(column));
    const itemRows = selectedOrderItems.map((item) =>
      itemColumnsForExport.map((column) => orderCellText(column, column === "food_name" ? item.food_id : item[column]))
    );

    const escapeCsv = (value: string) => `"${value.replace(/"/g, "\"\"")}"`;
    const lines: string[] = [];
    lines.push(baseHeader.map(escapeCsv).join(","));
    lines.push(baseRow.map(escapeCsv).join(","));
    lines.push("");
    lines.push(dict.records.orderItemsTitle);
    if (itemHeaders.length > 0) {
      lines.push(itemHeaders.map(escapeCsv).join(","));
      for (const row of itemRows) lines.push(row.map((cell) => escapeCsv(String(cell))).join(","));
    }

    const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `order-detail-${String(selectedOrder.id ?? "export").slice(0, 12)}-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function printOpenOrderDetail() {
    if (!selectedOrder) return;
    printModalContent(orderModalPrintRef.current);
  }

  function copyWithFeedback(text: string, key: "order-id" | "uuid") {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopyFeedbackKey(key);
        window.setTimeout(() => setCopyFeedbackKey((prev) => (prev === key ? "" : prev)), 1100);
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    if (tableKey !== "orders") return;
    setSearch(urlSearchQuery);
    setPage(1);
  }, [tableKey, urlSearchQuery]);

  useEffect(() => {
    setSortBy(null);
    setSortDir("desc");
  }, [tableKey]);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const query = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      ...(sortBy ? { sortBy, sortDir } : {}),
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
  }, [dict.entities.loadRecordsFailed, dict.entities.recordsRequestFailed, page, pageSize, search, sortBy, sortDir, tableKey]);

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

  useEffect(() => {
    if (selectedOrderItems.length === 0) return;
    const missingFoodIds = Array.from(
      new Set(
        selectedOrderItems
          .map((row) => String(row.food_id ?? "").trim())
          .filter((id) => id.length > 0 && !foodNameById[id])
      )
    );
    if (missingFoodIds.length === 0) return;
    let active = true;
    Promise.all(
      missingFoodIds.map(async (id) => {
        try {
          const response = await request(`/v1/admin/metadata/tables/foods/records?page=1&pageSize=1&search=${encodeURIComponent(id)}`);
          if (response.status !== 200) return [id, toDisplayId(id)] as const;
          const body = await parseJson<{ data?: { rows?: Array<Record<string, unknown>> } }>(response);
          const match = (body.data?.rows ?? []).find((row) => String(row.id ?? "") === id);
          const name = String(match?.name ?? "").trim();
          return [id, name || toDisplayId(id)] as const;
        } catch {
          return [id, toDisplayId(id)] as const;
        }
      })
    ).then((pairs) => {
      if (!active) return;
      setFoodNameById((prev) => {
        const next = { ...prev };
        for (const [id, label] of pairs) next[id] = label;
        return next;
      });
    });
    return () => {
      active = false;
    };
  }, [selectedOrderItems, foodNameById]);

  const selectedOrderId = String(selectedOrder?.id ?? "").trim();
  const selectedStatusMeta = orderStatusMeta(selectedOrder?.status);
  const selectedStatusRaw = String(selectedOrder?.status ?? "").trim().toLowerCase();
  const selectedCancelReason = (() => {
    if (selectedStatusRaw !== "cancelled") return "";
    const candidates = [
      selectedOrder?.cancel_reason,
      selectedOrder?.cancellation_reason,
      selectedOrder?.cancelReason,
      selectedOrder?.cancellationReason,
      selectedOrder?.status_reason,
      selectedOrder?.statusReason,
      selectedOrder?.reason,
      selectedOrder?.cancel_note,
      selectedOrder?.cancelNote,
      selectedOrder?.notes,
      selectedOrder?.note,
    ];
    for (const value of candidates) {
      const text = String(value ?? "").trim();
      if (text) return text;
    }
    return dict.records.cancelReasonNotFound;
  })();
  const selectedBuyerText = orderCellText("buyer_id", selectedOrder?.buyer_id);
  const selectedSellerText = orderCellText("seller_id", selectedOrder?.seller_id);
  const selectedDeliveryAddress = formatDeliveryAddress(selectedOrder?.delivery_address_json);
  const selectedDeliveryType = (() => {
    const raw = String(selectedOrder?.delivery_type ?? "").trim().toLowerCase();
    if (!raw) return "-";
    if (raw.includes("pickup")) return dict.records.deliveryTypePickupRestaurant;
    if (raw.includes("delivery")) return dict.records.deliveryTypeHome;
    if (raw.includes("courier")) return dict.records.deliveryTypeCourier;
    return raw;
  })();
  const selectedCreatedAt = (() => {
    const raw = String(selectedOrder?.created_at ?? "").trim();
    if (!raw) return "-";
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? raw : new Date(parsed).toLocaleString(language === "tr" ? "tr-TR" : "en-US");
  })();
  const selectedRequestedAt = (() => {
    const raw = String(selectedOrder?.requested_at ?? "").trim();
    if (!raw) return "-";
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? raw : new Date(parsed).toLocaleString(language === "tr" ? "tr-TR" : "en-US");
  })();
  const selectedPaymentStatus = (() => {
    const raw = selectedOrder?.payment_completed;
    if (typeof raw === "boolean") return raw ? "Ödendi" : "Bekliyor";
    const text = String(raw ?? "").trim().toLowerCase();
    if (!text) return "-";
    if (["true", "1", "paid", "success", "completed", "odendi"].some((key) => text.includes(key))) return "Ödendi";
    if (["false", "0", "pending", "bekliyor", "await"].some((key) => text.includes(key))) return "Bekliyor";
    return text;
  })();
  const selectedTotal = (() => {
    const raw = selectedOrder?.total_price;
    const number = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(number)) return formatCurrency(number, "tr");
    return String(raw ?? "-");
  })();
  const selectedOrderItemsColumnsWithFoodName = (() => {
    const baseColumns = selectedOrderItemsColumns.filter((column) => column !== "created_at");
    if (!baseColumns.includes("food_id")) return baseColumns;
    const withoutFoodName = baseColumns.filter((column) => column !== "food_name");
    const foodIdIndex = withoutFoodName.indexOf("food_id");
    if (foodIdIndex < 0) return withoutFoodName;
    return [...withoutFoodName.slice(0, foodIdIndex + 1), "food_name", ...withoutFoodName.slice(foodIdIndex + 1)];
  })();

  return (
    <div className="app">
      <header className="topbar topbar-with-centered-search">
        <div>
          {returnTo ? (
            <button
              type="button"
              className="ghost back-nav-btn"
              onClick={() => navigate(returnTo)}
              style={{ marginBottom: 8 }}
            >
              ← {language === "tr" ? "Geri" : "Back"}
            </button>
          ) : null}
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
                aria-label={dict.common.clearSearch}
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
          {tableKey === "orders" ? (
            <ExcelExportButton className="primary" type="button" onClick={downloadSelectedOrdersAsExcel} language={language}>
              {fmt(dict.records.exportSelectedWithCount, { count: selectedOrders.length })}
            </ExcelExportButton>
          ) : null}
        </div>
      </header>
      <section className="panel">
        {error ? <div className="alert">{error}</div> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {tableKey === "orders" ? (
                  <th>
                    <input
                      type="checkbox"
                      checked={allRowsSelected}
                      aria-label={dict.records.selectAllOrders}
                      onChange={(event) => toggleAllVisibleOrders(event.target.checked)}
                    />
                  </th>
                ) : null}
                {displayColumns.map((column) => (
                  <th key={column}>
                    <SortableHeader
                      label={tableKey === "orders" ? orderColumnLabel(column) : formatTableHeader(column)}
                      active={isSortActive(column)}
                      dir={sortDirectionFor(column)}
                      onClick={() => toggleServerSort(column)}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={Math.max((tableKey === "orders" ? orderColumns.length + 2 : orderColumns.length), 1)}>{dict.common.loading}</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={Math.max((tableKey === "orders" ? orderColumns.length + 2 : orderColumns.length), 1)}>{dict.common.noRecords}</td>
                </tr>
              ) : (
                rows.map((row, index) => (
                  <tr
                    key={`${tableKey}-${index}`}
                    className={tableKey === "orders" ? "records-order-row" : undefined}
                    onClick={tableKey === "orders" ? () => void openOrderDetails(row) : undefined}
                  >
                    {tableKey === "orders" ? (
                      <td>
                        <input
                          type="checkbox"
                          checked={Boolean(selectedOrderMap[String(row.id ?? "").trim()])}
                          aria-label={dict.records.selectOrder}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => toggleOrderSelection(row, event.target.checked)}
                        />
                      </td>
                    ) : null}
                    {displayColumns.map((column) => (
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
          onPageChange={setPage}
          onPrev={() => setPage((prev) => prev - 1)}
          onNext={() => setPage((prev) => prev + 1)}
        />
      </section>
      {selectedOrder ? (
        <div className="buyer-ops-modal-backdrop" onClick={() => setSelectedOrder(null)}>
          <div ref={orderModalPrintRef} className="buyer-ops-modal records-order-modal print-target-modal" onClick={(event) => event.stopPropagation()}>
            <section className="records-order-section">
              <header className="records-order-head">
                <div className="records-order-title-wrap">
                  <h3>{`${dict.records.activeOrderDetail}: #${toDisplayId(selectedOrderId)}`}</h3>
                  <button
                    className={`ghost records-copy-btn ${copyFeedbackKey === "order-id" ? "is-copied" : ""}`}
                    type="button"
                    onClick={() => copyWithFeedback(selectedOrderId, "order-id")}
                    title={dict.records.copyOrderId}
                  >
                    {copyFeedbackKey === "order-id" ? "✓" : "⧉"}
                  </button>
                </div>
                <div className="records-order-status-wrap">
                  <span>{dict.records.status}</span>
                  <span className={`status-pill order-status-pill ${selectedStatusMeta.toneClass}`}>{selectedStatusMeta.label}</span>
                </div>
              </header>

              <div className="records-order-grid">
                <article className="records-order-info-card">
                  <span>{dict.records.buyer}</span>
                  <strong>{selectedBuyerText}</strong>
                </article>
                <article className="records-order-info-card">
                  <span>{dict.records.deliveryAddress}</span>
                  <strong>{selectedDeliveryAddress}</strong>
                </article>
                <article className="records-order-info-card">
                  <span>{dict.records.seller}</span>
                  <strong>{selectedSellerText}</strong>
                </article>
                <article className="records-order-info-meta">
                  <div>
                    <span>{dict.records.orderDate}</span>
                    <strong>{selectedCreatedAt}</strong>
                  </div>
                  <div>
                    <span>{dict.records.requestDate}</span>
                    <strong>{selectedRequestedAt}</strong>
                  </div>
                  <div>
                    <span>{dict.records.deliveryType}</span>
                    <strong>{selectedDeliveryType}</strong>
                  </div>
                  <div>
                    <span>{dict.records.paymentStatus}</span>
                    <strong>{selectedPaymentStatus}</strong>
                  </div>
                  <div>
                    <span>{dict.records.total}</span>
                    <strong>{selectedTotal}</strong>
                  </div>
                </article>
                {selectedStatusRaw === "cancelled" ? (
                  <article className="records-order-info-card">
                    <span>{dict.records.cancelReason}</span>
                    <strong>{selectedCancelReason}</strong>
                  </article>
                ) : null}
              </div>
            </section>
            <section className="records-order-section">
              <h4>{dict.records.orderItemsTitle}</h4>
              {orderItemsLoading ? (
                <p className="panel-meta">{dict.common.loading}</p>
              ) : selectedOrderItems.length === 0 ? (
                <p className="panel-meta">{dict.records.noItems}</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {selectedOrderItemsColumnsWithFoodName.map((column) => (
                          <th key={column}>{orderItemColumnLabelTr(column)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {selectedOrderItems.map((row, index) => (
                        <tr key={`order-item-${index}`}>
                          {selectedOrderItemsColumnsWithFoodName.map((column) => (
                            <td key={`${index}-${column}`}>{orderCellText(column, column === "food_name" ? row.food_id : row[column])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <div className="buyer-ops-modal-actions">
              <ExcelExportButton className="ghost" type="button" onClick={downloadOpenOrderDetailAsExcel} language="tr" />
              <PrintButton className="ghost" type="button" onClick={printOpenOrderDetail} language="tr" />
                <button className="primary" type="button" onClick={() => setSelectedOrder(null)}>
                  {dict.records.close}
                </button>
              </div>
            </div>
        </div>
      ) : null}
    </div>
  );
}
