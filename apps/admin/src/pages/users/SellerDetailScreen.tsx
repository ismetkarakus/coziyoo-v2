import { Fragment, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { request, parseJson } from "../../lib/api";
import { DICTIONARIES } from "../../lib/i18n";
import { fmt, toDisplayId, formatUiDate, maskEmail, formatCurrency, normalizeImageUrl, addTwoYears, sanitizeSeedText } from "../../lib/format";
import {
  openQuickEmail,
  initialsFromName,
  mapComplianceRows,
  profileBadgeFromStatus,
  sellerDocumentStatusLabel,
  sellerDocumentStatusTone,
  optionalUploadStatusLabel,
  optionalUploadStatusTone,
  renderJsonLine,
  extractPhoneFromChecks,
  knownDocumentCodeRank,
} from "../../lib/compliance";
import { resolveSellerDetailTab } from "../../lib/routing";
import { fetchAllAdminLots, computeFoodLotDiff, lotLifecycleClass, lotLifecycleLabel } from "../../lib/lots";
import type { Language, ApiError, Dictionary } from "../../types/core";
import type { SellerDetailTab } from "../../types/seller";
import type { SellerFoodRow, SellerCompliancePayload } from "../../types/seller";
import type { AdminLotRow, AdminLotOrderRow } from "../../types/lots";
import type { BuyerPagination } from "../../types/buyer";

function SellerDetailScreen({ id, isSuperAdmin, dict, language }: { id: string; isSuperAdmin: boolean; dict: Dictionary; language: Language }) {
  const location = useLocation();
  const navigate = useNavigate();
  const endpoint = `/v1/admin/users/${id}`;
  const [row, setRow] = useState<any | null>(null);
  const [compliance, setCompliance] = useState<SellerCompliancePayload | null>(null);
  const [foodRows, setFoodRows] = useState<SellerFoodRow[]>([]);
  const [sellerOrders, setSellerOrders] = useState<
    Array<{
      orderId: string;
      orderNo: string;
      buyerId: string;
      buyerName: string | null;
      buyerEmail: string | null;
      status: string;
      totalAmount: number;
      paymentCompleted: boolean;
      paymentStatus: string;
      paymentProvider: string | null;
      paymentUpdatedAt: string | null;
      createdAt: string;
      updatedAt: string;
      items: Array<{ name?: string; quantity?: number }>;
    }>
  >([]);
  const [sellerOrdersPagination, setSellerOrdersPagination] = useState<BuyerPagination | null>(null);
  const [activeTab, setActiveTab] = useState<SellerDetailTab>(() => resolveSellerDetailTab(new URLSearchParams(location.search).get("tab")));
  const [ordersStatusFilter, setOrdersStatusFilter] = useState("all");
  const [ordersPaymentFilter, setOrdersPaymentFilter] = useState<"all" | "successful" | "pending" | "failed">("all");
  const [ordersSearch, setOrdersSearch] = useState("");
  const [earningsDateFilter, setEarningsDateFilter] = useState<"all" | "last7" | "last30">("all");
  const [earningsPaymentFilter, setEarningsPaymentFilter] = useState<"all" | "successful" | "pending" | "failed">("successful");
  const [earningsSearch, setEarningsSearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [legalSaving, setLegalSaving] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [optionalRejectTargetId, setOptionalRejectTargetId] = useState<string | null>(null);
  const [optionalRejectReason, setOptionalRejectReason] = useState("");
  const [profileImageFailed, setProfileImageFailed] = useState(false);
  const [foodImageErrors, setFoodImageErrors] = useState<Record<string, boolean>>({});
  const [lotsByFoodId, setLotsByFoodId] = useState<Record<string, AdminLotRow[]>>({});
  const [lotOrdersByLotId, setLotOrdersByLotId] = useState<Record<string, AdminLotOrderRow[]>>({});
  const [expandedFoodIds, setExpandedFoodIds] = useState<Record<string, boolean>>({});
  const [expandedLotIds, setExpandedLotIds] = useState<Record<string, boolean>>({});
  const [lotsLoading, setLotsLoading] = useState(false);
  const [lotsError, setLotsError] = useState<string | null>(null);
  const [lotOrdersLoadingByLotId, setLotOrdersLoadingByLotId] = useState<Record<string, boolean>>({});
  const [lotOrdersErrorByLotId, setLotOrdersErrorByLotId] = useState<Record<string, string | null>>({});

  async function loadSellerDetail() {
    setLoading(true);
    setMessage(null);
    setLotsError(null);
    try {
      const [detailResponse, complianceResponse, foodsResponse, sellerOrdersResponse] = await Promise.all([
        request(endpoint),
        request(`/v1/admin/compliance/${id}`),
        request(`/v1/admin/users/${id}/seller-foods?page=1&pageSize=200&sortDir=desc`),
        request(`/v1/admin/users/${id}/seller-orders?page=1&pageSize=20&sortDir=desc`),
      ]);

      if (detailResponse.status !== 200) {
        const body = await parseJson<ApiError>(detailResponse);
        setMessage(body.error?.message ?? dict.detail.loadFailed);
        return;
      }
      const detailBody = await parseJson<{ data: any }>(detailResponse);
      setRow(detailBody.data);

      if (complianceResponse.status === 200) {
        const complianceBody = await parseJson<{ data: SellerCompliancePayload }>(complianceResponse);
        setCompliance(complianceBody.data);
      } else {
        setCompliance(null);
      }

      if (foodsResponse.status === 200) {
        const foodsBody = await parseJson<{
          data: SellerFoodRow[];
        }>(foodsResponse);
        setFoodRows(foodsBody.data);
      } else {
        setFoodRows([]);
      }

      if (sellerOrdersResponse.status === 200) {
        const ordersBody = await parseJson<{ data: any[]; pagination: BuyerPagination }>(sellerOrdersResponse);
        setSellerOrders(ordersBody.data);
        setSellerOrdersPagination(ordersBody.pagination);
      } else {
        setSellerOrders([]);
        setSellerOrdersPagination(null);
      }

      setLotsLoading(true);
      try {
        const lots = await fetchAllAdminLots({ sellerId: id });
        const grouped: Record<string, AdminLotRow[]> = {};
        for (const lot of lots) {
          if (!grouped[lot.food_id]) grouped[lot.food_id] = [];
          grouped[lot.food_id].push(lot);
        }
        setLotsByFoodId(grouped);
      } catch (error) {
        setLotsByFoodId({});
        setLotsError(error instanceof Error ? error.message : dict.detail.requestFailed);
      } finally {
        setLotsLoading(false);
      }
    } catch {
      setMessage(dict.detail.requestFailed);
    } finally {
      setLoading(false);
    }
  }

  async function loadLotOrders(lotId: string) {
    if (lotOrdersByLotId[lotId]) return;
    setLotOrdersLoadingByLotId((prev) => ({ ...prev, [lotId]: true }));
    setLotOrdersErrorByLotId((prev) => ({ ...prev, [lotId]: null }));
    try {
      const response = await request(`/v1/admin/lots/${lotId}/orders`);
      if (response.status !== 200) {
        const body = await parseJson<ApiError>(response);
        setLotOrdersErrorByLotId((prev) => ({ ...prev, [lotId]: body.error?.message ?? dict.detail.requestFailed }));
        return;
      }
      const body = await parseJson<{ data: AdminLotOrderRow[] }>(response);
      setLotOrdersByLotId((prev) => ({ ...prev, [lotId]: body.data ?? [] }));
    } catch {
      setLotOrdersErrorByLotId((prev) => ({ ...prev, [lotId]: dict.detail.requestFailed }));
    } finally {
      setLotOrdersLoadingByLotId((prev) => ({ ...prev, [lotId]: false }));
    }
  }

  useEffect(() => {
    loadSellerDetail().catch(() => setMessage(dict.detail.requestFailed));
  }, [id]);

  useEffect(() => {
    setProfileImageFailed(false);
    setFoodImageErrors({});
    setRejectTargetId(null);
    setRejectReason("");
    setOptionalRejectTargetId(null);
    setOptionalRejectReason("");
    setLotsByFoodId({});
    setLotOrdersByLotId({});
    setExpandedFoodIds({});
    setExpandedLotIds({});
    setLotOrdersLoadingByLotId({});
    setLotOrdersErrorByLotId({});
    setLotsError(null);
  }, [id]);

  useEffect(() => {
    setActiveTab(resolveSellerDetailTab(new URLSearchParams(location.search).get("tab")));
  }, [location.search]);

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isSuperAdmin) return;
    const formData = new FormData(event.currentTarget);
    const payload: Record<string, string> = { email: String(formData.get("email") ?? "") };
    const password = String(formData.get("password") ?? "").trim();
    if (password) payload.password = password;
    const update = await request(endpoint, { method: "PUT", body: JSON.stringify(payload) });
    if (update.status !== 200) {
      const body = await parseJson<ApiError>(update);
      setMessage(body.error?.message ?? dict.detail.updateFailed);
      return;
    }
    const updated = await parseJson<{ data: any }>(update);
    setRow(updated.data);
    setMessage(dict.common.saved);
  }

  const paymentStateKey = (value: string | null | undefined): "successful" | "pending" | "failed" => {
    const lower = String(value ?? "").toLowerCase();
    if (lower.includes("fail")) return "failed";
    if (lower.includes("pending")) return "pending";
    return "successful";
  };

  const paymentStateText = (value: string | null | undefined) => {
    const key = paymentStateKey(value);
    if (language === "tr") {
      if (key === "failed") return "Başarısız";
      if (key === "pending") return "Bekliyor";
      return "Başarılı";
    }
    if (key === "failed") return "Failed";
    if (key === "pending") return "Pending";
    return "Successful";
  };

  const filteredSellerOrders = useMemo(() => {
    const query = ordersSearch.trim().toLocaleLowerCase(language === "tr" ? "tr-TR" : "en-US");
    return sellerOrders.filter((order) => {
      const statusMatches = ordersStatusFilter === "all" || String(order.status ?? "").toLowerCase() === ordersStatusFilter;
      const paymentMatches = ordersPaymentFilter === "all" || paymentStateKey(order.paymentStatus) === ordersPaymentFilter;
      if (!statusMatches || !paymentMatches) return false;
      if (!query) return true;
      const foods = Array.isArray(order.items)
        ? order.items.map((item) => `${String(item.name ?? "-")} x${Number(item.quantity ?? 0)}`).join(", ")
        : "";
      const haystack = [
        order.orderNo,
        order.buyerName ?? "",
        order.buyerEmail ?? "",
        order.buyerId ?? "",
        foods,
      ].join(" ").toLocaleLowerCase(language === "tr" ? "tr-TR" : "en-US");
      return haystack.includes(query);
    });
  }, [sellerOrders, ordersStatusFilter, ordersPaymentFilter, ordersSearch, language]);

  const filteredSellerEarnings = useMemo(() => {
    const now = Date.now();
    const query = earningsSearch.trim().toLocaleLowerCase(language === "tr" ? "tr-TR" : "en-US");
    return sellerOrders.filter((order) => {
      const paymentKey = paymentStateKey(order.paymentStatus);
      if (earningsPaymentFilter !== "all" && paymentKey !== earningsPaymentFilter) return false;
      if (earningsDateFilter !== "all") {
        const created = Date.parse(String(order.createdAt ?? ""));
        if (Number.isFinite(created)) {
          const diffDays = (now - created) / (1000 * 60 * 60 * 24);
          if (earningsDateFilter === "last7" && diffDays > 7) return false;
          if (earningsDateFilter === "last30" && diffDays > 30) return false;
        }
      }
      if (!query) return true;
      const haystack = [
        order.orderNo,
        order.buyerName ?? "",
        order.buyerEmail ?? "",
        order.buyerId ?? "",
      ].join(" ").toLocaleLowerCase(language === "tr" ? "tr-TR" : "en-US");
      return haystack.includes(query);
    });
  }, [sellerOrders, earningsDateFilter, earningsPaymentFilter, earningsSearch, language]);

  if (loading && !row) return <div className="panel">{dict.common.loading}</div>;
  if (!row) return <div className="panel">{message ?? dict.common.noRecords}</div>;

  const isActive = row.status === "active";
  const accountStatusLabel = isActive ? dict.common.active : dict.common.disabled;
  const phone = extractPhoneFromChecks(compliance);
  const maskedEmail = maskEmail(row.email);
  const profileRetentionUntil = addTwoYears(row.updatedAt);
  const complianceRetentionUntil = addTwoYears(compliance?.profile.updated_at);
  const totalFoods = Number(row.totalFoods ?? foodRows.length ?? 0);
  const latestFoodUpdatedAt = foodRows.reduce<string | null>((latest, item) => {
    const value = String(item.updatedAt ?? "");
    if (!value) return latest;
    if (!latest) return value;
    return Date.parse(value) > Date.parse(latest) ? value : latest;
  }, null);
  const foodRetentionUntil = addTwoYears(latestFoodUpdatedAt);
  const initials = initialsFromName(row.displayName, row.email);
  const fallbackProfileImageFromFoods = foodRows.map((item) => normalizeImageUrl(item.imageUrl)).find(Boolean) ?? null;
  const profileImageUrl =
    !profileImageFailed
      ? normalizeImageUrl(row.profileImageUrl) ?? normalizeImageUrl(row.profile_image_url) ?? fallbackProfileImageFromFoods
      : null;
  const complianceCta = language === "tr" ? "Uygunluğa Git" : "Go to Compliance";
  const auditCta = language === "tr" ? "Denetim Kayıtları" : "Audit Logs";
  const walletAmount = formatCurrency(
    filteredSellerEarnings
      .filter((order) => paymentStateKey(order.paymentStatus) === "successful")
      .reduce((sum, order) => sum + Number(order.totalAmount ?? 0), 0),
    language
  );
  const roleLabel =
    row.role === "seller"
      ? dict.users.userTypeSeller
      : row.role === "buyer"
        ? dict.users.userTypeBuyer
        : row.role === "both"
          ? dict.users.userTypeBoth
          : String(row.role ?? "-");
  const ratingSource = foodRows
    .map(() => 4)
    .filter((value) => Number.isFinite(value) && value > 0);
  const avgRating = ratingSource.length > 0 ? ratingSource.reduce((sum, value) => sum + value, 0) / ratingSource.length : 4;
  const roundedStars = Math.max(0, Math.min(5, Math.round(avgRating)));

  const legalRows = mapComplianceRows(compliance, dict, language);
  const profileBadge = profileBadgeFromStatus(compliance?.profile.status, dict);
  const legalDocuments = [...(compliance?.documents ?? [])].sort((a, b) => {
    const rankDiff = knownDocumentCodeRank(a.code) - knownDocumentCodeRank(b.code);
    if (rankDiff !== 0) return rankDiff;
    return a.name.localeCompare(b.name, language === "tr" ? "tr" : "en", { sensitivity: "base" });
  });
  const legalTypeRows = (() => {
    const map = new Map<string, (typeof legalDocuments)[number]>();
    for (const row of legalDocuments) {
      if (!map.has(row.code)) map.set(row.code, row);
    }
    return Array.from(map.values());
  })();
  const optionalUploads = [...(compliance?.optionalUploads ?? [])].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  async function updateDocumentStatus(documentId: string, status: "requested" | "approved" | "rejected", rejectionReasonInput?: string) {
    setLegalSaving(true);
    setMessage(null);
    try {
      const response = await request(`/v1/admin/compliance/${id}/documents/${documentId}`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          rejectionReason: status === "rejected" ? (rejectionReasonInput ?? null) : null,
        }),
      });
      if (response.status !== 200) {
        const body = await parseJson<ApiError>(response);
        setMessage(body.error?.message ?? dict.detail.legalUpdateFailed);
        return;
      }
      await loadSellerDetail();
      setMessage(dict.common.saved);
      setRejectTargetId(null);
      setRejectReason("");
      setOptionalRejectTargetId(null);
      setOptionalRejectReason("");
    } catch {
      setMessage(dict.detail.requestFailed);
    } finally {
      setLegalSaving(false);
    }
  }

  async function updateOptionalUploadStatus(uploadId: string, status: "uploaded" | "approved" | "rejected", rejectionReasonInput?: string) {
    setLegalSaving(true);
    setMessage(null);
    try {
      const response = await request(`/v1/admin/compliance/${id}/optional-uploads/${uploadId}`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          rejectionReason: status === "rejected" ? (rejectionReasonInput ?? null) : null,
        }),
      });
      if (response.status !== 200) {
        const body = await parseJson<ApiError>(response);
        setMessage(body.error?.message ?? dict.detail.legalUpdateFailed);
        return;
      }
      await loadSellerDetail();
      setMessage(dict.common.saved);
      setOptionalRejectTargetId(null);
      setOptionalRejectReason("");
    } catch {
      setMessage(dict.detail.requestFailed);
    } finally {
      setLegalSaving(false);
    }
  }

  async function updateDocumentRequired(docTypeCode: string, required: boolean) {
    setLegalSaving(true);
    setMessage(null);
    try {
      const response = await request(`/v1/admin/compliance/${id}/doc-types/${encodeURIComponent(docTypeCode)}`, {
        method: "PATCH",
        body: JSON.stringify({ required }),
      });
      if (response.status !== 200) {
        const body = await parseJson<ApiError>(response);
        setMessage(body.error?.message ?? dict.detail.legalUpdateFailed);
        return;
      }
      await loadSellerDetail();
      setMessage(dict.common.saved);
    } catch {
      setMessage(dict.detail.requestFailed);
    } finally {
      setLegalSaving(false);
    }
  }

  function downloadSellerOrdersAsExcel() {
    if (filteredSellerOrders.length === 0) {
      setMessage(language === "tr" ? "Disa aktarilacak siparis bulunamadi." : "No orders to export.");
      return;
    }

    const headers = [
      language === "tr" ? "Tarih / Saat" : "Date / Time",
      language === "tr" ? "Siparis No" : "Order No",
      language === "tr" ? "Alici" : "Buyer",
      language === "tr" ? "Yemekler" : "Foods",
      language === "tr" ? "Tutar" : "Amount",
      language === "tr" ? "Odeme" : "Payment",
      language === "tr" ? "Durum" : "Status",
    ];
    const rowsForExport = filteredSellerOrders.map((order) => {
      const paymentText = paymentStateText(order.paymentStatus);
      const foods = Array.isArray(order.items)
        ? order.items.map((item) => `${String(item.name ?? "-")} x${Number(item.quantity ?? 0)}`).join(", ")
        : "-";
      return [
        formatUiDate(order.createdAt, language),
        order.orderNo,
        order.buyerName ?? order.buyerEmail ?? order.buyerId,
        foods || "-",
        formatCurrency(Number(order.totalAmount ?? 0), language),
        paymentText,
        order.status,
      ];
    });

    const escapeCsv = (value: string) => `"${value.replace(/"/g, "\"\"")}"`;
    const csv = [headers, ...rowsForExport].map((line) => line.map((cell) => escapeCsv(String(cell))).join(",")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `seller-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadSellerEarningsAsExcel() {
    if (filteredSellerEarnings.length === 0) {
      setMessage(language === "tr" ? "Disa aktarilacak kazanc kaydi bulunamadi." : "No earnings to export.");
      return;
    }
    const headers = [
      language === "tr" ? "Tarih / Saat" : "Date / Time",
      language === "tr" ? "Siparis No" : "Order No",
      language === "tr" ? "Alici" : "Buyer",
      language === "tr" ? "Odeme" : "Payment",
      language === "tr" ? "Kazanc" : "Earning",
    ];
    const rowsForExport = filteredSellerEarnings.map((order) => [
      formatUiDate(order.createdAt, language),
      order.orderNo,
      order.buyerName ?? order.buyerEmail ?? order.buyerId,
      paymentStateText(order.paymentStatus),
      formatCurrency(Number(order.totalAmount ?? 0), language),
    ]);
    const escapeCsv = (value: string) => `"${value.replace(/"/g, "\"\"")}"`;
    const csv = [headers, ...rowsForExport].map((line) => line.map((cell) => escapeCsv(String(cell))).join(",")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `seller-earnings-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const sellerRawPayload = {
    id: row.id,
    user: row,
    compliance,
    foods: foodRows,
    orders: {
      rows: sellerOrders,
      pagination: sellerOrdersPagination,
    },
    derived: {
      emailMasked: maskedEmail,
      phoneFromComplianceChecks: phone,
      roleLabel,
      isActive,
    },
    legalHoldState: Boolean(row.legalHoldState),
  };

  const tabs = [
    { key: "general", label: dict.detail.sellerTabs.general },
    { key: "foods", label: dict.detail.sellerTabs.foods },
    { key: "orders", label: dict.detail.sellerTabs.orders },
    { key: "wallet", label: dict.detail.sellerTabs.wallet },
    { key: "identity", label: language === "tr" ? "Uygunluk" : "Compliance" },
    { key: "retention", label: dict.detail.sellerTabs.retention },
    { key: "security", label: dict.detail.sellerTabs.security },
    { key: "raw", label: dict.detail.sellerTabs.raw },
  ] as const;

  return (
    <div className="app seller-detail-page">
      {message ? <div className="alert">{message}</div> : null}

      <section className="panel seller-hero">
        <article className="seller-hero-main">
          <div className="seller-avatar-col">
            <div className="seller-avatar">
              {profileImageUrl ? (
                <img
                  src={profileImageUrl}
                  alt={row.displayName ?? "seller"}
                  onError={() => setProfileImageFailed(true)}
                />
              ) : (
                <span>{initials}</span>
              )}
            </div>
            <div className="seller-rating-row" aria-label={`rating ${avgRating.toFixed(1)}`}>
              <span className="rating-value">{avgRating.toFixed(1)}</span>
              <span className="rating-stars" aria-hidden="true">
                {Array.from({ length: 5 }).map((_, index) => (
                  <span key={index} className={index < roundedStars ? "is-filled" : ""}>★</span>
                ))}
              </span>
            </div>
          </div>
          <div className="seller-hero-text">
            <div className="seller-hero-title-row">
              <h1>{row.displayName ?? row.email}</h1>
              <span className={`status-pill ${isActive ? "is-active" : "is-disabled"}`}>{accountStatusLabel}</span>
              <span className="seller-user-id">{`${dict.detail.userId}: ${row.id}`}</span>
            </div>
            <p>{maskedEmail}</p>
            <p className="panel-meta">
              <span>{roleLabel}</span>
              <span className="seller-country-badge">{row.countryCode ?? "-"}</span>
              <span>{`${language === "tr" ? "Kayıt" : "Created"}: ${formatUiDate(row.createdAt, language)}`}</span>
            </p>
          </div>
        </article>
        <div className="seller-hero-right">
          <div className="topbar-actions">
            <button className="ghost" type="button" onClick={() => loadSellerDetail().catch(() => setMessage(dict.detail.requestFailed))}>
              {dict.actions.refresh}
            </button>
            <button className="ghost" type="button" onClick={() => openQuickEmail(row.email, dict, setMessage)}>
              {dict.detail.quickEmail}
            </button>
            <button className="primary" type="button" onClick={() => setActiveTab("legal")}>{complianceCta}</button>
            <button className="ghost" type="button" onClick={() => navigate("/app/audit")}>{auditCta}</button>
          </div>
          <div className="seller-hero-stats">
            <article>
              <p>{dict.detail.sellerTabs.wallet}</p>
              <strong>{walletAmount}</strong>
            </article>
            <article>
              <p>{dict.detail.lastAction}</p>
              <strong>{formatUiDate(row.updatedAt, language)}</strong>
            </article>
          </div>
        </div>
      </section>

      <section className="panel seller-tabs-panel">
        <div className="seller-tabs" role="tablist" aria-label={dict.detail.sellerTabs.title}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              className={activeTab === tab.key ? "is-active" : ""}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {activeTab === "identity" ? (
        <section className="panel seller-identity-compliance">
            <div className="seller-compliance-header">
              <div className="seller-compliance-title">
                <span className="seller-compliance-flag" aria-hidden="true">🇹🇷</span>
                <h2>{dict.detail.trCompliance}</h2>
              </div>
              <span className={`status-pill compliance-status-pill is-${profileBadge.tone}`}>{profileBadge.label}</span>
            </div>
            <div className="seller-compliance-list">
              {legalRows.map((item) => (
                <article className="seller-compliance-row" key={`identity-${item.key}`}>
                  <span className={`compliance-icon is-${item.tone}`} aria-hidden="true" />
                  <div>
                    <strong>{item.label}</strong>
                    <p className="panel-meta">{item.detailText}</p>
                  </div>
                  <button className="ghost" type="button" onClick={() => setActiveTab("legal")}>
                    {language === "tr" ? "Duzenle" : "Edit"}
                  </button>
                </article>
              ))}
            </div>
          {!isSuperAdmin ? <p className="panel-meta">{dict.detail.readOnly}</p> : null}
        </section>
      ) : null}

      {activeTab === "legal" ? (
        <section className="panel">
          <article className="seller-compliance-card">
            <div className="seller-compliance-header">
              <div className="seller-compliance-title">
                <span className="seller-compliance-flag" aria-hidden="true">🇹🇷</span>
                <h2>{dict.detail.trCompliance}</h2>
              </div>
              <span className={`status-pill compliance-status-pill is-${profileBadge.tone}`}>{profileBadge.label}</span>
            </div>
            {compliance?.profile.review_notes ? <div className="panel-note">{compliance.profile.review_notes}</div> : null}
            <div className="seller-compliance-list">
              <h3>{dict.detail.legalDocumentTypesTitle}</h3>
              {legalTypeRows.length === 0 ? (
                <p className="panel-meta">{dict.detail.noComplianceData}</p>
              ) : (
                <div className="buyer-ops-table-wrap legal-docs-table">
                  <table>
                    <thead>
                      <tr>
                        <th>{dict.detail.legalDocType}</th>
                        <th>{dict.detail.legalRequired}</th>
                        <th>{dict.detail.legalStatus}</th>
                        <th>{dict.detail.updatedAtLabel}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {legalTypeRows.map((row) => {
                        const tone = sellerDocumentStatusTone(row.status);
                        return (
                          <tr key={`dtype-${row.code}`}>
                            <td>
                              <strong>{row.name}</strong>
                              <div className="panel-meta legal-doc-sub">{row.code}</div>
                            </td>
                            <td>
                              <label className="legal-required-toggle">
                                <input
                                  type="checkbox"
                                  checked={row.is_required}
                                  disabled={!isSuperAdmin || legalSaving}
                                  onChange={(event) => {
                                    void updateDocumentRequired(row.code, event.target.checked);
                                  }}
                                />
                                <span>{row.is_required ? dict.common.yes : dict.common.no}</span>
                              </label>
                            </td>
                            <td><span className={`status-pill compliance-status-pill is-${tone}`}>{sellerDocumentStatusLabel(row.status, dict)}</span></td>
                            <td>{formatUiDate(row.updated_at, language)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="seller-compliance-list legal-doc-history-block">
              <h3>{dict.detail.legalDocumentHistoryTitle}</h3>
              {legalDocuments.length === 0 ? (
                <p className="panel-meta">{dict.detail.noComplianceData}</p>
              ) : (
                <div className="buyer-ops-table-wrap legal-docs-table">
                  <table>
                    <thead>
                      <tr>
                        <th>{dict.detail.legalUploadedAt}</th>
                        <th>{dict.detail.legalDocType}</th>
                        <th>{dict.detail.legalFile}</th>
                        <th>{dict.detail.legalStatus}</th>
                        <th>{dict.detail.legalReviewedAt}</th>
                        <th>{dict.detail.legalRejectionReason}</th>
                        <th>{dict.detail.legalActions}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {legalDocuments.map((row) => {
                        const tone = sellerDocumentStatusTone(row.status);
                        return (
                          <tr key={row.id}>
                            <td>{formatUiDate(row.uploaded_at, language)}</td>
                            <td>
                              <strong>{row.name}</strong>
                              <div className="panel-meta legal-doc-sub">{row.code}</div>
                            </td>
                            <td>
                              {row.file_url ? (
                                <a href={row.file_url} target="_blank" rel="noreferrer" className="inline-copy">{dict.detail.legalOpenFile}</a>
                              ) : (
                                <span className="panel-meta">-</span>
                              )}
                            </td>
                            <td><span className={`status-pill compliance-status-pill is-${tone}`}>{sellerDocumentStatusLabel(row.status, dict)}</span></td>
                            <td>{formatUiDate(row.reviewed_at, language)}</td>
                            <td>{row.rejection_reason ?? "-"}</td>
                            <td>
                              <div className="legal-doc-actions">
                                <button
                                  className="ghost compliance-edit-btn"
                                  type="button"
                                  disabled={!isSuperAdmin || legalSaving}
                                  onClick={() => void updateDocumentStatus(row.id, "approved")}
                                >
                                  {dict.detail.legalApprove}
                                </button>
                                <button
                                  className="ghost compliance-edit-btn"
                                  type="button"
                                  disabled={!isSuperAdmin || legalSaving}
                                  onClick={() => {
                                    setRejectTargetId(row.id);
                                    setRejectReason(row.rejection_reason ?? "");
                                  }}
                                >
                                  {dict.detail.legalReject}
                                </button>
                                <button
                                  className="ghost compliance-edit-btn"
                                  type="button"
                                  disabled={!isSuperAdmin || legalSaving}
                                  onClick={() => void updateDocumentStatus(row.id, "requested")}
                                >
                                  {dict.detail.legalPend}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="seller-compliance-list legal-doc-history-block">
              <h3>{dict.detail.optionalUploadsTitle}</h3>
              {optionalUploads.length === 0 ? (
                <p className="panel-meta">{dict.detail.noComplianceData}</p>
              ) : (
                <div className="buyer-ops-table-wrap legal-docs-table">
                  <table>
                    <thead>
                      <tr>
                        <th>{dict.detail.legalUploadedAt}</th>
                        <th>{dict.detail.optionalTitle}</th>
                        <th>{dict.detail.legalFile}</th>
                        <th>{dict.detail.legalStatus}</th>
                        <th>{dict.detail.legalReviewedAt}</th>
                        <th>{dict.detail.legalRejectionReason}</th>
                        <th>{dict.detail.legalActions}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {optionalUploads.map((row) => {
                        const tone = optionalUploadStatusTone(row.status);
                        const title = row.catalog_doc_name ?? row.custom_title ?? row.catalog_doc_code ?? "-";
                        return (
                          <tr key={`optional-${row.id}`}>
                            <td>{formatUiDate(row.created_at, language)}</td>
                            <td>
                              <strong>{title}</strong>
                              {row.custom_description ? <div className="panel-meta legal-doc-sub">{row.custom_description}</div> : null}
                            </td>
                            <td>
                              <a href={row.file_url} target="_blank" rel="noreferrer" className="inline-copy">{dict.detail.legalOpenFile}</a>
                            </td>
                            <td><span className={`status-pill compliance-status-pill is-${tone}`}>{optionalUploadStatusLabel(row.status, dict)}</span></td>
                            <td>{formatUiDate(row.reviewed_at, language)}</td>
                            <td>{row.rejection_reason ?? "-"}</td>
                            <td>
                              <div className="legal-doc-actions">
                                <button
                                  className="ghost compliance-edit-btn"
                                  type="button"
                                  disabled={!isSuperAdmin || legalSaving || row.status === "archived"}
                                  onClick={() => void updateOptionalUploadStatus(row.id, "approved")}
                                >
                                  {dict.detail.legalApprove}
                                </button>
                                <button
                                  className="ghost compliance-edit-btn"
                                  type="button"
                                  disabled={!isSuperAdmin || legalSaving || row.status === "archived"}
                                  onClick={() => {
                                    setOptionalRejectTargetId(row.id);
                                    setOptionalRejectReason(row.rejection_reason ?? "");
                                  }}
                                >
                                  {dict.detail.legalReject}
                                </button>
                                <button
                                  className="ghost compliance-edit-btn"
                                  type="button"
                                  disabled={!isSuperAdmin || legalSaving || row.status === "archived"}
                                  onClick={() => void updateOptionalUploadStatus(row.id, "uploaded")}
                                >
                                  {dict.detail.legalPend}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </article>
          {rejectTargetId ? (
            <div className="buyer-ops-modal-backdrop">
              <div className="buyer-ops-modal">
                <h3>{dict.detail.legalRejectModalTitle}</h3>
                <label>
                  {dict.detail.legalRejectionReason}
                  <textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} rows={4} />
                </label>
                <div className="buyer-ops-modal-actions">
                  <button className="ghost" type="button" onClick={() => { setRejectTargetId(null); setRejectReason(""); }}>
                    {dict.common.cancel}
                  </button>
                  <button
                    className="primary"
                    type="button"
                    disabled={!rejectReason.trim() || legalSaving}
                    onClick={() => void updateDocumentStatus(rejectTargetId, "rejected", rejectReason.trim())}
                  >
                    {dict.detail.legalReject}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {optionalRejectTargetId ? (
            <div className="buyer-ops-modal-backdrop">
              <div className="buyer-ops-modal">
                <h3>{dict.detail.optionalRejectModalTitle}</h3>
                <label>
                  {dict.detail.legalRejectionReason}
                  <textarea value={optionalRejectReason} onChange={(event) => setOptionalRejectReason(event.target.value)} rows={4} />
                </label>
                <div className="buyer-ops-modal-actions">
                  <button className="ghost" type="button" onClick={() => { setOptionalRejectTargetId(null); setOptionalRejectReason(""); }}>
                    {dict.common.cancel}
                  </button>
                  <button
                    className="primary"
                    type="button"
                    disabled={!optionalRejectReason.trim() || legalSaving}
                    onClick={() => void updateOptionalUploadStatus(optionalRejectTargetId, "rejected", optionalRejectReason.trim())}
                  >
                    {dict.detail.legalReject}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {activeTab === "foods" ? (
        <section className="panel">
          <div className="panel-header">
            <h2>{dict.detail.sellerTabs.foods}</h2>
          </div>
          <p className="panel-meta">{`${dict.detail.totalFoods}: ${totalFoods}`}</p>
          {lotsError ? <div className="alert">{lotsError}</div> : null}
          {foodRows.length === 0 ? (
            <p className="panel-meta">{dict.common.noRecords}</p>
          ) : (
            <div className="table-wrap">
              <table className="foods-lots-main-table">
                <thead>
                  <tr>
                    <th>{dict.detail.foodName}</th>
                    <th>{dict.detail.foodStatus}</th>
                    <th>{dict.detail.foodPrice}</th>
                    <th>{dict.detail.updatedAtLabel}</th>
                    <th>{dict.detail.lotSummary}</th>
                    <th>{dict.detail.lotActions}</th>
                  </tr>
                </thead>
                <tbody>
                  {foodRows.map((food) => {
                    const isActiveFood = food.status === "active";
                    const foodLots = lotsByFoodId[food.id] ?? [];
                    const activeLots = foodLots.filter((lot) => lot.lifecycle_status === "on_sale").length;
                    const recalledLots = foodLots.filter((lot) => lot.lifecycle_status === "recalled").length;
                    const foodExpanded = Boolean(expandedFoodIds[food.id]);
                    return (
                      <Fragment key={food.id}>
                        <tr>
                          <td>
                            <strong>{food.name}</strong>
                            <div className="panel-meta">{food.code}</div>
                            <div className="panel-meta">{sanitizeSeedText(food.description) || sanitizeSeedText(food.cardSummary) || dict.detail.noFoodDescription}</div>
                          </td>
                          <td>
                            <span className={`status-pill ${isActiveFood ? "is-active" : "is-disabled"}`}>
                              {isActiveFood ? dict.common.active : dict.common.disabled}
                            </span>
                          </td>
                          <td>{formatCurrency(food.price, language)}</td>
                          <td>{formatUiDate(food.updatedAt, language)}</td>
                          <td>
                            <div className="lot-summary-cell">
                              <span>{`${dict.detail.lotsTitle}: ${foodLots.length}`}</span>
                              <span>{`${language === "tr" ? "Satışta" : "On Sale"}: ${activeLots}`}</span>
                              {recalledLots > 0 ? <span className="lot-summary-danger">{`${language === "tr" ? "Geri çağrılan" : "Recalled"}: ${recalledLots}`}</span> : null}
                            </div>
                          </td>
                          <td>
                            <button
                              className="ghost"
                              type="button"
                              onClick={() => setExpandedFoodIds((prev) => ({ ...prev, [food.id]: !prev[food.id] }))}
                            >
                              {foodExpanded ? dict.detail.hideLots : dict.detail.showLots}
                            </button>
                          </td>
                        </tr>
                        {foodExpanded ? (
                          <tr className="foods-lots-expanded-row">
                            <td colSpan={6}>
                              {lotsLoading ? (
                                <p className="panel-meta">{dict.common.loading}</p>
                              ) : foodLots.length === 0 ? (
                                <p className="panel-meta">{dict.detail.noLotsForFood}</p>
                              ) : (
                                <div className="seller-food-lots-table-wrap">
                                  <table className="seller-food-lots-table">
                                    <thead>
                                      <tr>
                                        <th>{dict.detail.lotNumber}</th>
                                        <th>{dict.detail.lotLifecycle}</th>
                                        <th>{dict.detail.lotQuantity}</th>
                                        <th>{dict.detail.lotProducedAt}</th>
                                        <th>{dict.detail.lotSaleWindow}</th>
                                        <th>{dict.detail.lotSnapshot}</th>
                                        <th>{dict.detail.lotActions}</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {foodLots.map((lot) => {
                                        const diff = computeFoodLotDiff({
                                          foodRecipe: food.recipe,
                                          foodIngredients: food.ingredients,
                                          foodAllergens: undefined,
                                          lot,
                                        });
                                        const isLotExpanded = Boolean(expandedLotIds[lot.id]);
                                        const lotOrders = lotOrdersByLotId[lot.id] ?? [];
                                        return (
                                          <Fragment key={lot.id}>
                                            <tr>
                                              <td>{lot.lot_number}</td>
                                              <td>
                                                <span className={`status-pill ${lotLifecycleClass(lot.lifecycle_status)}`}>
                                                  {lotLifecycleLabel(lot.lifecycle_status, language)}
                                                </span>
                                              </td>
                                              <td>{`${lot.quantity_available}/${lot.quantity_produced}`}</td>
                                              <td>{formatUiDate(lot.produced_at, language)}</td>
                                              <td>{`${formatUiDate(lot.sale_starts_at, language)} - ${formatUiDate(lot.sale_ends_at, language)}`}</td>
                                              <td>
                                                <div className="lot-diff-badges">
                                                  {diff.hasMissingSnapshot ? <span className="status-pill is-danger">{dict.detail.lotSnapshotMissing}</span> : null}
                                                  {diff.recipeChanged ? <span className="status-pill is-warning">{dict.detail.lotDiffRecipe}</span> : null}
                                                  {diff.ingredientsChanged ? <span className="status-pill is-warning">{dict.detail.lotDiffIngredients}</span> : null}
                                                  {diff.allergensChanged ? <span className="status-pill is-danger">{dict.detail.lotDiffAllergens}</span> : null}
                                                  {!diff.hasMissingSnapshot && !diff.recipeChanged && !diff.ingredientsChanged && !diff.allergensChanged ? (
                                                    <span className="status-pill is-success">{dict.detail.lotSnapshotOk}</span>
                                                  ) : null}
                                                </div>
                                              </td>
                                              <td>
                                                <button
                                                  className="ghost"
                                                  type="button"
                                                  onClick={() => {
                                                    const next = !isLotExpanded;
                                                    setExpandedLotIds((prev) => ({ ...prev, [lot.id]: next }));
                                                    if (next) void loadLotOrders(lot.id);
                                                  }}
                                                >
                                                  {isLotExpanded ? dict.detail.hideLotOrders : dict.detail.showLotOrders}
                                                </button>
                                              </td>
                                            </tr>
                                            {isLotExpanded ? (
                                              <tr className="lot-orders-row">
                                                <td colSpan={7}>
                                                  {lotOrdersLoadingByLotId[lot.id] ? (
                                                    <p className="panel-meta">{dict.common.loading}</p>
                                                  ) : lotOrdersErrorByLotId[lot.id] ? (
                                                    <div className="alert">{lotOrdersErrorByLotId[lot.id]}</div>
                                                  ) : lotOrders.length === 0 ? (
                                                    <p className="panel-meta">{dict.detail.noOrdersForLot}</p>
                                                  ) : (
                                                    <div className="seller-food-lot-orders-wrap">
                                                      <table className="seller-food-lot-orders-table">
                                                        <thead>
                                                          <tr>
                                                            <th>{language === "tr" ? "Sipariş" : "Order"}</th>
                                                            <th>{language === "tr" ? "Durum" : "Status"}</th>
                                                            <th>{language === "tr" ? "Alıcı" : "Buyer"}</th>
                                                            <th>{language === "tr" ? "Adet" : "Quantity"}</th>
                                                            <th>{language === "tr" ? "Tarih" : "Created"}</th>
                                                          </tr>
                                                        </thead>
                                                        <tbody>
                                                          {lotOrders.map((order) => (
                                                            <tr key={`${lot.id}-${order.order_id}`}>
                                                              <td>{`#${order.order_id.slice(0, 8).toUpperCase()}`}</td>
                                                              <td>{order.status}</td>
                                                              <td>{order.buyer_id}</td>
                                                              <td>{order.quantity_allocated}</td>
                                                              <td>{formatUiDate(order.created_at, language)}</td>
                                                            </tr>
                                                          ))}
                                                        </tbody>
                                                      </table>
                                                    </div>
                                                  )}
                                                </td>
                                              </tr>
                                            ) : null}
                                          </Fragment>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {activeTab === "orders" ? (
        <section className="panel">
          <div className="panel-header">
            <h2>{dict.detail.sellerTabs.orders}</h2>
          </div>
          <div className="seller-detail-filter-row">
            <label className="ghost seller-detail-filter-item">
              <span>{language === "tr" ? "Durum" : "Status"}</span>
              <select value={ordersStatusFilter} onChange={(event) => setOrdersStatusFilter(event.target.value)}>
                <option value="all">{language === "tr" ? "Hepsi" : "All"}</option>
                <option value="pending">{language === "tr" ? "Bekliyor" : "Pending"}</option>
                <option value="confirmed">{language === "tr" ? "Onaylandı" : "Confirmed"}</option>
                <option value="delivered">{language === "tr" ? "Teslim Edildi" : "Delivered"}</option>
                <option value="cancelled">{language === "tr" ? "İptal" : "Cancelled"}</option>
              </select>
            </label>
            <label className="ghost seller-detail-filter-item">
              <span>{language === "tr" ? "Ödeme" : "Payment"}</span>
              <select value={ordersPaymentFilter} onChange={(event) => setOrdersPaymentFilter(event.target.value as typeof ordersPaymentFilter)}>
                <option value="all">{language === "tr" ? "Hepsi" : "All"}</option>
                <option value="successful">{language === "tr" ? "Başarılı" : "Successful"}</option>
                <option value="pending">{language === "tr" ? "Bekliyor" : "Pending"}</option>
                <option value="failed">{language === "tr" ? "Başarısız" : "Failed"}</option>
              </select>
            </label>
            <label className="ghost seller-detail-filter-item seller-detail-filter-search">
              <span>{language === "tr" ? "Ara" : "Search"}</span>
              <input
                value={ordersSearch}
                onChange={(event) => setOrdersSearch(event.target.value)}
                placeholder={language === "tr" ? "Sipariş / Alıcı ara" : "Search order / buyer"}
              />
            </label>
            <button className="primary seller-detail-export-btn" type="button" onClick={downloadSellerOrdersAsExcel}>
              {language === "tr" ? "Excel'e Aktar" : "Export Excel"}
            </button>
          </div>
          {filteredSellerOrders.length === 0 ? (
            <p className="panel-meta">{dict.common.noRecords}</p>
          ) : (
            <>
              <div className="buyer-ops-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Tarih / Saat</th>
                      <th>Sipariş No</th>
                      <th>Alıcı</th>
                      <th>Yemekler</th>
                      <th>Tutar</th>
                      <th>Ödeme</th>
                      <th>Durum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSellerOrders.map((order) => {
                      const paymentText = paymentStateText(order.paymentStatus);
                      const foods = Array.isArray(order.items)
                        ? order.items.map((item) => `${String(item.name ?? "-")} x${Number(item.quantity ?? 0)}`).join(", ")
                        : "-";
                      return (
                        <tr key={order.orderId}>
                          <td>{formatUiDate(order.createdAt, language)}</td>
                          <td>{order.orderNo}</td>
                          <td>{order.buyerName ?? order.buyerEmail ?? order.buyerId}</td>
                          <td>{foods || "-"}</td>
                          <td>{formatCurrency(Number(order.totalAmount ?? 0), language)}</td>
                          <td>{paymentText}</td>
                          <td>{order.status}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="panel-meta">
                {`${filteredSellerOrders.length} ${language === "tr" ? "sipariş" : "orders"}`}
              </p>
            </>
          )}
        </section>
      ) : null}

      {activeTab === "wallet" ? (
        <section className="panel">
          <div className="panel-header">
            <h2>{dict.detail.sellerTabs.wallet}</h2>
          </div>
          <div className="seller-detail-filter-row">
            <label className="ghost seller-detail-filter-item">
              <span>{language === "tr" ? "Dönem" : "Period"}</span>
              <select value={earningsDateFilter} onChange={(event) => setEarningsDateFilter(event.target.value as typeof earningsDateFilter)}>
                <option value="all">{language === "tr" ? "Tüm Zamanlar" : "All Time"}</option>
                <option value="last7">{language === "tr" ? "Son 7 Gün" : "Last 7 Days"}</option>
                <option value="last30">{language === "tr" ? "Son 30 Gün" : "Last 30 Days"}</option>
              </select>
            </label>
            <label className="ghost seller-detail-filter-item">
              <span>{language === "tr" ? "Ödeme" : "Payment"}</span>
              <select value={earningsPaymentFilter} onChange={(event) => setEarningsPaymentFilter(event.target.value as typeof earningsPaymentFilter)}>
                <option value="all">{language === "tr" ? "Hepsi" : "All"}</option>
                <option value="successful">{language === "tr" ? "Başarılı" : "Successful"}</option>
                <option value="pending">{language === "tr" ? "Bekliyor" : "Pending"}</option>
                <option value="failed">{language === "tr" ? "Başarısız" : "Failed"}</option>
              </select>
            </label>
            <label className="ghost seller-detail-filter-item seller-detail-filter-search">
              <span>{language === "tr" ? "Ara" : "Search"}</span>
              <input
                value={earningsSearch}
                onChange={(event) => setEarningsSearch(event.target.value)}
                placeholder={language === "tr" ? "Sipariş / Alıcı ara" : "Search order / buyer"}
              />
            </label>
            <button className="primary seller-detail-export-btn" type="button" onClick={downloadSellerEarningsAsExcel}>
              {language === "tr" ? "Excel'e Aktar" : "Export Excel"}
            </button>
          </div>
          {filteredSellerEarnings.length === 0 ? (
            <p className="panel-meta">{dict.common.noRecords}</p>
          ) : (
            <>
              <div className="buyer-ops-table-wrap seller-wallet-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{language === "tr" ? "Tarih / Saat" : "Date / Time"}</th>
                      <th>{language === "tr" ? "Sipariş No" : "Order No"}</th>
                      <th>{language === "tr" ? "Alıcı" : "Buyer"}</th>
                      <th>{language === "tr" ? "Ödeme" : "Payment"}</th>
                      <th>{language === "tr" ? "Kazanç" : "Earning"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSellerEarnings.map((order) => (
                      <tr key={`earning-${order.orderId}`}>
                        <td>{formatUiDate(order.createdAt, language)}</td>
                        <td>{order.orderNo}</td>
                        <td>{order.buyerName ?? order.buyerEmail ?? order.buyerId}</td>
                        <td>{paymentStateText(order.paymentStatus)}</td>
                        <td>{formatCurrency(Number(order.totalAmount ?? 0), language)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="panel-meta">{`${filteredSellerEarnings.length} ${language === "tr" ? "kayıt" : "records"}`}</p>
            </>
          )}
        </section>
      ) : null}

      {activeTab === "retention" ? (
        <section className="panel">
          <div className="panel-header">
            <h2>{dict.detail.retentionPolicy}</h2>
          </div>
          <div className="seller-retention-chips">
            <span className="retention-chip">{`${dict.detail.retentionYears}: 2`}</span>
            <span className="retention-chip">{`${dict.detail.retentionUntil} (${dict.detail.sellerTabs.identity}): ${formatUiDate(
              profileRetentionUntil,
              language
            )}`}</span>
            <span className="retention-chip">{`${dict.detail.retentionUntil} (${dict.detail.trCompliance}): ${formatUiDate(
              complianceRetentionUntil,
              language
            )}`}</span>
            <span className="retention-chip">{`${dict.detail.retentionUntil} (${dict.detail.sellerTabs.foods}): ${formatUiDate(
              foodRetentionUntil,
              language
            )}`}</span>
            <span className="retention-chip">{`${dict.detail.legalHold}: ${Boolean(row.legalHoldState)}`}</span>
          </div>
        </section>
      ) : null}

      {activeTab === "security" ? (
        <section className="panel">
          <div className="panel-header">
            <h2>{dict.detail.sellerTabs.security}</h2>
          </div>
          <p className="panel-meta">{dict.detail.sectionPlanned}</p>
        </section>
      ) : null}

      {activeTab === "raw" ? (
        <section className="panel">
          <section className="seller-json-card">
            <div className="seller-json-header">
              <h2>{dict.detail.accountJson}</h2>
              <button
                className="ghost seller-json-copy"
                type="button"
                onClick={() => navigator.clipboard.writeText(JSON.stringify(sellerRawPayload, null, 2)).catch(() => undefined)}
              >
                {dict.detail.copyJson}
              </button>
            </div>
            <pre className="json-box">{JSON.stringify(sellerRawPayload, null, 2)}</pre>
          </section>
        </section>
      ) : null}

      {activeTab !== "identity" && activeTab !== "legal" && activeTab !== "foods" && activeTab !== "orders" && activeTab !== "wallet" && activeTab !== "retention" && activeTab !== "security" && activeTab !== "raw" ? (
        <section className="panel">
          <p className="panel-meta">{dict.detail.sectionPlanned}</p>
        </section>
      ) : null}
    </div>
  );
}


export default SellerDetailScreen;
