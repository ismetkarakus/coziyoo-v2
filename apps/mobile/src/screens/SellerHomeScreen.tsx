import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, Dimensions, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { AuthSession } from "../utils/auth";
import { refreshAuthSession } from "../utils/auth";
import { actorRoleHeader } from "../utils/actorRole";
import { loadSettings } from "../utils/settings";
import { getSellerFoodsCache, setSellerFoodsCache } from "../utils/sellerFoodsCache";
import { subscribeSellerOrdersRealtime } from "../utils/realtime";

type Props = {
  auth: AuthSession;
  onAuthRefresh?: (session: AuthSession) => void;
  onOpenProfile: () => void;
  onOpenFoodsManager: () => void;
  onOpenOrderHistory: () => void;
  onOpenOrder: (orderId: string) => void;
  onSwitchToBuyer?: () => void;
};

type SellerOrder = {
  id: string;
  sellerId?: string | null;
  orderNo?: string | null;
  buyerName?: string | null;
  primaryFoodName?: string | null;
  itemCount?: number | null;
  status: string;
  deliveryType?: "pickup" | "delivery" | string;
  totalPrice: number;
  createdAt?: string;
  updatedAt?: string;
};

type SellerAction =
  | { label: "Hazırlanıyor"; kind: "to_preparing"; tone?: "info" }
  | { label: "Hazır"; kind: "to_ready"; tone?: "primary" }
  | { label: "Yola Çıktı"; kind: "to_in_delivery"; tone?: "primary" }
  | { label: "Teslim Edildi"; kind: "to_delivered"; tone?: "primary" };

type ActiveFood = {
  id: string;
  name: string;
  price: number;
  isActive: boolean;
  stock: number;
};

function parseApiDate(value?: string | null): Date | null {
  if (!value?.trim()) return null;
  const normalized = value.trim().replace(" ", "T").replace(/(\.\d+)?([+-]\d{2})$/, "$1$2:00");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function isSameLocalDay(date: Date, reference: Date): boolean {
  return (
    date.getFullYear() === reference.getFullYear() &&
    date.getMonth() === reference.getMonth() &&
    date.getDate() === reference.getDate()
  );
}

function statusLabel(status: string, deliveryType?: string): string {
  if (status === "pending_seller_approval" || status === "seller_approved" || status === "awaiting_payment") return "Ödeme Bekleniyor";
  if (status === "paid") return "Ödeme Alındı";
  if (status === "preparing") return "Hazırlanıyor";
  if (status === "ready") return "Hazır";
  if (status === "in_delivery" && deliveryType === "pickup") return "Teslim Edildi";
  if (status === "in_delivery") return "Yolda";
  if (status === "delivered") return "Teslim Edildi";
  if (status === "completed") return "Sipariş Tamamlandı";
  if (status === "cancelled") return "İptal";
  if (status === "rejected") return "İptal";
  return status;
}

function statusTone(status: string, deliveryType?: string): { bg: string; border: string; text: string } {
  if (status === "seller_approved" || status === "awaiting_payment") {
    return { bg: "#FFF4E5", border: "#F3D3A1", text: "#B45309" };
  }
  if (status === "paid") {
    return { bg: "#EAF7EE", border: "#B7DEC3", text: "#166534" };
  }
  if (status === "preparing") return { bg: "#F4E2CF", border: "#D4A373", text: "#8A4B16" };
  if (status === "completed") return { bg: "#EAF7EE", border: "#B7DEC3", text: "#166534" };
  if (status === "in_delivery" && deliveryType === "pickup") {
    return { bg: "#FFF4E5", border: "#F7D7A8", text: "#B45309" };
  }
  if (status === "in_delivery") {
    return { bg: "#E6F7EC", border: "#BFE7CC", text: "#2E7D4E" };
  }
  if (status === "delivered" || status === "completed") {
    return { bg: "#EAF7EE", border: "#B7DEC3", text: "#166534" };
  }
  if (status === "pending_seller_approval") return { bg: "#FFF4E5", border: "#F3D3A1", text: "#B45309" };
  return { bg: "#F7EFE2", border: "#D6CCBD", text: "#5C4A3A" };
}

function cardActionsByStatus(status: string, deliveryType?: string): SellerAction[] {
  // pending_seller_approval / seller_approved / awaiting_payment:
  // buyer has not paid yet — seller has no action, just waits for payment.
  if (status === "paid") return [{ label: "Hazırlanıyor", kind: "to_preparing", tone: "info" }];
  if (status === "preparing") return [{ label: "Hazır", kind: "to_ready", tone: "primary" }];
  if (status === "ready" && deliveryType === "pickup") return [{ label: "Teslim Edildi", kind: "to_delivered", tone: "primary" }];
  if (status === "ready") return [{ label: "Yola Çıktı", kind: "to_in_delivery", tone: "primary" }];
  if (status === "in_delivery") return [{ label: "Teslim Edildi", kind: "to_delivered", tone: "primary" }];
  return [];
}

function statusFooter(status: string): { label: string; variant: "preparing" | "completed" } | null {
  if (status === "preparing") return { label: "Hazırlanıyor", variant: "preparing" };
  if (status === "completed") return { label: "Sipariş Tamamlandı", variant: "completed" };
  return null;
}

export default function SellerHomeScreen({
  auth,
  onAuthRefresh,
  onOpenProfile,
  onOpenFoodsManager,
  onOpenOrderHistory,
  onOpenOrder,
  onSwitchToBuyer,
}: Props) {
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState<string>("Usta");
  const [orders, setOrders] = useState<SellerOrder[]>([]);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFoods, setActiveFoods] = useState<ActiveFood[]>(() => {
    const cached = getSellerFoodsCache();
    if (!Array.isArray(cached)) return [];
    return cached
      .filter((f) => f.isActive)
      .map((f) => ({
        id: String(f.id ?? ""),
        name: String(f.name ?? ""),
        price: Number(f.price ?? 0),
        isActive: true,
        stock: Number(f.stock ?? 0),
      }));
  });
  const [activePage, setActivePage] = useState(0);
  const pagerRef = useRef<ScrollView>(null);
  const screenWidth = Dimensions.get("window").width;

  useEffect(() => setCurrentAuth(auth), [auth]);

  async function fetchWithAuth(path: string, baseUrl = apiUrl): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${currentAuth.accessToken}`,
      ...actorRoleHeader(currentAuth, "seller"),
    };
    let res = await fetch(`${baseUrl}${path}`, { headers });
    if (res.status !== 401 && res.status !== 403) return res;
    const refreshed = await refreshAuthSession(baseUrl, currentAuth);
    if (!refreshed) return res;
    setCurrentAuth(refreshed);
    onAuthRefresh?.(refreshed);
    return fetch(`${baseUrl}${path}`, {
      headers: { ...headers, Authorization: `Bearer ${refreshed.accessToken}`, ...actorRoleHeader(refreshed, "seller") },
    });
  }

  async function fetchWithAuthInit(path: string, init: RequestInit, baseUrl = apiUrl): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${currentAuth.accessToken}`,
      ...actorRoleHeader(currentAuth, "seller"),
      ...(init.headers as Record<string, string> | undefined),
    };
    let res = await fetch(`${baseUrl}${path}`, { ...init, headers });
    if (res.status !== 401 && res.status !== 403) return res;
    const refreshed = await refreshAuthSession(baseUrl, currentAuth);
    if (!refreshed) return res;
    setCurrentAuth(refreshed);
    onAuthRefresh?.(refreshed);
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...headers,
        Authorization: `Bearer ${refreshed.accessToken}`,
        ...actorRoleHeader(refreshed, "seller"),
      },
    });
  }

  async function load() {
    if (getSellerFoodsCache() === null) setLoading(true);
    try {
      const settings = await loadSettings();
      const baseUrl = settings.apiUrl;
      setApiUrl(baseUrl);
      const [profileRes, ordersRes, foodsRes] = await Promise.all([
        fetchWithAuth("/v1/seller/profile", baseUrl),
        fetchWithAuth("/v1/seller/orders?page=1&pageSize=200", baseUrl),
        fetchWithAuth("/v1/seller/foods", baseUrl),
      ]);
      const profileJson = await profileRes.json();
      if (profileRes.ok) setDisplayName(profileJson.data?.displayName?.trim() || "Usta");
      if (ordersRes.ok) {
        const ordersJson = await ordersRes.json();
        let sellerOrders: SellerOrder[] = Array.isArray(ordersJson.data) ? ordersJson.data : [];

        // Keep the home feed aligned with SellerOrdersScreen when the seller-scoped
        // endpoint returns empty due to legacy actor filtering in some environments.
        if (sellerOrders.length === 0) {
          const fallbackRes = await fetchWithAuth("/v1/orders?page=1&pageSize=200&role=seller", baseUrl);
          const fallbackJson = await fallbackRes.json().catch(() => ({}));
          if (fallbackRes.ok && Array.isArray(fallbackJson?.data)) {
            const fromAll = fallbackJson.data.filter((row: SellerOrder & { sellerId?: string }) => row.sellerId === currentAuth.userId);
            sellerOrders = fromAll.length > 0 ? fromAll : fallbackJson.data;
          }
        }

        setOrders(sellerOrders);
      }
      if (foodsRes.ok) {
        const foodsJson = await foodsRes.json();
        if (Array.isArray(foodsJson?.data)) {
          const foods = foodsJson.data as Record<string, unknown>[];
          setSellerFoodsCache(foods);
          setActiveFoods(
            foods
              .filter((f) => f.isActive)
              .map((f) => ({
                id: String(f.id ?? ""),
                name: String(f.name ?? ""),
                price: Number(f.price ?? 0),
                isActive: true,
                stock: Number(f.stock ?? 0),
              })),
          );
        }
      }
    } catch {
      // best-effort
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    const unsubscribe = subscribeSellerOrdersRealtime(currentAuth.userId, () => {
      void load();
    });
    return unsubscribe;
  }, [currentAuth.userId]);

  // Reload when app returns to foreground (covers case where realtime is not configured)
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") void load();
    });
    return () => sub.remove();
  }, []);

  // Polling fallback: refresh every 30 s so new orders always appear
  useEffect(() => {
    const id = setInterval(() => { void load(); }, 30_000);
    return () => clearInterval(id);
  }, []);

  const activeOrders = useMemo(() => {
    const now = new Date();
    const filtered = orders.filter((o) => {
      if (o.sellerId && o.sellerId !== currentAuth.userId) return false;
      if (!["pending_seller_approval", "seller_approved", "awaiting_payment", "paid", "preparing", "ready", "in_delivery", "delivered", "completed"].includes(o.status)) return false;
      const activityAt = parseApiDate(o.updatedAt) ?? parseApiDate(o.createdAt);
      if (!activityAt) return false;
      return isSameLocalDay(activityAt, now);
    });
    const statusPriority: Record<string, number> = {
      pending_seller_approval: 0,
      seller_approved: 1,
      awaiting_payment: 1,
      paid: 2,
      preparing: 3,
      ready: 4,
      in_delivery: 5,
      delivered: 6,
      completed: 7,
    };
    return [...filtered].sort((a, b) => {
      const pa = statusPriority[a.status] ?? 9;
      const pb = statusPriority[b.status] ?? 9;
      if (pa !== pb) return pa - pb;
      const aTime = (parseApiDate(a.updatedAt) ?? parseApiDate(a.createdAt))?.getTime() ?? 0;
      const bTime = (parseApiDate(b.updatedAt) ?? parseApiDate(b.createdAt))?.getTime() ?? 0;
      return bTime - aTime;
    });
  }, [orders, currentAuth.userId]);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function changeStatus(orderId: string, toStatus: "ready" | "in_delivery" | "delivered" | "preparing"): Promise<void> {
    const res = await fetchWithAuthInit(
      `/v1/orders/${orderId}/status`,
      {
        method: "POST",
        body: JSON.stringify({ toStatus }),
      },
      apiUrl,
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error?.message ?? "Durum güncellenemedi");
  }

  async function runCardAction(orderId: string, action: SellerAction) {
    try {
      setUpdatingOrderId(orderId);
      if (action.kind === "to_preparing") {
        await changeStatus(orderId, "preparing");
      } else if (action.kind === "to_ready") {
        await changeStatus(orderId, "ready");
      } else if (action.kind === "to_in_delivery") {
        await changeStatus(orderId, "in_delivery");
      } else if (action.kind === "to_delivered") {
        await changeStatus(orderId, "delivered");
      }
      await load();
    } catch (error) {
      Alert.alert("Hata", error instanceof Error ? error.message : "İşlem başarısız");
    } finally {
      setUpdatingOrderId(null);
    }
  }

  const initials = displayName
    .split(" ")
    .slice(0, 2)
    .map((w: string) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <View style={styles.container}>
      <View style={styles.stickyTop}>
        {/* Greeting + Avatar */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.title} numberOfLines={1}>Merhaba, {displayName} 👋</Text>
          </View>
          <TouchableOpacity style={styles.avatar} onPress={onOpenProfile} activeOpacity={0.8}>
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.avatarText}>{initials}</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Üst Hızlı Butonlar */}
        <View style={styles.quickButtonsRow}>
          <TouchableOpacity style={styles.quickButton} activeOpacity={0.85} onPress={onOpenFoodsManager}>
            <Text style={styles.quickButtonText}>Yemek Yönetimi</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickButton} activeOpacity={0.85} onPress={onOpenOrderHistory}>
            <Text style={styles.quickButtonText}>Sipariş Geçmişim</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Stats header */}
      <View style={styles.ordersHead}>
        <TouchableOpacity style={styles.statBlock} activeOpacity={0.75} onPress={() => {
          pagerRef.current?.scrollTo({ x: 0, animated: true });
          setActivePage(0);
        }}>
          <Text style={[styles.statCount, activePage === 0 && styles.statCountActive]}>{activeOrders.length}</Text>
          <Text style={[styles.statLabel, activePage === 0 && styles.statLabelActive]}>Bugünkü Siparişler</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.statBlock} activeOpacity={0.75} onPress={() => {
          pagerRef.current?.scrollTo({ x: screenWidth, animated: true });
          setActivePage(1);
        }}>
          <Text style={[styles.statCount, activePage === 1 && styles.statCountActive]}>{activeFoods.length}</Text>
          <Text style={[styles.statLabel, activePage === 1 && styles.statLabelActive]}>Satıştaki Yemekler</Text>
        </TouchableOpacity>
      </View>

      {/* Horizontal pager */}
      <ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        directionalLockEnabled={true}
        disableIntervalMomentum={true}
        onMomentumScrollEnd={(e) => {
          const page = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
          setActivePage(page);
        }}
        style={styles.pager}
      >
        {/* Sayfa 1: Bugünkü Siparişler */}
        <ScrollView
          style={{ width: screenWidth }}
          contentContainerStyle={styles.ordersContent}
          nestedScrollEnabled={true}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        >
          <View style={styles.ordersSection}>
            {activeOrders.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>Aktif sipariş yok</Text>
                <Text style={styles.emptySub}>Yeni sipariş geldiğinde burada görünecek.</Text>
              </View>
            ) : (
              activeOrders.map((item) => {
                const actions = cardActionsByStatus(item.status, item.deliveryType);
                const isUpdating = updatingOrderId === item.id;
                const tone = statusTone(item.status, item.deliveryType);
                const footer = statusFooter(item.status);
                return (
                  <View key={item.id} style={styles.orderCard}>
                    <TouchableOpacity activeOpacity={0.82} onPress={() => onOpenOrder(item.id)}>
                      <View style={styles.orderTopRow}>
                        <Text style={styles.orderNo} numberOfLines={1}>
                          {item.primaryFoodName?.trim() || item.orderNo || `#${item.id.slice(0, 8).toUpperCase()}`}
                          {item.itemCount && item.itemCount > 1 ? ` +${item.itemCount - 1}` : ""}
                        </Text>
                        <View style={[styles.statusBadge, { backgroundColor: tone.bg, borderColor: tone.border }]}>
                          <Text style={[styles.statusBadgeText, { color: tone.text }]}>{statusLabel(item.status, item.deliveryType)}</Text>
                        </View>
                      </View>
                      <Text style={styles.orderSubNo}>{item.orderNo || `#${item.id.slice(0, 8).toUpperCase()}`}</Text>
                      <Text style={styles.orderMeta}>Alıcı: {item.buyerName || "-"}</Text>
                      <Text style={styles.orderMeta}>Teslimat: {item.deliveryType === "delivery" ? "Teslimat" : "Gel Al"}</Text>
                      <Text style={styles.orderTotal}>{Number(item.totalPrice ?? 0).toFixed(2)} TL</Text>
                    </TouchableOpacity>
                    {actions.length > 0 ? (
                      <View style={styles.cardActionRow}>
                        {actions.map((action) => (
                          <TouchableOpacity
                            key={`${item.id}-${action.kind}`}
                            activeOpacity={0.86}
                            style={[
                              styles.cardActionBtn,
                              styles.cardActionBtnPrimary,
                              action.tone === "info" ? styles.cardActionBtnInfo : null,
                              isUpdating && styles.cardActionBtnDisabled,
                            ]}
                            disabled={isUpdating}
                            onPress={() => { void runCardAction(item.id, action); }}
                          >
                            <Text
                              style={[
                                styles.cardActionBtnText,
                                styles.cardActionBtnTextPrimary,
                                action.tone === "info" ? styles.cardActionBtnTextInfo : null,
                              ]}
                            >
                              {isUpdating ? "İşleniyor..." : action.label}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    ) : null}
                    {footer ? (
                      <View
                        style={[
                          styles.statusFooterButton,
                          footer.variant === "preparing" ? styles.statusFooterPreparing : styles.statusFooterCompleted,
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusFooterText,
                            footer.variant === "preparing" ? styles.statusFooterTextPreparing : styles.statusFooterTextCompleted,
                          ]}
                        >
                          {footer.label}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                );
              })
            )}
          </View>
          {onSwitchToBuyer ? (
            <View style={styles.actions}>
              <TouchableOpacity activeOpacity={0.86} style={styles.switchRoleButton} onPress={onSwitchToBuyer}>
                <Text style={styles.switchRoleButtonText}>Alıcı Moduna Geç</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </ScrollView>

        {/* Sayfa 2: Satıştaki Yemekler */}
        <ScrollView style={{ width: screenWidth }} contentContainerStyle={styles.ordersContent} nestedScrollEnabled={true}>
          <View style={styles.ordersSection}>
            {activeFoods.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>Satıştaki yemek yok</Text>
                <Text style={styles.emptySub}>Yemek Yönetimi'nden yemek aktifleştirebilirsin.</Text>
              </View>
            ) : (
              activeFoods.map((food) => (
                <View key={food.id} style={styles.orderCard}>
                  <View style={styles.orderTopRow}>
                    <Text style={styles.orderNo} numberOfLines={1}>{food.name}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: "#EAF7EE", borderColor: "#B7DEC3" }]}>
                      <Text style={[styles.statusBadgeText, { color: "#166534" }]}>Aktif</Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                    <Text style={styles.orderTotal}>{Number(food.price).toFixed(2)} TL</Text>
                    <Text style={styles.orderMeta}>Stok: {food.stock} adet</Text>
                  </View>
                </View>
              ))
            )}
          </View>
        </ScrollView>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F4EF" },
  stickyTop: {
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 12,
    backgroundColor: "#F7F4EF",
    borderBottomWidth: 1,
    borderBottomColor: "#E6DED1",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  headerLeft: {
    flex: 1,
    paddingRight: 14,
  },
  title: {
    fontSize: 26,
    color: "#4A3B2F",
    letterSpacing: -0.5,
    ...(Platform.OS === "ios"
      ? { fontFamily: "AvenirNextCondensed-Bold", fontWeight: "700" }
      : { fontFamily: "sans-serif-condensed", fontWeight: "700" }),
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#3F855C",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#fff", fontSize: 18, fontWeight: "800" },
  quickButtonsRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  quickButton: {
    flex: 1,
    backgroundColor: "#F9E9D5",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#79BA94",
    paddingVertical: 10,
    alignItems: "center",
  },
  quickButtonText: {
    color: "#1D5634",
    fontSize: 17,
    fontWeight: "700",
    ...(Platform.OS === "ios"
      ? { fontFamily: "AvenirNextCondensed-DemiBold" }
      : { fontFamily: "sans-serif-condensed" }),
  },
  ordersScroll: { flex: 1 },
  ordersContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 36 },
  ordersSection: { marginBottom: 14 },
  ordersHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8, paddingHorizontal: 16 },
  ordersTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  ordersTitle: { fontSize: 18, fontWeight: "800", color: "#4A3B2F" },
  ordersCountChip: { alignItems: "center", justifyContent: "center" },
  ordersCountChipText: { color: "#5C4A3A", fontSize: 18, fontWeight: "800" },
  pager: { flex: 1 },
  statBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderBottomWidth: 2,
    borderBottomColor: "#C8BFB3",
    paddingBottom: 4,
  },
  statCount: {
    fontSize: 26,
    fontWeight: "800",
    color: "#3F855C",
    ...(Platform.OS === "ios"
      ? { fontFamily: "AvenirNextCondensed-Bold" }
      : { fontFamily: "sans-serif-condensed" }),
  },
  statCountActive: { color: "#1D5634" },
  statLabel: {
    fontSize: 17,
    fontWeight: "700",
    color: "#4A3B2F",
    ...(Platform.OS === "ios"
      ? { fontFamily: "AvenirNextCondensed-DemiBold" }
      : { fontFamily: "sans-serif-condensed" }),
  },
  statLabelActive: { color: "#1D5634" },
  emptyCard: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5DDCF", padding: 12 },
  emptyTitle: { color: "#4A3B2F", fontWeight: "800" },
  emptySub: { color: "#6C6055", marginTop: 4 },
  orderCard: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5DDCF", padding: 12, marginBottom: 10 },
  orderTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  orderNo: { color: "#4A3B2F", fontWeight: "800", fontSize: 16, flex: 1 },
  orderSubNo: { color: "#887766", fontSize: 12, marginTop: 2, marginBottom: 2 },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#D6CCBD",
    backgroundColor: "#F7EFE2",
  },
  statusBadgeText: { color: "#5C4A3A", fontSize: 11, fontWeight: "700" },
  orderMeta: { color: "#6C6055", marginTop: 3 },
  orderTotal: { marginTop: 8, color: "#4A3B2F", fontWeight: "800" },
  cardActionRow: { marginTop: 10, flexDirection: "row", gap: 8 },
  cardActionBtn: { flex: 1, borderRadius: 10, borderWidth: 1, paddingVertical: 10, alignItems: "center" },
  cardActionBtnPrimary: { backgroundColor: "#3F855C", borderColor: "#3F855C" },
  cardActionBtnInfo: { backgroundColor: "#B7791F", borderColor: "#B7791F" },
  cardActionBtnDanger: { backgroundColor: "#FFF0EE", borderColor: "#F9CECA" },
  cardActionBtnDisabled: { opacity: 0.6 },
  cardActionBtnText: { fontWeight: "700", fontSize: 13 },
  cardActionBtnTextPrimary: { color: "#FFFFFF" },
  cardActionBtnTextInfo: { color: "#FFFFFF" },
  cardActionBtnTextDanger: { color: "#B42318" },
  statusFooterButton: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  statusFooterPreparing: { backgroundColor: "#F4E2CF", borderColor: "#D4A373" },
  statusFooterCompleted: { backgroundColor: "#EAF7EE", borderColor: "#B7DEC3" },
  statusFooterText: { fontSize: 14, fontWeight: "800" },
  statusFooterTextPreparing: { color: "#8A4B16" },
  statusFooterTextCompleted: { color: "#166534" },
  actions: { gap: 10 },
  switchRoleButton: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#CFC5B6",
    backgroundColor: "#F7F4EF",
    alignItems: "center",
    justifyContent: "center",
  },
  switchRoleButtonText: {
    color: "#5C4A3A",
    fontSize: 14,
    fontWeight: "700",
  },
});
