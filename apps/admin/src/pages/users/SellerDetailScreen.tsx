import { Fragment, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { request, parseJson } from "../../lib/api";
import { ExcelExportButton, PrintButton, QuickAccessMenu } from "../../components/ui";
import { NotesPanel } from "../../components/NotesPanel";
import { formatUiDate, maskEmail, formatCurrency, normalizeImageUrl, addTwoYears, sanitizeSeedText } from "../../lib/format";
import {
  initialsFromName,
  mapComplianceRows,
  profileBadgeFromStatus,
  sellerDocumentStatusLabel,
  sellerDocumentStatusTone,
  optionalUploadStatusLabel,
  optionalUploadStatusTone,
  extractPhoneFromChecks,
  knownDocumentCodeRank,
} from "../../lib/compliance";
import { resolveSellerDetailTab } from "../../lib/routing";
import { fetchAllAdminLots, computeFoodLotDiff, lotLifecycleClass, lotLifecycleLabel } from "../../lib/lots";
import { foodMetadataByName, resolveFoodIngredients } from "../../lib/food";
import { printModalContent } from "../../lib/print";
import type { Language, ApiError, Dictionary } from "../../types/core";
import type { SellerDetailTab } from "../../types/seller";
import type { SellerFoodRow, SellerCompliancePayload, SellerAddressRow, SellerComplianceStatus } from "../../types/seller";
import type { AdminLotRow, AdminLotOrderRow } from "../../types/lots";
import type { BuyerPagination } from "../../types/buyer";

function SellerDetailScreen({ id, isSuperAdmin, dict, language }: { id: string; isSuperAdmin: boolean; dict: Dictionary; language: Language }) {
  const location = useLocation();
  const endpoint = `/v1/admin/users/${id}`;
  const [row, setRow] = useState<any | null>(null);
  const [compliance, setCompliance] = useState<SellerCompliancePayload | null>(null);
  const [foodRows, setFoodRows] = useState<SellerFoodRow[]>([]);
  const [addresses, setAddresses] = useState<SellerAddressRow[]>([]);
  const [addressSaving, setAddressSaving] = useState(false);
  const [newAddressLine, setNewAddressLine] = useState("");
  const [addressDirty, setAddressDirty] = useState(false);
  const [addressEditorId, setAddressEditorId] = useState<string | null>(null);
  const [addressHistoryOpen, setAddressHistoryOpen] = useState(false);
  const [identityViewerOpen, setIdentityViewerOpen] = useState(false);
  const [identityViewerUrl, setIdentityViewerUrl] = useState<string | null>(null);
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
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [earningsDateFilter, setEarningsDateFilter] = useState<"all" | "last7" | "last30" | "custom">("all");
  const [earningsSelectedDate, setEarningsSelectedDate] = useState("");
  const [earningsPaymentFilter, setEarningsPaymentFilter] = useState<"all" | "successful" | "pending" | "failed">("successful");
  const [earningsSearch, setEarningsSearch] = useState("");
  const [selectedEarningIds, setSelectedEarningIds] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [legalSavingKey, setLegalSavingKey] = useState<string | null>(null);
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [optionalRejectTargetId, setOptionalRejectTargetId] = useState<string | null>(null);
  const [optionalRejectReason, setOptionalRejectReason] = useState("");
  const [profileImageFailed, setProfileImageFailed] = useState(false);
  const [, setFoodImageErrors] = useState<Record<string, boolean>>({});
  const [lotsByFoodId, setLotsByFoodId] = useState<Record<string, AdminLotRow[]>>({});
  const [lotOrdersByLotId, setLotOrdersByLotId] = useState<Record<string, AdminLotOrderRow[]>>({});
  const [expandedFoodIds, setExpandedFoodIds] = useState<Record<string, boolean>>({});
  const [expandedLotIds, setExpandedLotIds] = useState<Record<string, boolean>>({});
  const [noteItems, setNoteItems] = useState<Array<{ id: string; note: string; createdAt: string }>>([]);
  const [tagItems, setTagItems] = useState<string[]>([]);
  const [lotsLoading, setLotsLoading] = useState(false);
  const [lotsError, setLotsError] = useState<string | null>(null);
  const [lotOrdersLoadingByLotId, setLotOrdersLoadingByLotId] = useState<Record<string, boolean>>({});
  const [lotOrdersErrorByLotId, setLotOrdersErrorByLotId] = useState<Record<string, string | null>>({});
  const [flashFoodId, setFlashFoodId] = useState<string | null>(null);
  const [flashLotId, setFlashLotId] = useState<string | null>(null);
  const [pinnedFoodId, setPinnedFoodId] = useState<string | null>(null);
  const [pinnedLotId, setPinnedLotId] = useState<string | null>(null);
  const quickAccessRef = useRef<HTMLDetailsElement | null>(null);
  const identityModalPrintRef = useRef<HTMLDivElement | null>(null);
  const spiceHints = useMemo(() => ([
    "karabiber", "pul biber", "kimyon", "nane", "kekik", "isot", "paprika", "sumak", "tarcin", "yenibahar", "zerdecal",
  ]), []);
  const allergenHints = useMemo(() => ([
    "gluten", "un", "sut", "peynir", "yogurt", "yumurta", "balik", "karides", "midye", "susam", "fistik", "findik", "ceviz", "badem", "soya", "laktoz",
  ]), []);

  function splitFoodItems(value: string): string[] {
    return value
      .split(/[,;\n]/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  async function loadSellerDetail() {
    setLoading(true);
    setMessage(null);
    setLotsError(null);
    try {
      const [detailResponse, complianceResponse, foodsResponse, sellerOrdersResponse, addressesResponse, notesResponse, tagsResponse] = await Promise.all([
        request(endpoint),
        request(`/v1/admin/compliance/${id}`),
        request(`/v1/admin/users/${id}/seller-foods?page=1&pageSize=200&sortDir=desc`),
        request(`/v1/admin/users/${id}/seller-orders?page=1&pageSize=20&sortDir=desc`),
        request(`/v1/admin/users/${id}/addresses`),
        request(`/v1/admin/sellers/${id}/notes?limit=50`),
        request(`/v1/admin/sellers/${id}/tags`),
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

      if (addressesResponse.status === 200) {
        const addressesBody = await parseJson<{ data: SellerAddressRow[] }>(addressesResponse);
        setAddresses(Array.isArray(addressesBody.data) ? addressesBody.data : []);
      } else {
        setAddresses([]);
      }

      if (notesResponse.status === 200) {
        const body = await parseJson<{ data: Array<{ id: string; note: string; createdAt: string }> }>(notesResponse);
        setNoteItems(Array.isArray(body.data) ? body.data : []);
      } else {
        setNoteItems([]);
      }

      if (tagsResponse.status === 200) {
        const body = await parseJson<{ data: Array<{ id: string; tag: string }> }>(tagsResponse);
        setTagItems(Array.isArray(body.data) ? body.data.map((item) => item.tag) : []);
      } else {
        setTagItems([]);
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
    setNoteItems([]);
    setTagItems([]);
    setLotOrdersLoadingByLotId({});
    setLotOrdersErrorByLotId({});
    setLotsError(null);
    setFlashFoodId(null);
    setFlashLotId(null);
    setPinnedFoodId(null);
    setPinnedLotId(null);
    setAddresses([]);
    setAddressSaving(false);
    setNewAddressLine("");
    setAddressDirty(false);
    setAddressEditorId(null);
    setAddressHistoryOpen(false);
    setIdentityViewerOpen(false);
    setIdentityViewerUrl(null);
  }, [id]);

  useEffect(() => {
    if (addressDirty) return;
    const selected = addresses.find((item) => item.isDefault) ?? addresses[0] ?? null;
    setNewAddressLine(String(selected?.addressLine ?? ""));
    setAddressEditorId(selected?.id ?? null);
  }, [addresses, addressDirty]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const node = quickAccessRef.current;
      if (!node?.open) return;
      const target = event.target;
      if (target instanceof Node && !node.contains(target)) {
        node.open = false;
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const node = quickAccessRef.current;
      if (!node?.open) return;
      node.open = false;
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    setActiveTab(resolveSellerDetailTab(new URLSearchParams(location.search).get("tab")));
  }, [location.search]);

  const focusFoodId = useMemo(() => {
    const value = new URLSearchParams(location.search).get("focusFoodId");
    return value ? value.trim() : "";
  }, [location.search]);
  const focusLotId = useMemo(() => {
    const value = new URLSearchParams(location.search).get("focusLotId");
    return value ? value.trim() : "";
  }, [location.search]);

  useEffect(() => {
    if (activeTab !== "foods") return;

    let resolvedFoodId = focusFoodId;
    if (!resolvedFoodId && focusLotId) {
      for (const [foodId, lots] of Object.entries(lotsByFoodId)) {
        if (lots.some((lot) => lot.id === focusLotId)) {
          resolvedFoodId = foodId;
          break;
        }
      }
    }
    if (!resolvedFoodId) return;
    if (!foodRows.some((food) => food.id === resolvedFoodId)) return;

    setExpandedFoodIds((prev) => (prev[resolvedFoodId] ? prev : { ...prev, [resolvedFoodId]: true }));
    if (focusLotId) {
      setExpandedLotIds((prev) => (prev[focusLotId] ? prev : { ...prev, [focusLotId]: true }));
      void loadLotOrders(focusLotId);
    }

    setFlashFoodId(resolvedFoodId);
    setPinnedFoodId(resolvedFoodId);
    if (focusLotId) setFlashLotId(focusLotId);
    if (focusLotId) setPinnedLotId(focusLotId);

    const timer = window.setTimeout(() => {
      const lotElement = focusLotId ? document.querySelector<HTMLElement>(`[data-lot-row-id="${focusLotId}"]`) : null;
      const foodElement = document.querySelector<HTMLElement>(`[data-food-row-id="${resolvedFoodId}"]`);
      (lotElement ?? foodElement)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [activeTab, focusFoodId, focusLotId, foodRows, lotsByFoodId]);

  useEffect(() => {
    if (!flashFoodId) return;
    const timer = window.setTimeout(() => setFlashFoodId(null), 2200);
    return () => window.clearTimeout(timer);
  }, [flashFoodId]);

  useEffect(() => {
    if (!flashLotId) return;
    const timer = window.setTimeout(() => setFlashLotId(null), 2200);
    return () => window.clearTimeout(timer);
  }, [flashLotId]);

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isSuperAdmin) return;
    const formData = new FormData(event.currentTarget);
    const submittedLanguage = formData.get("language");
    const payload: Record<string, string | null> = {
      email: String(formData.get("email") ?? "").trim(),
      displayName: String(formData.get("displayName") ?? "").trim(),
      fullName: String(formData.get("fullName") ?? "").trim() || null,
      phone: String(formData.get("phone") ?? "").trim() || null,
      dob: String(formData.get("dob") ?? "").trim() || null,
      countryCode: String(formData.get("countryCode") ?? "").trim().toUpperCase() || null,
      language: submittedLanguage === null ? (row?.language ?? null) : String(submittedLanguage).trim() || null,
      profileImageUrl: String(formData.get("profileImageUrl") ?? "").trim() || null,
    };
    if (!payload.email || !payload.displayName) {
      setMessage(language === "tr" ? "E-posta ve görünen ad zorunludur." : "Email and display name are required.");
      return;
    }
    const password = String(formData.get("password") ?? "").trim();
    if (password) {
      if (password.length < 8) {
        setMessage(language === "tr" ? "Şifre en az 8 karakter olmalı." : "Password must be at least 8 characters.");
        return;
      }
      payload.password = password;
    }
    const update = await request(endpoint, { method: "PUT", body: JSON.stringify(payload) });
    if (update.status !== 200) {
      const body = await parseJson<ApiError>(update);
      setMessage(body.error?.message ?? dict.detail.updateFailed);
      return;
    }
    const updated = await parseJson<{ data: any }>(update);
    setRow(updated.data);
    setMessage(dict.common.saved);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  async function createAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isSuperAdmin || addressSaving) return;
    const addressLine = newAddressLine.trim();
    if (!addressLine) {
      setMessage(language === "tr" ? "Adres zorunludur." : "Address is required.");
      return;
    }
    setAddressSaving(true);
    setMessage(null);
    const currentAddress = (addressEditorId ? addresses.find((item) => item.id === addressEditorId) : null)
      ?? addresses.find((item) => item.isDefault)
      ?? addresses[0]
      ?? null;
    try {
      const response = currentAddress
        ? await request(`/v1/admin/users/${id}/addresses/${currentAddress.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              title: currentAddress.title || (language === "tr" ? "Adres" : "Address"),
              addressLine,
              isDefault: currentAddress.isDefault,
            }),
          })
        : await request(`/v1/admin/users/${id}/addresses`, {
            method: "POST",
            body: JSON.stringify({
              title: language === "tr" ? "Adres" : "Address",
              addressLine,
              isDefault: false,
            }),
          });
      const successCode = currentAddress ? 200 : 201;
      if (response.status !== successCode) {
        const body = await parseJson<ApiError>(response);
        setMessage(body.error?.message ?? dict.detail.requestFailed);
        return;
      }
      setAddressDirty(false);
      await loadSellerDetail();
      setMessage(dict.common.saved);
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    } catch {
      setMessage(dict.detail.requestFailed);
    } finally {
      setAddressSaving(false);
    }
  }

  function onEnterSubmit(event: ReactKeyboardEvent<HTMLFormElement>) {
    if (event.key !== "Enter") return;
    if (event.target instanceof HTMLTextAreaElement) return;
    event.preventDefault();
    event.currentTarget.requestSubmit();
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

  const toLocalDateKey = (value: string | null | undefined) => {
    const date = new Date(String(value ?? ""));
    if (Number.isNaN(date.getTime())) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
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
        if (earningsDateFilter === "custom" && earningsSelectedDate) {
          if (toLocalDateKey(order.createdAt) !== earningsSelectedDate) return false;
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
  }, [sellerOrders, earningsDateFilter, earningsSelectedDate, earningsPaymentFilter, earningsSearch, language]);

  const selectedFilteredOrders = useMemo(
    () => filteredSellerOrders.filter((order) => selectedOrderIds.includes(order.orderId)),
    [filteredSellerOrders, selectedOrderIds]
  );
  const selectedFilteredEarnings = useMemo(
    () => filteredSellerEarnings.filter((order) => selectedEarningIds.includes(order.orderId)),
    [filteredSellerEarnings, selectedEarningIds]
  );

  const allFilteredOrdersSelected = filteredSellerOrders.length > 0 && filteredSellerOrders.every((order) => selectedOrderIds.includes(order.orderId));
  const allFilteredEarningsSelected = filteredSellerEarnings.length > 0 && filteredSellerEarnings.every((order) => selectedEarningIds.includes(order.orderId));

  useEffect(() => {
    const visible = new Set(filteredSellerOrders.map((order) => order.orderId));
    setSelectedOrderIds((prev) => prev.filter((id) => visible.has(id)));
  }, [filteredSellerOrders]);

  useEffect(() => {
    const visible = new Set(filteredSellerEarnings.map((order) => order.orderId));
    setSelectedEarningIds((prev) => prev.filter((id) => visible.has(id)));
  }, [filteredSellerEarnings]);

  function printIdentityDetails() {
    if (!identityViewerOpen) return;
    printModalContent(identityModalPrintRef.current);
  }

  if (loading && !row) return <div className="panel">{dict.common.loading}</div>;
  if (!row) return <div className="panel">{message ?? dict.common.noRecords}</div>;

  const isActive = row.status === "active";
  const accountStatusLabel = isActive ? dict.common.active : dict.common.disabled;
  const phone = String(row.phone ?? extractPhoneFromChecks(compliance) ?? "").trim();
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
  const contactEmail = String(row.email ?? "").trim();
  const contactPhone = phone;
  const contactPhoneHrefValue = contactPhone.replace(/[^\d+]/g, "");
  const contactHasPhone = contactPhoneHrefValue.length > 0;
  const contactSmsBody = encodeURIComponent(language === "tr" ? "Merhaba" : "Hello");

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
  const identityDocuments = (() => {
    const isIdentityCode = (value: string) => {
      const code = value.toLocaleLowerCase(language === "tr" ? "tr-TR" : "en-US");
      return (
        code.includes("kimlik") ||
        code.includes("identity") ||
        code.includes("id_card") ||
        code.includes("idcard") ||
        code.includes("passport") ||
        code.includes("selfie")
      );
    };
    const fromLegal = legalDocuments
      .filter((row) => Boolean(row.file_url) && (isIdentityCode(row.code) || isIdentityCode(row.name)))
      .map((row) => ({
        id: row.id,
        label: row.name,
        url: String(row.file_url),
      }));
    const fromOptional = optionalUploads
      .filter((row) => {
        const title = `${row.catalog_doc_name ?? ""} ${row.custom_title ?? ""} ${row.catalog_doc_code ?? ""}`;
        return Boolean(row.file_url) && isIdentityCode(title);
      })
      .map((row) => ({
        id: `optional-${row.id}`,
        label: row.catalog_doc_name ?? row.custom_title ?? (language === "tr" ? "Kimlik Dosyası" : "Identity File"),
        url: row.file_url,
      }));
    return [...fromLegal, ...fromOptional];
  })();
  const selectedIdentityDocument =
    identityDocuments.find((row) => row.url === identityViewerUrl) ?? identityDocuments[0] ?? null;
  const selectedIdentityDocumentIsPdf = /\.pdf(?:$|\?)/i.test(String(selectedIdentityDocument?.url ?? ""));
  const legalSaving = legalSavingKey !== null;
  const isSavingDoc = (docId: string) => legalSavingKey === `doc:${docId}`;
  const isSavingOptional = (uploadId: string) => legalSavingKey === `optional:${uploadId}`;
  const isSavingDocType = (docTypeCode: string) => legalSavingKey === `dtype:${docTypeCode}`;

  function recomputeProfile(
    documents: SellerCompliancePayload["documents"],
    prev: SellerCompliancePayload["profile"]
  ): SellerCompliancePayload["profile"] {
    const required = documents.filter((d) => d.is_required);
    const requiredCount = required.length;
    const approvedRequired = required.filter((d) => d.status === "approved").length;
    const uploadedRequired = required.filter((d) => d.status === "uploaded").length;
    const requestedRequired = required.filter((d) => d.status === "requested").length;
    const rejectedRequired = required.filter((d) => d.status === "rejected").length;
    let status: SellerComplianceStatus;
    if (requiredCount === 0) status = "not_started";
    else if (rejectedRequired > 0) status = "rejected";
    else if (approvedRequired === requiredCount) status = "approved";
    else if (requestedRequired > 0) status = "in_progress";
    else status = "under_review";
    return {
      ...prev,
      status,
      required_count: requiredCount,
      approved_required_count: approvedRequired,
      uploaded_required_count: uploadedRequired,
      requested_required_count: requestedRequired,
      rejected_required_count: rejectedRequired,
    };
  }

  async function refreshComplianceOnly() {
    const response = await request(`/v1/admin/compliance/${id}`);
    if (response.status !== 200) return;
    const body = await parseJson<{ data: SellerCompliancePayload }>(response);
    setCompliance(body.data);
  }

  async function updateDocumentStatus(documentId: string, status: "requested" | "approved" | "rejected", rejectionReasonInput?: string) {
    setLegalSavingKey(`doc:${documentId}`);
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
      setCompliance((prev) => {
        if (!prev) return prev;
        const nowIso = new Date().toISOString();
        const updatedDocuments = prev.documents.map((item) =>
          item.id === documentId
            ? {
                ...item,
                status,
                rejection_reason: status === "rejected" ? (rejectionReasonInput ?? null) : null,
                reviewed_at: status === "approved" || status === "rejected" ? nowIso : null,
                updated_at: nowIso,
              }
            : item
        );
        return {
          ...prev,
          documents: updatedDocuments,
          profile: recomputeProfile(updatedDocuments, prev.profile),
        };
      });
      void refreshComplianceOnly();
      setMessage(dict.common.saved);
      setRejectTargetId(null);
      setRejectReason("");
      setOptionalRejectTargetId(null);
      setOptionalRejectReason("");
    } catch {
      setMessage(dict.detail.requestFailed);
    } finally {
      setLegalSavingKey(null);
    }
  }

  async function updateOptionalUploadStatus(uploadId: string, status: "uploaded" | "approved" | "rejected", rejectionReasonInput?: string) {
    setLegalSavingKey(`optional:${uploadId}`);
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
      setCompliance((prev) => {
        if (!prev) return prev;
        const nowIso = new Date().toISOString();
        return {
          ...prev,
          optionalUploads: prev.optionalUploads.map((item) =>
            item.id === uploadId
              ? {
                  ...item,
                  status,
                  rejection_reason: status === "rejected" ? (rejectionReasonInput ?? null) : null,
                  reviewed_at: status === "approved" || status === "rejected" ? nowIso : null,
                  updated_at: nowIso,
                }
              : item
          ),
        };
      });
      void refreshComplianceOnly();
      setMessage(dict.common.saved);
      setOptionalRejectTargetId(null);
      setOptionalRejectReason("");
    } catch {
      setMessage(dict.detail.requestFailed);
    } finally {
      setLegalSavingKey(null);
    }
  }

  async function updateDocumentRequired(docTypeCode: string, required: boolean) {
    setLegalSavingKey(`dtype:${docTypeCode}`);
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
      setCompliance((prev) => {
        if (!prev) return prev;
        const nowIso = new Date().toISOString();
        const updatedDocuments = prev.documents.map((item) =>
          item.code === docTypeCode
            ? {
                ...item,
                is_required: required,
                updated_at: nowIso,
              }
            : item
        );
        return {
          ...prev,
          documents: updatedDocuments,
          profile: recomputeProfile(updatedDocuments, prev.profile),
        };
      });
      void refreshComplianceOnly();
      setMessage(dict.common.saved);
    } catch {
      setMessage(dict.detail.requestFailed);
    } finally {
      setLegalSavingKey(null);
    }
  }

  function downloadSellerOrdersAsExcel() {
    if (selectedFilteredOrders.length === 0) {
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
    const rowsForExport = selectedFilteredOrders.map((order) => {
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
    if (selectedFilteredEarnings.length === 0) {
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
    const rowsForExport = selectedFilteredEarnings.map((order) => [
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

  async function handleAddNote(text: string): Promise<void> {
    try {
      const response = await request(`/v1/admin/sellers/${id}/notes`, {
        method: "POST",
        body: JSON.stringify({ note: text }),
      });
      if (response.status >= 200 && response.status < 300) {
        const body = await parseJson<{ data?: { id: string; note: string; createdAt: string } } & ApiError>(response);
        if (body.data?.id) {
          setNoteItems((prev) => [body.data as { id: string; note: string; createdAt: string }, ...prev]);
        } else {
          await loadSellerDetail();
        }
      } else {
        setMessage(language === "tr" ? "Not kaydedilemedi." : "Failed to save note.");
      }
    } catch {
      setMessage(language === "tr" ? "Not kaydedilemedi." : "Failed to save note.");
    }
  }

  async function handleAddTag(tag: string): Promise<void> {
    try {
      const response = await request(`/v1/admin/sellers/${id}/tags`, {
        method: "POST",
        body: JSON.stringify({ tag }),
      });
      if (response.status >= 200 && response.status < 300) {
        if (!tagItems.includes(tag)) {
          setTagItems((prev) => [tag, ...prev].slice(0, 16));
        }
      } else {
        setMessage(language === "tr" ? "Etiket kaydedilemedi." : "Failed to save tag.");
      }
    } catch {
      setMessage(language === "tr" ? "Etiket kaydedilemedi." : "Failed to save tag.");
    }
  }

  async function handleDeleteTag(tag: string): Promise<void> {
    try {
      const response = await request(`/v1/admin/sellers/${id}/tags`, {
        method: "DELETE",
        body: JSON.stringify({ tag }),
      });
      if (response.status === 204) {
        setTagItems((prev) => prev.filter((item) => item !== tag));
      } else {
        setMessage(language === "tr" ? "Etiket silinemedi." : "Failed to delete tag.");
      }
    } catch {
      setMessage(language === "tr" ? "Etiket silinemedi." : "Failed to delete tag.");
    }
  }

  async function handleDeleteNote(noteId: string): Promise<void> {
    try {
      const response = await request(`/v1/admin/sellers/${id}/notes/${noteId}`, { method: "DELETE" });
      if (response.status === 204) {
        setNoteItems((prev) => prev.filter((item) => item.id !== noteId));
      } else {
        setMessage(language === "tr" ? "Not silinemedi." : "Failed to delete note.");
      }
    } catch {
      setMessage(language === "tr" ? "Not silinemedi." : "Failed to delete note.");
    }
  }

  async function handleSaveNote(noteId: string, newText: string): Promise<void> {
    try {
      const response = await request(`/v1/admin/sellers/${id}/notes/${noteId}`, {
        method: "PATCH",
        body: JSON.stringify({ note: newText }),
      });
      if (response.status === 200) {
        const body = await parseJson<{ data?: { id: string; note: string; createdAt: string } } & ApiError>(response);
        if (body.data?.id) {
          setNoteItems((prev) => prev.map((item) => (item.id === noteId ? (body.data as { id: string; note: string; createdAt: string }) : item)));
        }
        return;
      }
      setMessage(language === "tr" ? "Not güncellenemedi." : "Failed to update note.");
    } catch {
      setMessage(language === "tr" ? "Not güncellenemedi." : "Failed to update note.");
    }
  }

  const sellerRawPayload = {
    id: row.id,
    user: row,
    addresses,
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
    generalProfileSnapshot: {
      customerId: row.id,
      email: row.email ?? null,
      displayName: row.displayName ?? null,
      fullName: row.fullName ?? null,
      phone: row.phone ?? null,
      dob: row.dob ?? null,
      countryCode: row.countryCode ?? null,
      language: row.language ?? null,
      profileImageUrl: row.profileImageUrl ?? row.profile_image_url ?? null,
      createdAt: row.createdAt ?? null,
      updatedAt: row.updatedAt ?? null,
      status: row.status ?? null,
      role: row.role ?? null,
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
    { key: "notes", label: dict.detail.sellerTabs.notes },
    { key: "raw", label: dict.detail.sellerTabs.raw },
  ] as const;
  const canExportActiveSellerTab = activeTab === "orders" || activeTab === "wallet";
  const exportActiveSellerTabAsExcel = () => {
    if (activeTab === "orders") {
      downloadSellerOrdersAsExcel();
      return;
    }
    if (activeTab === "wallet") {
      downloadSellerEarningsAsExcel();
    }
  };

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
          </div>
          <div className="seller-hero-text">
            <div className="seller-hero-title-stack">
              <div className="seller-hero-title-row">
                <h1>{row.displayName ?? row.email}</h1>
                <span className={`seller-account-status ${isActive ? "is-active" : "is-disabled"}`}>{accountStatusLabel}</span>
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
          </div>
        </article>
        <div className="seller-hero-right">
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
          <QuickAccessMenu
            ref={quickAccessRef}
            language={language}
            email={contactEmail}
            phoneHrefValue={contactHasPhone ? contactPhoneHrefValue : ""}
            smsBody={contactSmsBody}
          />
        </div>
      </section>

      <section className="panel seller-tabs-panel">
        <div className="seller-tabs-head">
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
          <ExcelExportButton
            className="primary seller-tabs-export-btn"
            type="button"
            onClick={exportActiveSellerTabAsExcel}
            disabled={!canExportActiveSellerTab}
            language={language}
          />
        </div>
      </section>

      {activeTab === "general" ? (
        <section className="panel seller-general-panel">
          <div className="seller-general-grid">
            <article className="seller-general-card">
              <div className="panel-header">
                <h2>{language === "tr" ? "Kimlik Kartı" : "Identity Card"}</h2>
              </div>
              <div className="seller-id-lines">
                <button
                  className="seller-id-line"
                  type="button"
                  onClick={() => navigator.clipboard.writeText(String(row.id ?? "")).catch(() => undefined)}
                  title={language === "tr" ? "Customer ID kopyala" : "Copy customer ID"}
                >
                  <span className="seller-id-line-text">
                    <span className="seller-id-line-label">{language === "tr" ? "Customer ID" : "Customer ID"}:</span>
                    <strong className="seller-id-line-value">{String(row.id ?? "-")}</strong>
                  </span>
                  <span aria-hidden="true">⧉</span>
                </button>
              </div>
              <div className="seller-general-kv">
                <div>
                  <span>{language === "tr" ? "Rol" : "Role"}</span>
                  <strong>{roleLabel}</strong>
                </div>
                <div>
                  <span>{language === "tr" ? "Kayıt" : "Created"}</span>
                  <strong>{formatUiDate(row.createdAt, language)}</strong>
                </div>
              </div>
              <form className="seller-address-create-form seller-address-inline-create" onSubmit={createAddress} onKeyDown={onEnterSubmit}>
                <div className="seller-address-title-row">
                  <h3>{language === "tr" ? "Yeni Adres" : "New Address"}</h3>
                  <button
                    className="ghost seller-address-plus"
                    type="button"
                    onClick={() => setAddressHistoryOpen((prev) => !prev)}
                    title={language === "tr" ? "Eski adresleri göster" : "Show saved addresses"}
                  >
                    +
                  </button>
                </div>
                {addresses[0]?.addressLine ? (
                  <p className="panel-meta seller-address-preview">
                    {language === "tr" ? "Son kayıtlı adres" : "Last saved address"}: {addresses[0].addressLine}
                  </p>
                ) : null}
                {addressHistoryOpen ? (
                  <div className="seller-address-history-list">
                    {addresses.length === 0 ? (
                      <p className="panel-meta">{language === "tr" ? "Kayıtlı adres yok." : "No saved addresses."}</p>
                    ) : (
                      addresses.map((address) => (
                        <button
                          key={address.id}
                          type="button"
                          className={`ghost seller-address-history-item ${addressEditorId === address.id ? "is-active" : ""}`}
                          onClick={() => {
                            setAddressEditorId(address.id);
                            setNewAddressLine(address.addressLine);
                            setAddressDirty(true);
                          }}
                        >
                          {address.addressLine}
                        </button>
                      ))
                    )}
                    <button
                      type="button"
                      className="ghost seller-address-history-item"
                      onClick={() => {
                        setAddressEditorId(null);
                        setNewAddressLine("");
                        setAddressDirty(true);
                      }}
                    >
                      {language === "tr" ? "Yeni adres girişi" : "New address entry"}
                    </button>
                  </div>
                ) : null}
                <label className="ghost seller-detail-filter-item seller-general-filter-item">
                  <span>{language === "tr" ? "Adres" : "Address"}</span>
                  <input
                    value={newAddressLine}
                    onChange={(event) => {
                      setNewAddressLine(event.target.value);
                      setAddressDirty(true);
                    }}
                    placeholder=" "
                    disabled={!isSuperAdmin || addressSaving}
                  />
                </label>
                <button className="primary" type="submit" disabled={!isSuperAdmin || addressSaving}>
                  {addressEditorId ? (language === "tr" ? "Adresi Güncelle" : "Update Address") : language === "tr" ? "Adres Ekle" : "Add Address"}
                </button>
              </form>
            </article>

            <article className="seller-general-card">
              <div className="seller-profile-head compact">
                <strong>{String(row.displayName ?? "-")}</strong>
                <span className="seller-inline-status">
                  <span className={`seller-status-dot ${isActive ? "is-active" : "is-disabled"}`} aria-hidden="true" />
                  {accountStatusLabel}
                </span>
              </div>
              <form className="form-grid seller-general-form" onSubmit={onSave} onKeyDown={onEnterSubmit}>
                <label className="ghost seller-detail-filter-item seller-general-filter-item">
                  <span>{language === "tr" ? "Görünen Ad" : "Display Name"}</span>
                  <input name="displayName" defaultValue={String(row.displayName ?? "")} placeholder=" " disabled={!isSuperAdmin} required minLength={3} />
                </label>
                <label className="ghost seller-detail-filter-item seller-general-filter-item">
                  <span>{dict.auth.email}</span>
                  <input name="email" type="email" defaultValue={String(row.email ?? "")} placeholder=" " disabled={!isSuperAdmin} required />
                </label>
                <label className="ghost seller-detail-filter-item seller-general-filter-item">
                  <span>{language === "tr" ? "Ad Soyad" : "Full Name"}</span>
                  <input name="fullName" defaultValue={String(row.fullName ?? "")} placeholder=" " disabled={!isSuperAdmin} />
                </label>
                <label className="ghost seller-detail-filter-item seller-general-filter-item">
                  <span>{language === "tr" ? "Telefon" : "Phone"}</span>
                  <input name="phone" defaultValue={String(row.phone ?? "")} placeholder=" " disabled={!isSuperAdmin} />
                </label>
                <label className="ghost seller-detail-filter-item seller-general-filter-item">
                  <span>{language === "tr" ? "Doğum Tarihi" : "Date of Birth"}</span>
                  <input name="dob" type="date" defaultValue={String(row.dob ?? "").slice(0, 10)} placeholder=" " disabled={!isSuperAdmin} />
                </label>
                <label className="ghost seller-detail-filter-item seller-general-filter-item">
                  <span>{language === "tr" ? "Ülke Kodu" : "Country Code"}</span>
                  <input name="countryCode" maxLength={3} defaultValue={String(row.countryCode ?? "")} placeholder=" " disabled={!isSuperAdmin} />
                </label>
                <input type="hidden" name="profileImageUrl" value={String(row.profileImageUrl ?? row.profile_image_url ?? "")} />
                <label className="ghost seller-detail-filter-item seller-general-filter-item">
                  <span>{dict.detail.passwordOptional}</span>
                  <input name="password" type="password" placeholder=" " disabled={!isSuperAdmin} />
                </label>
                <div className="seller-profile-actions-grid">
                  <button
                    className="ghost seller-profile-action-btn"
                    type="button"
                    onClick={() => {
                      setIdentityViewerUrl(identityDocuments[0]?.url ?? null);
                      setIdentityViewerOpen(true);
                    }}
                  >
                    {language === "tr" ? "Kimlik Detayını Gör" : "View Identity Details"}
                  </button>
                  <button className="primary seller-profile-action-btn" type="submit" disabled={!isSuperAdmin}>
                    {dict.actions.save}
                  </button>
                </div>
              </form>
              {!isSuperAdmin ? <p className="panel-meta">{dict.detail.readOnly}</p> : null}
            </article>

          </div>
        </section>
      ) : null}
      {identityViewerOpen ? (
        <div className="buyer-ops-modal-backdrop">
          <div ref={identityModalPrintRef} className="buyer-ops-modal seller-doc-viewer-modal print-target-modal">
            <h3>Kimlik Dosyaları</h3>
            {identityDocuments.length === 0 ? (
              <p className="panel-meta">Kimlik dosyası bulunamadı.</p>
            ) : (
              <div className="seller-doc-viewer-grid">
                <div className="seller-doc-viewer-list">
                  {identityDocuments.map((doc) => (
                    <button
                      key={doc.id}
                      className={`ghost ${doc.url === selectedIdentityDocument?.url ? "is-active" : ""}`}
                      type="button"
                      onClick={() => setIdentityViewerUrl(doc.url)}
                    >
                      {doc.label}
                    </button>
                  ))}
                </div>
                <div className="seller-doc-viewer-preview">
                  {selectedIdentityDocument ? (
                    selectedIdentityDocumentIsPdf ? (
                      <iframe src={selectedIdentityDocument.url} title={selectedIdentityDocument.label} />
                    ) : (
                      <img src={selectedIdentityDocument.url} alt={selectedIdentityDocument.label} />
                    )
                  ) : (
                    <p className="panel-meta">Görüntülenecek dosya yok.</p>
                  )}
                </div>
              </div>
            )}
            <div className="buyer-ops-modal-actions">
              {selectedIdentityDocument ? (
                <a className="ghost" href={selectedIdentityDocument.url} target="_blank" rel="noreferrer">
                  Yeni Sekmede Aç
                </a>
              ) : null}
              <PrintButton className="ghost" type="button" onClick={printIdentityDetails} language="tr" />
              <button className="primary" type="button" onClick={() => setIdentityViewerOpen(false)}>
                Kapat
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
                                  disabled={!isSuperAdmin || isSavingDocType(row.code)}
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
                                  disabled={!isSuperAdmin || isSavingDoc(row.id)}
                                  onClick={() => void updateDocumentStatus(row.id, "approved")}
                                >
                                  {dict.detail.legalApprove}
                                </button>
                                <button
                                  className="ghost compliance-edit-btn"
                                  type="button"
                                  disabled={!isSuperAdmin || isSavingDoc(row.id)}
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
                                  disabled={!isSuperAdmin || isSavingDoc(row.id)}
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
                                  disabled={!isSuperAdmin || isSavingOptional(row.id) || row.status === "archived"}
                                  onClick={() => void updateOptionalUploadStatus(row.id, "approved")}
                                >
                                  {dict.detail.legalApprove}
                                </button>
                                <button
                                  className="ghost compliance-edit-btn"
                                  type="button"
                                  disabled={!isSuperAdmin || isSavingOptional(row.id) || row.status === "archived"}
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
                                  disabled={!isSuperAdmin || isSavingOptional(row.id) || row.status === "archived"}
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
            <div
              className="buyer-ops-modal-backdrop"
              role="dialog"
              aria-modal="true"
              aria-label={dict.detail.legalRejectModalTitle}
              onClick={() => {
                if (legalSaving) return;
                setRejectTargetId(null);
                setRejectReason("");
              }}
            >
              <div className="buyer-ops-modal" onClick={(event) => event.stopPropagation()}>
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
            <div
              className="buyer-ops-modal-backdrop"
              role="dialog"
              aria-modal="true"
              aria-label={dict.detail.optionalRejectModalTitle}
              onClick={() => {
                if (legalSaving) return;
                setOptionalRejectTargetId(null);
                setOptionalRejectReason("");
              }}
            >
              <div className="buyer-ops-modal" onClick={(event) => event.stopPropagation()}>
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
                    <th>{dict.detail.lotActions}</th>
                    <th>{dict.detail.foodName}</th>
                    <th>{dict.detail.foodStatus}</th>
                    <th>{dict.detail.foodPrice}</th>
                    <th>{dict.detail.updatedAtLabel}</th>
                    <th>{dict.detail.lotSummary}</th>
                  </tr>
                </thead>
                <tbody>
                  {foodRows.map((food) => {
                    const isActiveFood = food.status === "active";
                    const foodLots = lotsByFoodId[food.id] ?? [];
                    const activeLots = foodLots.filter((lot) => lot.lifecycle_status === "on_sale").length;
                    const recalledLots = foodLots.filter((lot) => lot.lifecycle_status === "recalled").length;
                    const foodExpanded = Boolean(expandedFoodIds[food.id]);
                    const metadata = foodMetadataByName(food.name);
                    const ingredientsText = sanitizeSeedText(resolveFoodIngredients(food.ingredients, food.recipe, metadata?.ingredients ?? null, language)) ?? "";
                    const ingredientItems = splitFoodItems(ingredientsText);
                    const lowerIngredients = ingredientItems.map((item) => item.toLocaleLowerCase("tr-TR"));
                    const spices = ingredientItems.filter((item, index) => spiceHints.some((hint) => lowerIngredients[index].includes(hint)));
                    const allergens = ingredientItems.filter((item, index) => allergenHints.some((hint) => lowerIngredients[index].includes(hint)));
                    return (
                      <Fragment key={food.id}>
                        <tr
                          data-food-row-id={food.id}
                          className={[
                            "foods-main-row",
                            flashFoodId === food.id ? "search-focus-flash" : "",
                            pinnedFoodId === food.id ? "search-focus-pinned" : "",
                          ].filter(Boolean).join(" ") || undefined}
                        >
                          <td>
                            <button
                              className="ghost foods-toggle-btn"
                              type="button"
                              aria-label={foodExpanded ? dict.detail.hideLots : dict.detail.showLots}
                              onClick={() => setExpandedFoodIds((prev) => ({ ...prev, [food.id]: !prev[food.id] }))}
                            >
                              {foodExpanded ? "−" : "+"}
                            </button>
                          </td>
                          <td>
                            <strong>{`${food.name} (${food.code || "-"})`}</strong>
                            <div className="panel-meta">
                              <strong className="seller-food-subheading">{language === "tr" ? "Malzemeler:" : "Ingredients:"}</strong>{" "}
                              {ingredientItems.length > 0 ? ingredientItems.join(", ") : (language === "tr" ? "Belirtilmemiş" : "Not specified")}
                            </div>
                            <div className="panel-meta">
                              <strong className="seller-food-subheading">{language === "tr" ? "Baharatlar:" : "Spices:"}</strong>{" "}
                              {spices.length > 0 ? spices.join(", ") : "-"}
                            </div>
                            <div className="panel-meta">
                              <strong className="seller-food-subheading">{language === "tr" ? "Alerjenler:" : "Allergens:"}</strong>{" "}
                              {allergens.length > 0 ? allergens.join(", ") : "-"}
                            </div>
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
                        </tr>
                        {foodExpanded ? (
                          <tr className="foods-lots-expanded-row">
                            <td colSpan={6}>
                              <div className="seller-food-codes-card">
                                <strong>{language === "tr" ? "Kodlar & Yemek ID" : "Codes & Food ID"}</strong>
                                <div className="seller-food-codes-list">
                                  <span className="seller-food-code-chip is-id">{`ID: ${food.id}`}</span>
                                  <span className="seller-food-code-chip is-food">{`${language === "tr" ? "Yemek Kodu" : "Food Code"}: ${food.code || "-"}`}</span>
                                  {foodLots.map((lot) => (
                                    <span key={`code-${food.id}-${lot.id}`} className="seller-food-code-chip is-lot">{`${language === "tr" ? "Lot" : "Lot"}: ${lot.lot_number}`}</span>
                                  ))}
                                </div>
                              </div>
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
                                            <tr
                                              data-lot-row-id={lot.id}
                                              className={[
                                                flashLotId === lot.id ? "search-focus-flash" : "",
                                                pinnedLotId === lot.id ? "search-focus-pinned" : "",
                                              ].filter(Boolean).join(" ") || undefined}
                                            >
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
                                                              <td>
                                                                <Link className="inline-copy" to={`/app/orders?search=${encodeURIComponent(order.order_id)}`}>
                                                                  {`#${order.order_id.slice(0, 8).toUpperCase()}`}
                                                                </Link>
                                                              </td>
                                                              <td>{order.status}</td>
                                                              <td>
                                                                {order.buyer_id ? (
                                                                  <Link className="inline-copy" to={`/app/buyers/${order.buyer_id}`}>
                                                                    {order.buyer_id}
                                                                  </Link>
                                                                ) : "-"}
                                                              </td>
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
              />
            </label>
          </div>
          {filteredSellerOrders.length === 0 ? (
            <p className="panel-meta">{dict.common.noRecords}</p>
          ) : (
            <>
              <div className="buyer-ops-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          checked={allFilteredOrdersSelected}
                          onChange={(event) => {
                            if (event.target.checked) {
                              setSelectedOrderIds(filteredSellerOrders.map((order) => order.orderId));
                            } else {
                              setSelectedOrderIds([]);
                            }
                          }}
                          aria-label={language === "tr" ? "Tum siparisleri sec" : "Select all orders"}
                        />
                      </th>
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
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedOrderIds.includes(order.orderId)}
                              onChange={(event) => {
                                setSelectedOrderIds((prev) => {
                                  if (event.target.checked) return [...new Set([...prev, order.orderId])];
                                  return prev.filter((id) => id !== order.orderId);
                                });
                              }}
                              aria-label={language === "tr" ? "Siparisi sec" : "Select order"}
                            />
                          </td>
                          <td>{formatUiDate(order.createdAt, language)}</td>
                          <td>
                            <Link className="inline-copy" to={`/app/orders?search=${encodeURIComponent(order.orderId)}`}>
                              {order.orderNo}
                            </Link>
                          </td>
                          <td>
                            {order.buyerId ? (
                              <Link className="inline-copy" to={`/app/buyers/${order.buyerId}`}>
                                {order.buyerName ?? order.buyerEmail ?? order.buyerId}
                              </Link>
                            ) : (order.buyerName ?? order.buyerEmail ?? "-")}
                          </td>
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
                {`${filteredSellerOrders.length} ${language === "tr" ? "sipariş" : "orders"} • ${selectedFilteredOrders.length} ${language === "tr" ? "seçili" : "selected"}`}
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
                <option value="custom">{language === "tr" ? "Tarih Seç" : "Pick Date"}</option>
              </select>
            </label>
            {earningsDateFilter === "custom" ? (
              <label className="ghost seller-detail-filter-item">
                <span>{language === "tr" ? "Tarih" : "Date"}</span>
                <input
                  type="date"
                  value={earningsSelectedDate}
                  onChange={(event) => setEarningsSelectedDate(event.target.value)}
                  aria-label={language === "tr" ? "Tarih seç" : "Select date"}
                />
              </label>
            ) : null}
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
              />
            </label>
          </div>
          {filteredSellerEarnings.length === 0 ? (
            <p className="panel-meta">{dict.common.noRecords}</p>
          ) : (
            <>
              <div className="buyer-ops-table-wrap seller-wallet-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          checked={allFilteredEarningsSelected}
                          onChange={(event) => {
                            if (event.target.checked) {
                              setSelectedEarningIds(filteredSellerEarnings.map((order) => order.orderId));
                            } else {
                              setSelectedEarningIds([]);
                            }
                          }}
                          aria-label={language === "tr" ? "Tum kazanc kayitlarini sec" : "Select all earnings"}
                        />
                      </th>
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
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedEarningIds.includes(order.orderId)}
                            onChange={(event) => {
                              setSelectedEarningIds((prev) => {
                                if (event.target.checked) return [...new Set([...prev, order.orderId])];
                                return prev.filter((id) => id !== order.orderId);
                              });
                            }}
                            aria-label={language === "tr" ? "Kazanc kaydini sec" : "Select earning"}
                          />
                        </td>
                        <td>{formatUiDate(order.createdAt, language)}</td>
                        <td>
                          <Link className="inline-copy" to={`/app/orders?search=${encodeURIComponent(order.orderId)}`}>
                            {order.orderNo}
                          </Link>
                        </td>
                        <td>
                          {order.buyerId ? (
                            <Link className="inline-copy" to={`/app/buyers/${order.buyerId}`}>
                              {order.buyerName ?? order.buyerEmail ?? order.buyerId}
                            </Link>
                          ) : (order.buyerName ?? order.buyerEmail ?? "-")}
                        </td>
                        <td>{paymentStateText(order.paymentStatus)}</td>
                        <td>{formatCurrency(Number(order.totalAmount ?? 0), language)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="panel-meta">{`${filteredSellerEarnings.length} ${language === "tr" ? "kayıt" : "records"} • ${selectedFilteredEarnings.length} ${language === "tr" ? "seçili" : "selected"}`}</p>
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

      {activeTab === "notes" ? (
        <NotesPanel
          noteItems={noteItems}
          tagItems={tagItems}
          language={language}
          title={dict.detail.sellerTabs.notes}
          onAddNote={handleAddNote}
          onDeleteNote={handleDeleteNote}
          onSaveNote={handleSaveNote}
          onAddTag={handleAddTag}
          onDeleteTag={handleDeleteTag}
        />
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

      {activeTab !== "general" && activeTab !== "identity" && activeTab !== "legal" && activeTab !== "foods" && activeTab !== "orders" && activeTab !== "wallet" && activeTab !== "retention" && activeTab !== "security" && activeTab !== "notes" && activeTab !== "raw" ? (
        <section className="panel">
          <p className="panel-meta">{dict.detail.sectionPlanned}</p>
        </section>
      ) : null}
    </div>
  );
}


export default SellerDetailScreen;
