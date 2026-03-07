import { Fragment, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { request, parseJson } from "../../lib/api";
import { DICTIONARIES } from "../../lib/i18n";
import { fmt, toDisplayId, formatUiDate, formatLoginRelativeDayMonth, maskEmail, maskPhone, addTwoYears } from "../../lib/format";
import { openQuickEmail } from "../../lib/compliance";
import { resolveBuyerDetailTab } from "../../lib/routing";
import { fetchAllAdminLots, computeFoodLotDiff, lotLifecycleClass, lotLifecycleLabel } from "../../lib/lots";
import { foodMetadataByName, isPlaceholderIngredients, resolveFoodIngredients, resolveFoodImageUrl } from "../../lib/food";
import type { Language, ApiError, Dictionary } from "../../types/core";
import type { BuyerDetailTab } from "../../types/users";
import type { AdminLotRow, AdminLotOrderRow } from "../../types/lots";
import type { BuyerDetail, BuyerContactInfo, BuyerLoginLocation, BuyerOrderRow, BuyerCancellationRow, BuyerReviewRow, BuyerSummaryMetrics, BuyerPagination } from "../../types/buyer";

type BuyerNoteItem = {
  id: string;
  note: string;
  createdAt: string;
};

function BuyerDetailScreen({ id, dict, language }: { id: string; dict: Dictionary; language: Language }) {
  const navigate = useNavigate();
  const location = useLocation();
  const endpoint = `/v1/admin/users/${id}`;
  const [activeTab, setActiveTab] = useState<BuyerDetailTab>(() => resolveBuyerDetailTab(new URLSearchParams(location.search).get("tab")));
  const [row, setRow] = useState<BuyerDetail | null>(null);
  const [contactInfo, setContactInfo] = useState<BuyerContactInfo | null>(null);
  const [orders, setOrders] = useState<BuyerOrderRow[]>([]);
  const [summary, setSummary] = useState<BuyerSummaryMetrics | null>(null);
  const [ordersPagination, setOrdersPagination] = useState<BuyerPagination | null>(null);
  const [reviews, setReviews] = useState<BuyerReviewRow[]>([]);
  const [cancellations, setCancellations] = useState<BuyerCancellationRow[]>([]);
  const [locations, setLocations] = useState<BuyerLoginLocation[]>([]);
  const [ordersPage, setOrdersPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [smsOpen, setSmsOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [quickContactMenuOpen, setQuickContactMenuOpen] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [smsMessage, setSmsMessage] = useState("");
  const [emailSubject, setEmailSubject] = useState("Coziyoo Destek");
  const [emailBody, setEmailBody] = useState("Merhaba,");
  const [noteInput, setNoteInput] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [selectedDate, setSelectedDate] = useState("");
  const [orderSearch, setOrderSearch] = useState("");
  const quickContactWrapRef = useRef<HTMLDivElement | null>(null);
  const actionMenuWrapRef = useRef<HTMLDivElement | null>(null);
  const noteListRef = useRef<HTMLDivElement | null>(null);
  const [noteItems, setNoteItems] = useState<BuyerNoteItem[]>([]);
  const [tagItems, setTagItems] = useState<string[]>(["VIP", "Takip"]);
  const [openNoteMenuId, setOpenNoteMenuId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteValue, setEditingNoteValue] = useState("");
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);

  function paymentBadge(status: string) {
    const normalized = status.toLowerCase();
    if (normalized.includes("fail") || normalized.includes("cancel") || normalized.includes("declin")) {
      return { text: "Basarisiz", cls: "is-failed" };
    }
    if (normalized.includes("pending") || normalized.includes("wait")) {
      return { text: "Bekliyor", cls: "is-pending" };
    }
    return { text: "Basarili", cls: "is-success" };
  }

  function orderStatusLabel(status: string) {
    const normalized = status.toLowerCase();
    if (normalized.includes("cancel")) return "Iptal";
    if (normalized.includes("deliver")) return "Teslim Edildi";
    if (normalized.includes("done")) return "Tamamlandi";
    if (normalized.includes("approve")) return "Onaylandi";
    if (normalized.includes("pending")) return "Bekliyor";
    return status;
  }

  function formatCurrency(value: number) {
    return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(value);
  }

  function formatDate(value: string) {
    return new Date(value).toLocaleString("tr-TR");
  }

  function trend(current: number, previous: number) {
    if (current > previous) return { arrow: "up", cls: "is-up" };
    if (current < previous) return { arrow: "down", cls: "is-down" };
    return { arrow: "flat", cls: "is-flat" };
  }

  function toRelative(value: string) {
    const diff = Date.now() - new Date(value).getTime();
    const hours = Math.max(0, Math.floor(diff / (1000 * 60 * 60)));
    if (hours < 1) return "Simdi";
    if (hours < 24) return `${hours} saat once`;
    const days = Math.floor(hours / 24);
    return `${days} gun once`;
  }

  function toLocalDateKey(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  async function loadBuyerDetail() {
    setLoading(true);
    setMessage(null);
    try {
      const [
        detailResponse,
        contactResponse,
        summaryResponse,
        ordersResponse,
        reviewsResponse,
        cancellationsResponse,
        locationsResponse,
        notesResponse,
        tagsResponse,
      ] = await Promise.all([
        request(endpoint),
        request(`/v1/admin/users/${id}/buyer-contact`),
        request(`/v1/admin/users/${id}/buyer-summary`),
        request(`/v1/admin/users/${id}/buyer-orders?page=${ordersPage}&pageSize=5&sortDir=desc`),
        request(`/v1/admin/users/${id}/buyer-reviews?page=1&pageSize=5&sortDir=desc`),
        request(`/v1/admin/users/${id}/buyer-cancellations?page=1&pageSize=5&sortDir=desc`),
        request(`/v1/admin/users/${id}/login-locations?page=1&pageSize=5&sortDir=desc`),
        request(`/v1/admin/buyers/${id}/notes?limit=50`),
        request(`/v1/admin/buyers/${id}/tags`),
      ]);

      if (detailResponse.status !== 200) {
        const body = await parseJson<ApiError>(detailResponse);
        setMessage(body.error?.message ?? "Alıcı detayı yüklenemedi");
        return;
      }

      const detailBody = await parseJson<{ data: BuyerDetail }>(detailResponse);
      setRow(detailBody.data);

      if (contactResponse.status === 200) {
        const body = await parseJson<{ data: BuyerContactInfo }>(contactResponse);
        setContactInfo(body.data);
      }

      if (summaryResponse.status === 200) {
        const body = await parseJson<{ data: BuyerSummaryMetrics }>(summaryResponse);
        setSummary(body.data);
      } else {
        setSummary(null);
      }

      if (ordersResponse.status === 200) {
        const body = await parseJson<{ data: BuyerOrderRow[]; pagination: BuyerPagination }>(ordersResponse);
        setOrders(body.data);
        setOrdersPagination(body.pagination);
      } else {
        setOrders([]);
      }

      if (reviewsResponse.status === 200) {
        const body = await parseJson<{ data: BuyerReviewRow[] }>(reviewsResponse);
        setReviews(body.data);
      } else {
        setReviews([]);
      }

      if (cancellationsResponse.status === 200) {
        const body = await parseJson<{ data: BuyerCancellationRow[] }>(cancellationsResponse);
        setCancellations(body.data);
      } else {
        setCancellations([]);
      }

      if (locationsResponse.status === 200) {
        const body = await parseJson<{ data: BuyerLoginLocation[] }>(locationsResponse);
        setLocations(body.data);
      } else {
        setLocations([]);
      }

      if (notesResponse.status === 200) {
        const body = await parseJson<{ data: Array<{ id: string; note: string; createdAt: string }> }>(notesResponse);
        setNoteItems(body.data);
      } else {
        setNoteItems([]);
      }

      if (tagsResponse.status === 200) {
        const body = await parseJson<{ data: Array<{ id: string; tag: string }> }>(tagsResponse);
        setTagItems(body.data.map((item) => item.tag));
      } else {
        setTagItems([]);
      }
    } catch {
      setMessage("Alıcı detay isteği başarısız");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBuyerDetail().catch(() => setMessage("Alıcı detay isteği başarısız"));
  }, [id, ordersPage]);

  useEffect(() => {
    setActiveTab(resolveBuyerDetailTab(new URLSearchParams(location.search).get("tab")));
  }, [location.search]);

  useEffect(() => {
    const onDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (quickContactMenuOpen && quickContactWrapRef.current && !quickContactWrapRef.current.contains(target)) {
        setQuickContactMenuOpen(false);
      }
      if (actionMenuOpen && actionMenuWrapRef.current && !actionMenuWrapRef.current.contains(target)) {
        setActionMenuOpen(false);
      }
      if (openNoteMenuId && noteListRef.current && !noteListRef.current.contains(target)) {
        if (editingNoteId) {
          saveEditedNote(editingNoteId).catch(() => undefined);
        } else {
          setOpenNoteMenuId(null);
        }
      }
    };
    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => document.removeEventListener("mousedown", onDocumentMouseDown);
  }, [quickContactMenuOpen, actionMenuOpen, openNoteMenuId, editingNoteId]);

  const fullName = row?.fullName ?? row?.displayName ?? "-";
  const email = contactInfo?.identity.email ?? row?.email ?? "-";
  const phone = contactInfo?.contact.phone ?? "Bilinmiyor";
  const compactUserId = row?.id ? `${row.id.slice(0, 10)}...` : "-";
  const latestLoginLocation = locations[0] ?? null;
  const detailLastLoginAtRaw = latestLoginLocation?.createdAt ?? contactInfo?.identity.lastLoginAt ?? null;
  const detailLastLoginAt = formatLoginRelativeDayMonth(detailLastLoginAtRaw, language);
  const birthDateText = contactInfo?.contact?.dob ? formatUiDate(contactInfo.contact.dob, language) : "-";

  const failedPayments = useMemo(
    () => orders.filter((order) => paymentBadge(order.paymentStatus).cls === "is-failed").length,
    [orders],
  );
  const openComplaints = summary?.complaintUnresolved ?? 0;
  const cancellations30d = cancellations.length;
  const risk = useMemo(() => {
    const reasons: string[] = [];
    let level: "low" | "medium" | "high" = "low";
    if (openComplaints >= 2) {
      level = "high";
      reasons.push("2+ acik sikayet");
    } else if (openComplaints === 1) {
      level = "medium";
      reasons.push("1 acik sikayet");
    }
    if (cancellations30d >= 3) {
      level = level === "high" ? "high" : "medium";
      reasons.push("30 gunde 3+ iptal");
    }
    if (failedPayments >= 2) {
      level = level === "high" ? "high" : "medium";
      reasons.push("2+ basarisiz odeme");
    }
    return { level, reasons };
  }, [openComplaints, cancellations30d, failedPayments]);

  const orderTrend = trend(summary?.monthlyOrderCountCurrent ?? 0, summary?.monthlyOrderCountPrevious ?? 0);
  const spendTrend = trend(summary?.monthlySpentCurrent ?? 0, summary?.monthlySpentPrevious ?? 0);

  const activityRows = useMemo(() => {
    const orderEvents = orders.slice(0, 5).map((order) => ({
      id: order.orderId,
      at: order.updatedAt || order.createdAt,
      action: `Siparis ${orderStatusLabel(order.status)}`,
      actor: "Sistem",
      detail: `No: ${order.orderNo}`,
    }));
    const locationEvents = locations.slice(0, 5).map((location) => ({
      id: location.id,
      at: location.createdAt,
      action: "Giris Konumu",
      actor: location.source || "Mobil",
      detail: `${location.latitude}, ${location.longitude}`,
    }));
    return [...orderEvents, ...locationEvents].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [orders, locations]);

  const filteredOrders = useMemo(() => {
    const now = Date.now();
    const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);

    let next = [...orders];

    if (statusFilter === "all_delivered") {
      next = next.filter((order) => orderStatusLabel(order.status).toLowerCase().includes("teslim"));
    } else if (statusFilter === "all_pending") {
      next = next.filter((order) => paymentBadge(order.paymentStatus).cls === "is-pending");
    } else if (statusFilter === "all_cancelled") {
      next = next.filter((order) => orderStatusLabel(order.status).toLowerCase().includes("iptal"));
    }

    if (dateFilter === "last7") {
      next = next.filter((order) => new Date(order.createdAt).getTime() >= sevenDaysAgo);
    } else if (dateFilter === "last30") {
      next = next.filter((order) => new Date(order.createdAt).getTime() >= thirtyDaysAgo);
    } else if (dateFilter === "custom" && selectedDate) {
      next = next.filter((order) => toLocalDateKey(order.createdAt) === selectedDate);
    }

    const search = orderSearch.trim().toLowerCase();
    if (search) {
      next = next.filter((order) => {
        const no = String(order.orderNo ?? "").toLowerCase();
        const foods = order.items.map((item) => String(item.name ?? "").toLowerCase()).join(" ");
        return no.includes(search) || foods.includes(search);
      });
    }

    next.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return next;
  }, [orders, statusFilter, dateFilter, selectedDate, orderSearch]);

  const visibleOrders = useMemo(() => {
    if (filteredOrders.length === 0 && orders.length > 0) return orders;
    return filteredOrders;
  }, [filteredOrders, orders]);
  const buyerRawPayload = {
    user: row,
    contact: contactInfo,
    summary,
    orders: {
      rows: orders,
      pagination: ordersPagination,
      filteredRows: visibleOrders,
    },
    reviews,
    cancellations,
    loginLocations: locations,
    notes: noteItems.map((item) => item.note),
    tags: tagItems,
  };

  function switchBuyerTab(tab: BuyerDetailTab) {
    setActiveTab(tab);
    const params = new URLSearchParams(location.search);
    params.set("tab", tab);
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
  }

  async function sendSms() {
    if (!smsMessage.trim()) {
      setMessage("SMS icerigi bos olamaz.");
      return;
    }
    try {
      const response = await request(`/v1/admin/buyers/${id}/send-sms`, {
        method: "POST",
        body: JSON.stringify({ message: smsMessage.trim() }),
      });
      if (response.status >= 200 && response.status < 300) {
        setMessage("SMS gonderildi.");
        setSmsOpen(false);
        setSmsMessage("");
      } else {
        setMessage("SMS gonderilemedi.");
      }
    } catch {
      setMessage("SMS gonderilemedi.");
    }
  }

  function openEmail() {
    const target = String(email).trim();
    if (!target || !target.includes("@")) {
      setMessage("Gecerli e-posta bulunamadi.");
      return;
    }
    const href = `mailto:${encodeURIComponent(target)}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;
    window.location.href = href;
    setEmailOpen(false);
  }

  function copyBuyerId() {
    if (!row?.id) return;
    navigator.clipboard
      .writeText(row.id)
      .then(() => setMessage("Alici ID kopyalandi."))
      .catch(() => setMessage("Kopyalama basarisiz."));
  }

  function openAddressInMaps(address: string | null | undefined) {
    const value = String(address ?? "").trim();
    if (!value || value.toLowerCase() === "adres yok") {
      setMessage("Acilabilir adres bulunamadi.");
      return;
    }
    const target = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}`;
    window.open(target, "_blank", "noopener,noreferrer");
  }

  function openDialer(phoneValue: string | null | undefined) {
    const normalized = String(phoneValue ?? "").trim();
    if (!normalized || normalized.toLowerCase() === "bilinmiyor") {
      setMessage("Aranabilir telefon bulunamadi.");
      return;
    }
    window.location.href = `tel:${normalized.replace(/\s+/g, "")}`;
  }

  function downloadBuyerOrdersAsExcel() {
    if (orders.length === 0) {
      setMessage("Disa aktarilacak siparis bulunamadi.");
      return;
    }

    const headers = ["Tarih / Saat", "Siparis No", "Satici", "Yemekler", "Tutar", "Durum", "Odeme Durumu"];
    const rowsForExport = orders.map((order) => [
      formatDate(order.createdAt),
      order.orderNo,
      order.sellerName ?? order.sellerEmail ?? order.sellerId,
      order.items.map((item: any) => `${item.name} x${item.quantity}`).join(", ") || "-",
      formatCurrency(order.totalAmount),
      orderStatusLabel(order.status),
      paymentBadge(order.paymentStatus).text,
    ]);

    const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const csv = [headers, ...rowsForExport].map((line) => line.map((cell) => escapeCsv(String(cell))).join(",")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `buyer-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function addNote() {
    const trimmed = noteInput.trim();
    if (!trimmed) return;
    try {
      const response = await request(`/v1/admin/buyers/${id}/notes`, {
        method: "POST",
        body: JSON.stringify({ note: trimmed }),
      });
      if (response.status >= 200 && response.status < 300) {
        const body = await parseJson<{ data?: BuyerNoteItem } & ApiError>(response);
        if (body.data?.id) {
          setNoteItems((prev) => [body.data as BuyerNoteItem, ...prev]);
        } else {
          await loadBuyerDetail();
        }
        setNoteInput("");
      } else {
        setMessage("Not kaydedilemedi.");
      }
    } catch {
      setMessage("Not kaydedilemedi.");
    }
  }

  async function addTag() {
    const trimmed = noteInput.trim();
    if (!trimmed) return;
    try {
      const response = await request(`/v1/admin/buyers/${id}/tags`, {
        method: "POST",
        body: JSON.stringify({ tag: trimmed }),
      });
      if (response.status >= 200 && response.status < 300) {
        if (!tagItems.includes(trimmed)) {
          setTagItems((prev) => [trimmed, ...prev].slice(0, 8));
        }
        setNoteInput("");
      } else {
        setMessage("Etiket kaydedilemedi.");
      }
    } catch {
      setMessage("Etiket kaydedilemedi.");
    }
  }

  async function deleteTag(tag: string) {
    const value = String(tag ?? "").trim();
    if (!value) return;
    try {
      const response = await request(`/v1/admin/buyers/${id}/tags`, {
        method: "DELETE",
        body: JSON.stringify({ tag: value }),
      });
      if (response.status === 204) {
        setTagItems((prev) => prev.filter((item) => item !== value));
        return;
      }
      setMessage("Etiket silinemedi.");
    } catch {
      setMessage("Etiket silinemedi.");
    }
  }

  async function deleteNote(noteId: string) {
    try {
      const response = await request(`/v1/admin/buyers/${id}/notes/${noteId}`, { method: "DELETE" });
      if (response.status === 204) {
        setNoteItems((prev) => prev.filter((item) => item.id !== noteId));
        setOpenNoteMenuId(null);
        if (editingNoteId === noteId) {
          setEditingNoteId(null);
          setEditingNoteValue("");
        }
        return;
      }
      setMessage("Not silinemedi.");
    } catch {
      setMessage("Not silinemedi.");
    }
  }

  async function saveEditedNote(noteId: string) {
    if (savingNoteId === noteId) return;
    const trimmed = editingNoteValue.trim();
    if (!trimmed) {
      setMessage("Not bos olamaz.");
      return;
    }
    const current = noteItems.find((item) => item.id === noteId);
    if (current && current.note.trim() === trimmed) {
      setEditingNoteId(null);
      setEditingNoteValue("");
      setOpenNoteMenuId(null);
      return;
    }
    setSavingNoteId(noteId);
    try {
      const response = await request(`/v1/admin/buyers/${id}/notes/${noteId}`, {
        method: "PATCH",
        body: JSON.stringify({ note: trimmed }),
      });
      if (response.status === 200) {
        const body = await parseJson<{ data?: BuyerNoteItem } & ApiError>(response);
        if (body.data?.id) {
          setNoteItems((prev) => prev.map((item) => (item.id === noteId ? (body.data as BuyerNoteItem) : item)));
        }
        setEditingNoteId(null);
        setEditingNoteValue("");
        setOpenNoteMenuId(null);
        return;
      }
      setMessage("Not guncellenemedi.");
    } catch {
      setMessage("Not guncellenemedi.");
    } finally {
      setSavingNoteId(null);
    }
  }

  if (loading && !row) return <div className="panel">Yükleniyor...</div>;
  if (!row) return <div className="panel">{message ?? "Kayıt bulunamadı"}</div>;

  return (
    <div className="app buyer-ops-page">
      <section className="buyer-ref-top buyer-ref-hero-strip">
        <article className="buyer-ref-profile-card">
          <div className="buyer-ref-avatar">{(fullName || "?").slice(0, 2).toUpperCase()}</div>
          <div className="buyer-ref-profile-body">
            <h2 title={fullName}>{fullName}</h2>
            <div className="buyer-ops-id-row">
              <span>ID {compactUserId}</span>
              <button type="button" className="ghost buyer-ops-mini-btn" onClick={copyBuyerId}>
                <span aria-hidden="true">◌</span>
              </button>
            </div>
          </div>
        </article>
        <article className="buyer-ops-kpi-card buyer-ref-metric">
          <div className="buyer-ref-metric-head">
            <span className="buyer-ref-metric-icon is-alert" aria-hidden="true">♡</span>
            <p>Acik Sikayet</p>
            <span className="buyer-ref-metric-head-value">{openComplaints}</span>
          </div>
          <div className="buyer-ref-metric-line">
            <small>Son sikayet: {cancellations[0] ? toRelative(cancellations[0].cancelledAt) : "4 ay once"}</small>
          </div>
        </article>
        <article className="buyer-ops-kpi-card buyer-ref-metric">
          <div className="buyer-ref-metric-head">
            <span className="buyer-ref-metric-icon is-trend" aria-hidden="true">⌁</span>
            <p>Son 30 Gun</p>
            <small className="buyer-ref-metric-head-meta is-accent">{formatCurrency(summary?.monthlySpentCurrent ?? 0)}</small>
          </div>
          <div className="buyer-ref-metric-line buyer-ref-metric-line-30">
            <small className={`buyer-trend ${orderTrend.cls}`}>Siparis: {orders[0] ? toRelative(orders[0].createdAt) : "2 gun once"}</small>
            <strong><span>Siparis</span> <span className="is-accent">{`${summary?.monthlyOrderCountCurrent ?? 0} adet`}</span></strong>
          </div>
        </article>
        <article className="buyer-ops-kpi-card buyer-ref-metric">
          <div className="buyer-ref-metric-head buyer-ref-metric-head-payment">
            <span className="buyer-ref-metric-icon is-payment" aria-hidden="true">◔</span>
            <p>Odeme Durumu</p>
            <span className="buyer-ref-metric-head-stack">
              <span className="buyer-ref-metric-head-balance">{`${failedPayments} bakiyede`}</span>
            </span>
          </div>
          <div className="buyer-ref-metric-line buyer-ref-metric-line-payment">
            <small>Son islem: {orders[0] ? toRelative(orders[0].updatedAt || orders[0].createdAt) : "2 hafta once"}</small>
            <small>{`Siparis ${orders.length - failedPayments} adet`}</small>
          </div>
        </article>
      </section>

      <section className="buyer-ref-content">
        <aside className="buyer-ref-right">
          <section className="panel buyer-ops-side-card buyer-ref-contact-side">
            <h2>Profil Bilgileri</h2>
            <div className="buyer-ref-contact-block">
              <p className="buyer-ref-contact-label"><span className="buyer-ref-side-icon" aria-hidden="true">✉</span> E-posta</p>
              <p className="buyer-ref-contact-value">{email}</p>
            </div>
            <button type="button" className="buyer-ref-link-block" onClick={() => openAddressInMaps(contactInfo?.addresses.home?.addressLine ?? null)}>
              <p className="buyer-ref-contact-label"><span className="buyer-ref-side-icon" aria-hidden="true">⌂</span> Ev Adresi</p>
              <p className="buyer-ref-contact-value">{contactInfo?.addresses.home?.addressLine ?? "Adres yok"}</p>
            </button>
            <button type="button" className="buyer-ref-link-block" onClick={() => openDialer(phone)}>
              <p className="buyer-ref-contact-label"><span className="buyer-ref-side-icon" aria-hidden="true">✆</span> Cep</p>
              <p className="buyer-ref-contact-value buyer-ref-phone-row">
                <strong>{phone}</strong>
                <span className="buyer-ref-online-dot" aria-hidden="true" />
              </p>
              <p className="panel-meta">{locations.length} segilones</p>
            </button>
            <button type="button" className="buyer-ref-link-block" onClick={() => switchBuyerTab("activity")}>
              <p className="buyer-ref-contact-label"><span className="buyer-ref-side-icon" aria-hidden="true">◷</span> Son Giris</p>
              <p className="buyer-ref-contact-value">{detailLastLoginAt}</p>
              {risk.level === "high" ? <p><span className="status-pill is-warning">⚠ Yuksek</span></p> : null}
            </button>
            <div className="buyer-ref-contact-block">
              <p className="buyer-ref-contact-label">Dogum Tarihi</p>
              <p className="buyer-ref-contact-value">{birthDateText}</p>
            </div>
          </section>

          <section className="panel buyer-ops-side-card buyer-ref-activity-card">
            <div className="panel-header">
              <h2>Aktivite Logu</h2>
              <button className="ghost buyer-ops-mini-btn" type="button" onClick={() => switchBuyerTab("activity")}>Ac</button>
            </div>
            <div className="buyer-ops-activity-mini">
              {activityRows.slice(0, 2).map((item: any) => (
                <article key={item.id} className="buyer-ref-click-item" onClick={() => switchBuyerTab("activity")} role="button" tabIndex={0} onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    switchBuyerTab("activity");
                  }
                }}>
                  <p className="buyer-ref-activity-top"><span aria-hidden="true">•</span> {toRelative(item.at)}</p>
                  <p className="buyer-ref-activity-action">{item.action}</p>
                  <p className="panel-meta">{item.detail}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="panel buyer-ops-side-card buyer-ref-notes-card">
            <div className="panel-header">
              <h2>Notlar & Etiketler</h2>
              <button className="ghost buyer-ops-mini-btn" type="button" onClick={() => switchBuyerTab("notes")}>Ac</button>
            </div>
            <div className="buyer-ops-tag-list">
              {tagItems.map((tag) => (
                <span key={tag} className="buyer-ops-tag">
                  <span>{tag}</span>
                  <button className="buyer-ops-tag-remove" type="button" onClick={() => deleteTag(tag)} aria-label={`Sil ${tag}`}>×</button>
                </span>
              ))}
            </div>
            <div className="buyer-ops-note-form">
              <input
                value={noteInput}
                onChange={(event) => setNoteInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") addNote();
                }}
              />
              <button className="ghost" type="button" onClick={addNote}>Not</button>
              <button className="ghost" type="button" onClick={addTag}>Etiket</button>
            </div>
            <p className="panel-meta">{noteItems.length} Not, {tagItems.length} Etikes</p>
          </section>
        </aside>

        <div className="buyer-ref-left">
          <section className="panel buyer-ref-main-panel">
            <div className="buyer-ops-tabs" role="tablist" aria-label="Alici detay sekmeleri">
              <button className={activeTab === "orders" ? "is-active" : ""} onClick={() => switchBuyerTab("orders")} type="button">Siparisler</button>
              <button className={activeTab === "payments" ? "is-active" : ""} onClick={() => switchBuyerTab("payments")} type="button">Odemeler</button>
              <button className={activeTab === "complaints" ? "is-active" : ""} onClick={() => switchBuyerTab("complaints")} type="button">Sikayetler</button>
              <button className={activeTab === "reviews" ? "is-active" : ""} onClick={() => switchBuyerTab("reviews")} type="button">Yorumlar & Puanlar</button>
              <button className={activeTab === "activity" ? "is-active" : ""} onClick={() => switchBuyerTab("activity")} type="button">Aktivite Logu</button>
              <button className={activeTab === "notes" ? "is-active" : ""} onClick={() => switchBuyerTab("notes")} type="button">Notlar & Etiketler</button>
              <button className={activeTab === "raw" ? "is-active" : ""} onClick={() => switchBuyerTab("raw")} type="button">Ham Veri</button>
            </div>
            {activeTab === "orders" || activeTab === "payments" ? (
              <>
                <div className="buyer-ref-filter-row">
                  <label className="ghost buyer-ref-filter-btn buyer-ref-select-wrap">
                    <span className="buyer-ref-filter-leading" aria-hidden="true">
                      <svg viewBox="0 0 24 24" focusable="false">
                        <path d="M3 7h13" />
                        <path d="M6 12h15" />
                        <path d="M3 17h13" />
                        <circle cx="19" cy="7" r="2" />
                        <circle cx="4" cy="12" r="2" />
                        <circle cx="19" cy="17" r="2" />
                      </svg>
                    </span>
                    <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Durum filtresi">
                      <option value="all">Hepsi | Tumu</option>
                      <option value="all_delivered">Hepsi | Teslim Edildi</option>
                      <option value="all_pending">Hepsi | Bekliyor</option>
                      <option value="all_cancelled">Hepsi | Iptal</option>
                    </select>
                    <span className="buyer-ref-filter-trailing" aria-hidden="true">
                      <svg viewBox="0 0 24 24" focusable="false">
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </span>
                  </label>
                  <label className="ghost buyer-ref-filter-btn buyer-ref-select-wrap">
                    <span className="buyer-ref-filter-leading" aria-hidden="true">
                      <svg viewBox="0 0 24 24" focusable="false">
                        <rect x="3.5" y="4.5" width="17" height="16" rx="2.5" />
                        <path d="M8 2.8v3.4M16 2.8v3.4M3.5 9.5h17" />
                        <path d="M8.2 13h3.4M8.2 16h6.6" />
                      </svg>
                    </span>
                    <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} aria-label="Tarih filtresi">
                      <option value="all">27.01.2028 - 27.02.2028</option>
                      <option value="last7">Son 7 gun</option>
                      <option value="last30">Son 30 gun</option>
                      <option value="custom">Tarih Sec</option>
                    </select>
                    <span className="buyer-ref-filter-trailing" aria-hidden="true">
                      <svg viewBox="0 0 24 24" focusable="false">
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </span>
                  </label>
                  {dateFilter === "custom" ? (
                    <label className="ghost buyer-ref-filter-btn buyer-ref-date-input-wrap">
                      <input
                        type="date"
                        aria-label="Secilen tarih"
                        value={selectedDate}
                        onChange={(event) => setSelectedDate(event.target.value)}
                      />
                    </label>
                  ) : null}
                  <label className="ghost buyer-ref-search-btn">
                    <span className="buyer-ref-filter-leading" aria-hidden="true">
                      <svg viewBox="0 0 24 24" focusable="false">
                        <circle cx="11" cy="11" r="5.5" />
                        <path d="m15.2 15.2 4.3 4.3" />
                      </svg>
                    </span>
                    <input
                      className="buyer-ref-search-input"
                      value={orderSearch}
                      onChange={(event) => setOrderSearch(event.target.value)}
                      aria-label="Siparis veya isim ara"
                    />
                  </label>
                  <button className="primary buyer-ref-export-btn" type="button" onClick={downloadBuyerOrdersAsExcel}>
                    Excel'e Aktar
                  </button>
                </div>

                <div className="buyer-ops-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th><span className="buyer-ref-head-checkbox" aria-hidden="true" /></th>
                        <th>Tarih / Saat</th>
                        <th>Siparis No</th>
                        <th>Satici</th>
                        <th>{activeTab === "orders" ? "Yemekler" : "Odeme / Yemek"}</th>
                        <th>Tutar</th>
                        <th>Durum</th>
                        <th>Star</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleOrders.length === 0 ? (
                        <tr><td colSpan={8}>Siparis kaydi bulunamadi.</td></tr>
                      ) : visibleOrders.map((order: any) => {
                        const foods = order.items.map((item: any) => `${item.name} x${item.quantity}`).join(", ");
                        const paymentState = paymentBadge(order.paymentStatus);
                        const statusText = paymentState.cls === "is-pending"
                          ? "Bekleyen"
                          : paymentState.cls === "is-failed"
                            ? "Basarisiz"
                            : "Tamamlanmis";
                        return (
                          <tr key={order.orderId}>
                            <td><input type="checkbox" aria-label="Satir sec" /></td>
                            <td>{formatDate(order.createdAt)}</td>
                            <td className="buyer-order-no">{order.orderNo}</td>
                            <td>{order.sellerName ?? order.sellerEmail ?? order.sellerId.slice(0, 10)}</td>
                            <td>{activeTab === "orders" ? (foods || "-") : `${paymentState.text} • ${foods || "-"}`}</td>
                            <td>{formatCurrency(order.totalAmount)}</td>
                            <td><span className={`buyer-payment-badge ${paymentState.cls}`}>{statusText}</span></td>
                            <td><span className="status-pill is-success">Aktif</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="buyer-ref-pager">
                  <div>
                    <button className="ghost" type="button" onClick={() => setOrdersPage(Math.max(1, (ordersPagination?.page ?? 1) - 1))}>Onceki</button>
                    <button className="ghost" type="button" onClick={() => setOrdersPage(Math.min((ordersPagination?.totalPages ?? 1), (ordersPagination?.page ?? 1) + 1))}>Sonraki</button>
                    <span>Toplam {visibleOrders.length} Siparis</span>
                  </div>
                  <div>
                    <button className="ghost" type="button">1</button>
                    <button className="ghost is-active" type="button">2</button>
                    <button className="ghost" type="button">3</button>
                  </div>
                </div>
              </>
            ) : null}

            {activeTab === "complaints" ? (
              <div className="buyer-ops-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Tarih / Saat</th>
                      <th>Siparis No</th>
                      <th>Tutar</th>
                      <th>Sebep</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cancellations.length === 0 ? (
                      <tr><td colSpan={4}>Sikayet kaydi bulunamadi.</td></tr>
                    ) : cancellations.map((item) => (
                      <tr key={`${item.orderId}-${item.cancelledAt}`}>
                        <td>{formatDate(item.cancelledAt)}</td>
                        <td className="buyer-order-no">{item.orderNo}</td>
                        <td>{formatCurrency(item.totalAmount)}</td>
                        <td>{item.reason ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {activeTab === "reviews" ? (
              <div className="buyer-ops-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Tarih / Saat</th>
                      <th>Yemek</th>
                      <th>Puan</th>
                      <th>Yorum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviews.length === 0 ? (
                      <tr><td colSpan={4}>Yorum kaydi bulunamadi.</td></tr>
                    ) : reviews.map((item) => (
                      <tr key={item.id}>
                        <td>{formatDate(item.createdAt)}</td>
                        <td>{item.foodName}</td>
                        <td>{item.rating}/5</td>
                        <td>{item.comment ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {activeTab === "activity" ? (
              <div className="buyer-ops-activity-mini buyer-ref-main-activity">
                {activityRows.map((item: any) => (
                  <article key={`main-${item.id}-${item.at}`}>
                    <p className="buyer-ref-activity-top"><span aria-hidden="true">•</span> {toRelative(item.at)}</p>
                    <p className="buyer-ref-activity-action">{item.action}</p>
                    <p className="panel-meta">{item.detail}</p>
                  </article>
                ))}
              </div>
            ) : null}

            {activeTab === "notes" ? (
              <div className="buyer-ref-main-notes">
                <div className="buyer-ops-tag-list">
                  {tagItems.map((tag) => (
                    <span key={`main-${tag}`} className="buyer-ops-tag">
                      <span>{tag}</span>
                      <button className="buyer-ops-tag-remove" type="button" onClick={() => deleteTag(tag)} aria-label={`Sil ${tag}`}>×</button>
                    </span>
                  ))}
                </div>
                <div className="buyer-ref-note-list" ref={noteListRef}>
                  {noteItems.length === 0 ? (
                    <p className="panel-meta">Henüz not yok.</p>
                  ) : (
                    noteItems.map((note) => (
                      <article
                        key={`main-note-${note.id}`}
                        className={`buyer-ref-note-item ${openNoteMenuId === note.id ? "is-open" : ""}`}
                        onClick={() => setOpenNoteMenuId(note.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setOpenNoteMenuId(note.id);
                          }
                        }}
                      >
                        {editingNoteId === note.id ? (
                          <div className="buyer-ref-note-edit-row" onClick={(event) => event.stopPropagation()}>
                            <input
                              value={editingNoteValue}
                              onChange={(event) => setEditingNoteValue(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  saveEditedNote(note.id).catch(() => undefined);
                                }
                              }}
                              onBlur={() => {
                                saveEditedNote(note.id).catch(() => undefined);
                              }}
                            />
                          </div>
                        ) : (
                          <p>{note.note}</p>
                        )}
                        {editingNoteId !== note.id && openNoteMenuId === note.id ? (
                          <div className="buyer-ref-note-actions" onClick={(event) => event.stopPropagation()}>
                            <button
                              className="ghost"
                              type="button"
                              onClick={() => {
                                setEditingNoteId(note.id);
                                setEditingNoteValue(note.note);
                              }}
                            >
                              Duzenle
                            </button>
                            <button className="ghost is-danger" type="button" onClick={() => deleteNote(note.id)}>Sil</button>
                          </div>
                        ) : null}
                      </article>
                    ))
                  )}
                </div>
                <p className="panel-meta">{noteItems.length} Not, {tagItems.length} Etiket</p>
              </div>
            ) : null}

            {activeTab === "raw" ? (
              <section className="seller-json-card">
                <div className="seller-json-header">
                  <h2>Ham Veri (JSON)</h2>
                  <button
                    className="ghost seller-json-copy"
                    type="button"
                    onClick={() => navigator.clipboard.writeText(JSON.stringify(buyerRawPayload, null, 2)).catch(() => undefined)}
                  >
                    {dict.detail.copyJson}
                  </button>
                </div>
                <pre className="json-box">{JSON.stringify(buyerRawPayload, null, 2)}</pre>
              </section>
            ) : null}
          </section>

        </div>
      </section>

      {smsOpen ? (
        <div className="buyer-ops-modal-backdrop" role="dialog" aria-modal="true" aria-label="Hizli SMS">
          <div className="buyer-ops-modal">
            <h3>Hizli SMS</h3>
            <label>
              Telefon
              <input value={phone} readOnly />
            </label>
            <label>
              Mesaj
              <textarea value={smsMessage} onChange={(event) => setSmsMessage(event.target.value)} rows={5} />
            </label>
            <div className="buyer-ops-modal-actions">
              <button className="ghost" type="button" onClick={() => setSmsOpen(false)}>Vazgec</button>
              <button className="primary" type="button" onClick={sendSms}>Gonder</button>
            </div>
          </div>
        </div>
      ) : null}

      {emailOpen ? (
        <div className="buyer-ops-modal-backdrop" role="dialog" aria-modal="true" aria-label="Hizli E-posta">
          <div className="buyer-ops-modal">
            <h3>Hizli E-posta</h3>
            <label>
              E-posta
              <input value={email} readOnly />
            </label>
            <label>
              Konu
              <input value={emailSubject} onChange={(event) => setEmailSubject(event.target.value)} />
            </label>
            <label>
              Mesaj
              <textarea value={emailBody} onChange={(event) => setEmailBody(event.target.value)} rows={5} />
            </label>
            <div className="buyer-ops-modal-actions">
              <button className="ghost" type="button" onClick={() => setEmailOpen(false)}>Vazgec</button>
              <button className="primary" type="button" onClick={openEmail}>E-posta Ac</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}


export default BuyerDetailScreen;
