import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { request, parseJson } from "../../lib/api";
import { ExcelExportButton, Pager, QuickAccessMenu } from "../../components/ui";
import { NotesPanel } from "../../components/NotesPanel";
import { formatUiDate, formatLoginRelativeDayMonth, formatCurrency, formatTableDateTime, toRelativeTimeTR, toLocalDateKey, parseCustomDateToKey } from "../../lib/format";
import { paymentBadge, orderStatusLabel } from "../../lib/status";
import { resolveBuyerDetailTab } from "../../lib/routing";
import type { Language, ApiError, Dictionary } from "../../types/core";
import type { BuyerDetailTab } from "../../types/users";
import type { BuyerDetail, BuyerContactInfo, BuyerLoginLocation, BuyerOrderRow, BuyerCancellationRow, BuyerComplaintRow, BuyerReviewRow, BuyerSummaryMetrics, BuyerPagination } from "../../types/buyer";

type BuyerNoteItem = {
  id: string;
  note: string;
  createdAt: string;
  createdByUsername?: string | null;
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
  const [complaints, setComplaints] = useState<BuyerComplaintRow[]>([]);
  const [cancellations, setCancellations] = useState<BuyerCancellationRow[]>([]);
  const [locations, setLocations] = useState<BuyerLoginLocation[]>([]);
  const [ordersPage, setOrdersPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [smsOpen, setSmsOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [smsMessage, setSmsMessage] = useState("");
  const [emailSubject, setEmailSubject] = useState("Coziyoo Destek");
  const [emailBody, setEmailBody] = useState("Merhaba,");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [selectedDate, setSelectedDate] = useState("");
  const [orderSearch, setOrderSearch] = useState("");
  const customDateInputRef = useRef<HTMLInputElement | null>(null);
  const [noteItems, setNoteItems] = useState<BuyerNoteItem[]>([]);
  const [tagItems, setTagItems] = useState<string[]>(["VIP", "Takip"]);

  // Create ticket tab state
  type ComplaintCategory = { id: string; code: string; name: string };
  const [ticketCategories, setTicketCategories] = useState<ComplaintCategory[]>([]);
  const [ticketOrderId, setTicketOrderId] = useState("");
  const [ticketDescription, setTicketDescription] = useState("");
  const [ticketPriority, setTicketPriority] = useState<"low" | "medium" | "high" | "urgent">("medium");
  const [ticketCategoryId, setTicketCategoryId] = useState("");
  const [ticketSubmitting, setTicketSubmitting] = useState(false);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [ticketSuccess, setTicketSuccess] = useState<{ id: string; ticketNo?: number } | null>(null);

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
        complaintsResponse,
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
        request(`/v1/admin/users/${id}/buyer-complaints?page=1&pageSize=20&sortDir=desc`),
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

      if (complaintsResponse.status === 200) {
        const body = await parseJson<{ data: BuyerComplaintRow[] }>(complaintsResponse);
        setComplaints(body.data);
      } else {
        setComplaints([]);
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
        const body = await parseJson<{ data: Array<{ id: string; note: string; createdAt: string; createdByUsername?: string | null }> }>(notesResponse);
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
    if (activeTab !== "create_ticket" || ticketCategories.length > 0) return;
    request("/v1/admin/investigations/complaint-categories")
      .then((res) => parseJson<{ data?: Array<{ id: string; code: string; name: string }> }>(res))
      .then((body) => { if (body.data) setTicketCategories(body.data); })
      .catch(() => undefined);
  }, [activeTab]);

  const fullName = row?.fullName ?? row?.displayName ?? "-";
  const email = contactInfo?.identity.email ?? row?.email ?? "-";
  const phone = contactInfo?.contact.phone ?? "Bilinmiyor";
  const contactPhoneHrefValue = String(phone).replace(/[^\d+]/g, "");
  const contactHasPhone = contactPhoneHrefValue.length > 0 && phone.toLowerCase() !== "bilinmiyor";
  const contactSmsBody = encodeURIComponent(language === "tr" ? "Merhaba" : "Hello");
  const latestLoginLocation = locations[0] ?? null;
  const detailLastLoginAtRaw = latestLoginLocation?.createdAt ?? contactInfo?.identity.lastLoginAt ?? null;
  const detailLastLoginAt = formatLoginRelativeDayMonth(detailLastLoginAtRaw, language);
  const birthDateText = contactInfo?.contact?.dob ? formatUiDate(contactInfo.contact.dob, language) : "-";
  const allAddresses = useMemo(() => {
    const next: Array<{ id: string; title: string; addressLine: string; isDefault: boolean }> = [];
    if (contactInfo?.addresses.home) {
      next.push(contactInfo.addresses.home);
    }
    if (contactInfo?.addresses.office) {
      next.push(contactInfo.addresses.office);
    }
    if (Array.isArray(contactInfo?.addresses.other)) {
      next.push(...contactInfo.addresses.other);
    }
    return next.filter((item) => String(item.addressLine ?? "").trim().length > 0);
  }, [contactInfo]);

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

  useEffect(() => {
    if (dateFilter !== "custom") return;
    const input = customDateInputRef.current;
    if (!input) return;
    input.focus();
    if ("showPicker" in HTMLInputElement.prototype && typeof input.showPicker === "function") {
      input.showPicker();
    }
  }, [dateFilter]);

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
      const selectedDateKey = selectedDate.includes("-") ? selectedDate : parseCustomDateToKey(selectedDate);
      if (selectedDateKey) {
        next = next.filter((order) => toLocalDateKey(order.createdAt) === selectedDateKey);
      }
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
    complaints,
    cancellations,
    loginLocations: locations,
    notes: noteItems.map((item) => item.note),
    tags: tagItems,
  };
  const buyerTabSummary = [
    { key: "orders" as const, label: "Siparisler", count: orders.length, lastAt: orders[0]?.createdAt ?? null },
    { key: "payments" as const, label: "Odemeler", count: orders.length, lastAt: orders[0]?.updatedAt ?? orders[0]?.createdAt ?? null },
    { key: "complaints" as const, label: "Sikayetler", count: complaints.length, lastAt: complaints[0]?.createdAt ?? null },
    { key: "reviews" as const, label: "Yorumlar & Puanlar", count: reviews.length, lastAt: reviews[0]?.createdAt ?? null },
    { key: "activity" as const, label: "Aktivite Logu", count: activityRows.length, lastAt: activityRows[0]?.at ?? null },
    { key: "notes" as const, label: "Notlar & Etiketler", count: noteItems.length + tagItems.length, lastAt: noteItems[0]?.createdAt ?? null },
    { key: "raw" as const, label: "Ham Veri", count: Object.keys(buyerRawPayload).length, lastAt: detailLastLoginAtRaw },
  ];
  const canExportActiveBuyerTab = activeTab === "orders" || activeTab === "payments";

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
      formatTableDateTime(order.createdAt),
      order.orderNo,
      order.sellerName ?? order.sellerEmail ?? order.sellerId,
      order.items.map((item: any) => `${item.name} x${item.quantity}`).join(", ") || "-",
      formatCurrency(order.totalAmount, "tr"),
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

  async function handleAddNote(text: string): Promise<void> {
    try {
      const response = await request(`/v1/admin/buyers/${id}/notes`, {
        method: "POST",
        body: JSON.stringify({ note: text }),
      });
      if (response.status >= 200 && response.status < 300) {
        const body = await parseJson<{ data?: BuyerNoteItem } & ApiError>(response);
        if (body.data?.id) {
          setNoteItems((prev) => [body.data as BuyerNoteItem, ...prev]);
        } else {
          await loadBuyerDetail();
        }
      } else {
        setMessage("Not kaydedilemedi.");
      }
    } catch {
      setMessage("Not kaydedilemedi.");
    }
  }

  async function handleAddTag(tag: string): Promise<void> {
    try {
      const response = await request(`/v1/admin/buyers/${id}/tags`, {
        method: "POST",
        body: JSON.stringify({ tag }),
      });
      if (response.status >= 200 && response.status < 300) {
        if (!tagItems.includes(tag)) {
          setTagItems((prev) => [tag, ...prev].slice(0, 8));
        }
      } else {
        setMessage("Etiket kaydedilemedi.");
      }
    } catch {
      setMessage("Etiket kaydedilemedi.");
    }
  }

  async function handleDeleteTag(tag: string): Promise<void> {
    try {
      const response = await request(`/v1/admin/buyers/${id}/tags`, {
        method: "DELETE",
        body: JSON.stringify({ tag }),
      });
      if (response.status === 204) {
        setTagItems((prev) => prev.filter((item) => item !== tag));
      } else {
        setMessage("Etiket silinemedi.");
      }
    } catch {
      setMessage("Etiket silinemedi.");
    }
  }

  async function handleDeleteNote(noteId: string): Promise<void> {
    try {
      const response = await request(`/v1/admin/buyers/${id}/notes/${noteId}`, { method: "DELETE" });
      if (response.status === 204) {
        setNoteItems((prev) => prev.filter((item) => item.id !== noteId));
      } else {
        setMessage("Not silinemedi.");
      }
    } catch {
      setMessage("Not silinemedi.");
    }
  }

  async function handleSaveNote(noteId: string, newText: string): Promise<void> {
    try {
      const response = await request(`/v1/admin/buyers/${id}/notes/${noteId}`, {
        method: "PATCH",
        body: JSON.stringify({ note: newText }),
      });
      if (response.status === 200) {
        const body = await parseJson<{ data?: BuyerNoteItem } & ApiError>(response);
        if (body.data?.id) {
          setNoteItems((prev) => prev.map((item) => (item.id === noteId ? (body.data as BuyerNoteItem) : item)));
        }
      } else {
        setMessage("Not guncellenemedi.");
      }
    } catch {
      setMessage("Not guncellenemedi.");
    }
  }

  async function submitTicket() {
    if (!ticketOrderId || !ticketDescription.trim()) {
      setTicketError("Siparis ve aciklama zorunludur.");
      return;
    }
    setTicketSubmitting(true);
    setTicketError(null);
    setTicketSuccess(null);
    try {
      const response = await request("/v1/admin/investigations/complaints", {
        method: "POST",
        body: JSON.stringify({
          orderId: ticketOrderId,
          complainantBuyerId: id,
          description: ticketDescription.trim(),
          priority: ticketPriority,
          categoryId: ticketCategoryId || undefined,
        }),
      });
      const body = await parseJson<{ data?: { id: string } } & { error?: { message?: string } }>(response);
      if (response.status !== 201 || !body.data) {
        setTicketError(body.error?.message ?? "Talep olusturulamadi.");
        return;
      }
      setTicketSuccess({ id: body.data.id });
      setTicketDescription("");
      setTicketOrderId("");
      setTicketCategoryId("");
      setTicketPriority("medium");
    } catch {
      setTicketError("Talep olusturulamadi.");
    } finally {
      setTicketSubmitting(false);
    }
  }

  if (loading && !row) return <div className="panel">Yükleniyor...</div>;
  if (!row) return <div className="panel">{message ?? "Kayıt bulunamadı"}</div>;

  return (
    <div className="app buyer-ops-page">
      <section className="buyer-ref-top buyer-ref-hero-strip">
        <article className="buyer-ref-profile-card">
          <button type="button" className="buyer-ref-avatar-button" onClick={() => setProfileModalOpen(true)} aria-label="Profil bilgilerini aç">
            <div className="buyer-ref-avatar">{(fullName || "?").slice(0, 2).toUpperCase()}</div>
          </button>
          <div className="buyer-ref-profile-body">
            <div className="buyer-ref-profile-head">
              <div className="buyer-ref-profile-title">
                <h2 title={fullName}>{fullName}</h2>
              </div>
              <QuickAccessMenu
                language={language}
                className="buyer-ref-quick-access"
                email={email}
                phoneHrefValue={contactHasPhone ? contactPhoneHrefValue : ""}
                smsBody={contactSmsBody}
              />
            </div>
          </div>
        </article>
        <article className="buyer-ops-kpi-card buyer-ref-metric">
          <div className="buyer-ref-metric-head">
            <span className="buyer-ref-metric-icon is-alert" aria-hidden="true">♡</span>
            <p>Acik Sikayet</p>
            <span className="buyer-ref-metric-head-value">{openComplaints}</span>
          </div>
        </article>
        <article className="buyer-ops-kpi-card buyer-ref-metric">
          <div className="buyer-ref-metric-head">
            <span className="buyer-ref-metric-icon is-trend" aria-hidden="true">⌁</span>
            <p>Son 30 Gun</p>
            <small className="buyer-ref-metric-head-meta is-accent">{formatCurrency(summary?.monthlySpentCurrent ?? 0, "tr")}</small>
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
        </article>
      </section>

      <section className="buyer-ref-content buyer-ref-content--single">
        <div className="buyer-ref-left">
          <section className="panel buyer-ref-main-panel">
            <div className="buyer-ops-tabs-head">
              <div className="buyer-ops-tabs" role="tablist" aria-label="Alici detay sekmeleri">
                <button className={activeTab === "general" ? "is-active" : ""} onClick={() => switchBuyerTab("general")} type="button">Genel</button>
                <button className={activeTab === "orders" ? "is-active" : ""} onClick={() => switchBuyerTab("orders")} type="button">Siparisler</button>
                <button className={activeTab === "payments" ? "is-active" : ""} onClick={() => switchBuyerTab("payments")} type="button">Odemeler</button>
                <button className={activeTab === "complaints" ? "is-active" : ""} onClick={() => switchBuyerTab("complaints")} type="button">Sikayetler</button>
                <button className={activeTab === "reviews" ? "is-active" : ""} onClick={() => switchBuyerTab("reviews")} type="button">Yorumlar & Puanlar</button>
                <button className={activeTab === "activity" ? "is-active" : ""} onClick={() => switchBuyerTab("activity")} type="button">Aktivite Logu</button>
                <button className={activeTab === "notes" ? "is-active" : ""} onClick={() => switchBuyerTab("notes")} type="button">Notlar & Etiketler</button>
                <button className={activeTab === "raw" ? "is-active" : ""} onClick={() => switchBuyerTab("raw")} type="button">Ham Veri</button>
                <button className={activeTab === "create_ticket" ? "is-active" : ""} onClick={() => switchBuyerTab("create_ticket")} type="button">+ Talep Olustur</button>
              </div>
              <ExcelExportButton
                className="primary buyer-tabs-export-btn"
                type="button"
                onClick={downloadBuyerOrdersAsExcel}
                disabled={!canExportActiveBuyerTab}
                language={language}
              />
            </div>
            {activeTab === "general" ? (
              <>
                <div className="buyer-ops-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Sekme</th>
                        <th>Kayit Ozeti</th>
                        <th>Son Hareket</th>
                        <th>Detay</th>
                      </tr>
                    </thead>
                    <tbody>
                      {buyerTabSummary.map((item) => (
                        <tr key={`general-${item.key}`}>
                          <td>{item.label}</td>
                          <td>{item.count}</td>
                          <td>{item.lastAt ? toRelativeTimeTR(item.lastAt) : "-"}</td>
                          <td>
                            <button className="ghost buyer-ops-mini-btn" type="button" onClick={() => switchBuyerTab(item.key)}>
                              Ac
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
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
                      <option value="all">Tumu</option>
                      <option value="all_delivered">Teslim Edildi</option>
                      <option value="all_pending">Bekliyor</option>
                      <option value="all_cancelled">Iptal</option>
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
                      <option value="all">Bugun</option>
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
                        ref={customDateInputRef}
                        type="date"
                        aria-label="Secilen tarih"
                        value={selectedDate}
                        onChange={(event) => setSelectedDate(event.target.value)}
                        onClick={(event) => {
                          if (typeof event.currentTarget.showPicker === "function") {
                            event.currentTarget.showPicker();
                          }
                        }}
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
                            <td>{formatTableDateTime(order.createdAt)}</td>
                            <td className="buyer-order-no">{order.orderNo}</td>
                            <td>{order.sellerName ?? order.sellerEmail ?? order.sellerId}</td>
                            <td>{activeTab === "orders" ? (foods || "-") : `${paymentState.text} • ${foods || "-"}`}</td>
                            <td>{formatCurrency(order.totalAmount, "tr")}</td>
                            <td><span className={`buyer-payment-badge ${paymentState.cls}`}>{statusText}</span></td>
                            <td><span className="status-pill is-success">Aktif</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <Pager
                  page={ordersPagination?.page ?? 1}
                  totalPages={ordersPagination?.totalPages ?? 1}
                  summary={ordersPagination ? `Toplam: ${ordersPagination.total} | Sayfa ${ordersPagination.page} / ${ordersPagination.totalPages}` : "Toplam: 0 | Sayfa 1 / 1"}
                  prevLabel="Önceki"
                  nextLabel="Sonraki"
                  onPageChange={setOrdersPage}
                  onPrev={() => setOrdersPage(Math.max(1, (ordersPagination?.page ?? 1) - 1))}
                  onNext={() => setOrdersPage(Math.min(ordersPagination?.totalPages ?? 1, (ordersPagination?.page ?? 1) + 1))}
                />
              </>
            ) : null}

            {activeTab === "complaints" ? (
              <div className="buyer-ops-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Tarih / Saat</th>
                      <th>Aciklama</th>
                      <th>Siparis No</th>
                      <th>Kategori</th>
                      <th>Durum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {complaints.length === 0 ? (
                      <tr><td colSpan={5}>Sikayet kaydi bulunamadi.</td></tr>
                    ) : complaints.map((item) => (
                      <tr key={item.id}>
                        <td>{formatTableDateTime(item.createdAt)}</td>
                        <td>{item.description?.trim() || "-"}</td>
                        <td className="buyer-order-no">{item.orderNo}</td>
                        <td>{item.categoryName ?? item.categoryCode ?? "-"}</td>
                        <td>{item.status}</td>
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
                        <td>{formatTableDateTime(item.createdAt)}</td>
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
                    <p className="buyer-ref-activity-top"><span aria-hidden="true">•</span> {toRelativeTimeTR(item.at)}</p>
                    <p className="buyer-ref-activity-action">{item.action}</p>
                    <p className="panel-meta">{item.detail}</p>
                  </article>
                ))}
              </div>
            ) : null}

            {activeTab === "notes" ? (
              <NotesPanel
                noteItems={noteItems}
                tagItems={tagItems}
                language={language}
                onAddNote={handleAddNote}
                onDeleteNote={handleDeleteNote}
                onSaveNote={handleSaveNote}
                onAddTag={handleAddTag}
                onDeleteTag={handleDeleteTag}
              />
            ) : null}

            {activeTab === "create_ticket" ? (
              <div className="create-ticket-form">
                <h3 className="create-ticket-title">Yeni Destek Talebi</h3>
                <p className="panel-meta" style={{ marginBottom: 20 }}>Bu alıcı adına sisteme yeni bir şikayet talebi açar.</p>

                {ticketError ? <div className="alert" style={{ marginBottom: 16 }}>{ticketError}</div> : null}
                {ticketSuccess ? (
                  <div className="create-ticket-success">
                    <p>Talep oluşturuldu.</p>
                    <button
                      className="primary"
                      type="button"
                      onClick={() => navigate(`/app/investigation/${ticketSuccess.id}`)}
                    >
                      Talebi Görüntüle
                    </button>
                  </div>
                ) : null}

                <div className="create-ticket-fields">
                  <label className="create-ticket-field">
                    <span className="complaint-detail-label">Sipariş *</span>
                    <select
                      value={ticketOrderId}
                      onChange={(e) => setTicketOrderId(e.target.value)}
                      disabled={ticketSubmitting}
                    >
                      <option value="">-- Sipariş Seçin --</option>
                      {orders.map((order) => (
                        <option key={order.orderId} value={order.orderId}>
                          {order.orderNo} — {order.sellerName ?? order.sellerEmail ?? order.sellerId.slice(0, 10)} — {new Date(order.createdAt).toLocaleDateString("tr-TR")}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="create-ticket-field">
                    <span className="complaint-detail-label">Açıklama *</span>
                    <textarea
                      value={ticketDescription}
                      onChange={(e) => setTicketDescription(e.target.value)}
                      placeholder="Detayları girin..."
                      rows={4}
                      disabled={ticketSubmitting}
                    />
                  </label>

                  <div className="create-ticket-field">
                    <span className="complaint-detail-label">Kategori</span>
                    <select
                      value={ticketCategoryId}
                      onChange={(e) => setTicketCategoryId(e.target.value)}
                      disabled={ticketSubmitting}
                      style={{ marginTop: 8 }}
                    >
                      <option value="">-- Kategori Seçin --</option>
                      {ticketCategories.map((cat) => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="create-ticket-field">
                    <span className="complaint-detail-label">Öncelik</span>
                    <div className="complaint-priority-buttons" style={{ marginTop: 8 }}>
                      {(["low", "medium", "high", "urgent"] as const).map((p) => (
                        <button
                          key={p}
                          type="button"
                          disabled={ticketSubmitting}
                          className={`complaint-priority-btn priority-${p}${ticketPriority === p ? " is-active" : ""}`}
                          onClick={() => setTicketPriority(p)}
                        >
                          {p === "low" ? "Düşük" : p === "medium" ? "Orta" : p === "high" ? "Yüksek" : "Acil"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="topbar-actions" style={{ marginTop: 24 }}>
                  <button
                    className="primary"
                    type="button"
                    disabled={ticketSubmitting || !ticketOrderId || !ticketDescription.trim()}
                    onClick={() => void submitTicket()}
                  >
                    {ticketSubmitting ? "Kaydediliyor..." : "Talebi Oluştur"}
                  </button>
                </div>
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

      {profileModalOpen ? (
        <div
          className="buyer-ops-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Profil bilgileri"
          onClick={() => setProfileModalOpen(false)}
        >
          <div className="buyer-ops-modal buyer-ref-profile-modal" onClick={(event) => event.stopPropagation()}>
            <div className="buyer-ref-profile-modal-head">
              <div>
                <h3>Profil Bilgileri</h3>
                <p>{fullName}</p>
              </div>
              <button type="button" className="ghost buyer-ops-mini-btn" onClick={() => setProfileModalOpen(false)}>Kapat</button>
            </div>
            <div className="buyer-ref-contact-block">
              <div className="buyer-ref-info-row">
                <p className="buyer-ref-contact-label"><span className="buyer-ref-side-icon" aria-hidden="true">✉</span> E-posta</p>
                <p className="buyer-ref-contact-value buyer-ref-info-value">{email}</p>
              </div>
            </div>
            {allAddresses.length === 0 ? (
              <div className="buyer-ref-contact-block">
                <div className="buyer-ref-info-row">
                  <p className="buyer-ref-contact-label"><span className="buyer-ref-side-icon" aria-hidden="true">⌂</span> Adres</p>
                  <p className="buyer-ref-contact-value buyer-ref-info-value">Adres yok</p>
                </div>
              </div>
            ) : (
              allAddresses.map((address) => (
                <button key={address.id} type="button" className="buyer-ref-link-block buyer-ref-contact-block" onClick={() => openAddressInMaps(address.addressLine)}>
                  <div className="buyer-ref-info-row">
                    <p className="buyer-ref-contact-label">
                      <span className="buyer-ref-side-icon" aria-hidden="true">⌂</span>
                      {address.title || "Adres"} {address.isDefault ? "(Varsayilan)" : ""}
                    </p>
                    <p className="buyer-ref-contact-value buyer-ref-info-value">{address.addressLine}</p>
                  </div>
                </button>
              ))
            )}
            <button type="button" className="buyer-ref-link-block buyer-ref-contact-block" onClick={() => openDialer(phone)}>
              <div className="buyer-ref-info-row">
                <p className="buyer-ref-contact-label"><span className="buyer-ref-side-icon" aria-hidden="true">✆</span> Cep</p>
                <p className="buyer-ref-contact-value buyer-ref-phone-row buyer-ref-info-value">
                  <strong>{phone}</strong>
                  <span className="buyer-ref-online-dot" aria-hidden="true" />
                </p>
              </div>
            </button>
            <button type="button" className="buyer-ref-link-block buyer-ref-contact-block" onClick={() => switchBuyerTab("activity")}>
              <div className="buyer-ref-info-row">
                <p className="buyer-ref-contact-label"><span className="buyer-ref-side-icon" aria-hidden="true">⌖</span> Giris Lokasyonlari</p>
                <p className="buyer-ref-contact-value buyer-ref-info-value">{`${locations.length} lokasyon`}</p>
              </div>
            </button>
            <div className="buyer-ref-contact-block">
              <div className="buyer-ref-info-row">
                <p className="buyer-ref-contact-label"><span className="buyer-ref-side-icon" aria-hidden="true">◷</span> Son Giris</p>
                <p className="buyer-ref-contact-value buyer-ref-info-value">{detailLastLoginAt}</p>
              </div>
            </div>
            <div className="buyer-ref-contact-block">
              <div className="buyer-ref-info-row">
                <p className="buyer-ref-contact-label">Dogum Tarihi</p>
                <p className="buyer-ref-contact-value buyer-ref-info-value">{birthDateText}</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}

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
