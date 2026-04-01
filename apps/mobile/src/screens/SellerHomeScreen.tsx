import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, AppState, Dimensions, Easing, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { AuthSession } from "../utils/auth";
import { refreshAuthSession } from "../utils/auth";
import { actorRoleHeader } from "../utils/actorRole";
import { loadSettings } from "../utils/settings";
import { getSellerFoodsCache, setSellerFoodsCache } from "../utils/sellerFoodsCache";
import { getSellerOrdersCache, setSellerOrdersCache, getSellerDisplayNameCache, setSellerDisplayNameCache } from "../utils/sellerOrdersCache";
import { subscribeSellerOrdersRealtime } from "../utils/realtime";
import { getStatusInfo } from "../components/StatusBadge";

type Props = {
  auth: AuthSession;
  onAuthRefresh?: (session: AuthSession) => void;
  onOpenProfile: () => void;
  onOpenFoodsManager: () => void;
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
  | { label: "Hazırlanıyor"; toStatus: "preparing"; tone: "preparing" }
  | { label: "Yola Çıktı"; toStatus: "in_delivery"; tone: "in_delivery" }
  | { label: "Kapıda"; toStatus: "delivered"; tone: "delivered" }
  | { label: "Teslim Edildi"; toStatus: "completed"; tone: "completed" };

type OrderGroupKey = "preparing" | "route" | "done";

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

function formatOrderDateTime(value?: string): string {
  const parsed = parseApiDate(value);
  if (!parsed) return "-";
  const day = parsed.getDate().toString().padStart(2, "0");
  const month = (parsed.getMonth() + 1).toString().padStart(2, "0");
  const hours = parsed.getHours().toString().padStart(2, "0");
  const minutes = parsed.getMinutes().toString().padStart(2, "0");
  return `${day}.${month} ${hours}:${minutes}`;
}

function orderTimeForSort(order: SellerOrder): number {
  return (parseApiDate(order.createdAt) ?? parseApiDate(order.updatedAt))?.getTime() ?? 0;
}

function formatElapsed(value: string | undefined, nowMs: number): string {
  const parsed = parseApiDate(value);
  if (!parsed) return "Süre bilgisi yok";
  const diffMs = Math.max(0, nowMs - parsed.getTime());
  const totalMinutes = Math.floor(diffMs / 60_000);
  if (totalMinutes < 1) return "Az önce geldi";
  if (totalMinutes < 60) return `${totalMinutes} dk geçti`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return `${hours} sa ${minutes} dk geçti`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return `${days} gün ${remHours} sa geçti`;
}

function statusLabel(status: string, deliveryType?: string): string {
  const normalized = normalizeDisplayStatus(status, deliveryType);
  if (normalized === "cancelled" || normalized === "rejected") return "İptal";
  return getStatusInfo(normalized).label;
}

function statusTone(status: string, deliveryType?: string): { bg: string; border: string; text: string } {
  const normalized = normalizeDisplayStatus(status, deliveryType);
  const info = getStatusInfo(normalized);
  const borders: Record<string, string> = {
    preparing: "#F5C27A",
    in_delivery: "#AFC6FF",
    delivered: "#9EDBD2",
    completed: "#79C796",
    cancelled: "#F2B5B0",
    rejected: "#F2B5B0",
  };
  return {
    bg: info.bg,
    border: borders[normalized] ?? "#D6CCBD",
    text: info.color,
  };
}

function normalizeDisplayStatus(status: string, deliveryType?: string): string {
  if (status === "cancelled" || status === "rejected") return status;
  if (status === "delivered" || status === "completed") return status;
  if (status === "in_delivery" && deliveryType === "pickup") return "delivered";
  if (status === "in_delivery" || status === "ready") return "in_delivery";
  if (["pending_seller_approval", "seller_approved", "awaiting_payment", "paid", "preparing"].includes(status)) return status;
  return status;
}

function cardActionByStatus(status: string, deliveryType?: string): SellerAction | null {
  if (status === "paid") {
    return { label: "Hazırlanıyor", toStatus: "preparing", tone: "preparing" };
  }
  if (status === "preparing") {
    return deliveryType === "pickup"
      ? { label: "Kapıda", toStatus: "delivered", tone: "delivered" }
      : { label: "Yola Çıktı", toStatus: "in_delivery", tone: "in_delivery" };
  }
  if (status === "ready") {
    return deliveryType === "pickup"
      ? { label: "Kapıda", toStatus: "delivered", tone: "delivered" }
      : { label: "Yola Çıktı", toStatus: "in_delivery", tone: "in_delivery" };
  }
  if (status === "in_delivery") return { label: "Kapıda", toStatus: "delivered", tone: "delivered" };
  if (status === "delivered") return { label: "Teslim Edildi", toStatus: "completed", tone: "completed" };
  return null;
}

function toneFromStatus(status: string, deliveryType?: string): SellerAction["tone"] | null {
  const normalized = normalizeDisplayStatus(status, deliveryType);
  if (normalized === "preparing") return "preparing";
  if (normalized === "in_delivery") return "in_delivery";
  if (normalized === "delivered") return "delivered";
  if (normalized === "completed") return "completed";
  return null;
}

function orderGroupKey(status: string, deliveryType?: string): OrderGroupKey {
  const normalized = normalizeDisplayStatus(status, deliveryType);
  if (normalized === "in_delivery" || normalized === "delivered") return "route";
  if (normalized === "completed" || normalized === "cancelled" || normalized === "rejected") return "done";
  return "preparing";
}

export default function SellerHomeScreen({
  auth,
  onAuthRefresh,
  onOpenProfile,
  onOpenFoodsManager,
  onOpenOrder,
  onSwitchToBuyer,
}: Props) {
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(() => getSellerOrdersCache() === null && getSellerFoodsCache() === null);
  const [displayName, setDisplayName] = useState<string>(() => getSellerDisplayNameCache() ?? "Usta");
  const [orders, setOrders] = useState<SellerOrder[]>(() => {
    const cached = getSellerOrdersCache();
    if (!Array.isArray(cached)) return [];
    return cached as SellerOrder[];
  });
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
  const [celebrationOrderId, setCelebrationOrderId] = useState<string | null>(null);
  const [newOrderUntilById, setNewOrderUntilById] = useState<Record<string, number>>({});
  const [clockMs, setClockMs] = useState(() => Date.now());
  const pagerRef = useRef<ScrollView>(null);
  const screenWidth = Dimensions.get("window").width;
  const deliveredEmojiScale = useRef(new Animated.Value(0.4)).current;
  const deliveredEmojiOpacity = useRef(new Animated.Value(0)).current;
  const pulseValue = useRef(new Animated.Value(0)).current;
  const seenOrderIdsRef = useRef<Set<string>>(new Set());
  const hasSeenInitialOrdersRef = useRef(false);

  useEffect(() => setCurrentAuth(auth), [auth]);

  useEffect(() => {
    seenOrderIdsRef.current = new Set();
    hasSeenInitialOrdersRef.current = false;
    setNewOrderUntilById({});
  }, [currentAuth.userId]);

  useEffect(() => {
    const id = setInterval(() => setClockMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseValue, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulseValue, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulseValue]);

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
    const hasCache = getSellerOrdersCache() !== null || getSellerFoodsCache() !== null;
    if (!hasCache) setLoading(true);
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
      if (profileRes.ok) {
        const name = profileJson.data?.displayName?.trim() || "Usta";
        setDisplayName(name);
        setSellerDisplayNameCache(name);
      }
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

        setSellerOrdersCache(sellerOrders as Record<string, unknown>[]);
        const now = Date.now();
        setNewOrderUntilById((prev) => {
          const next: Record<string, number> = {};
          for (const [id, expiresAt] of Object.entries(prev)) {
            if (expiresAt > now) next[id] = expiresAt;
          }
          for (const order of sellerOrders) {
            if (!seenOrderIdsRef.current.has(order.id)) {
              if (hasSeenInitialOrdersRef.current) next[order.id] = now + 75_000;
              seenOrderIdsRef.current.add(order.id);
            }
          }
          hasSeenInitialOrdersRef.current = true;
          return next;
        });
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

  const todayOrders = useMemo(() => {
    const now = new Date();
    const filtered = orders.filter((o) => {
      if (o.sellerId && o.sellerId !== currentAuth.userId) return false;
      if (!["pending_seller_approval", "seller_approved", "awaiting_payment", "paid", "preparing", "ready", "in_delivery", "delivered", "completed", "cancelled", "rejected"].includes(o.status)) return false;
      const activityAt = parseApiDate(o.updatedAt) ?? parseApiDate(o.createdAt);
      if (!activityAt) return false;
      return isSameLocalDay(activityAt, now);
    });
    return filtered;
  }, [orders, currentAuth.userId]);

  const groupedOrders = useMemo(() => {
    const preparing: SellerOrder[] = [];
    const route: SellerOrder[] = [];
    const done: SellerOrder[] = [];
    for (const order of todayOrders) {
      const key = orderGroupKey(order.status, order.deliveryType);
      if (key === "preparing") preparing.push(order);
      else if (key === "route") route.push(order);
      else done.push(order);
    }
    preparing.sort((a, b) => orderTimeForSort(a) - orderTimeForSort(b));
    route.sort((a, b) => orderTimeForSort(a) - orderTimeForSort(b));
    done.sort((a, b) => orderTimeForSort(b) - orderTimeForSort(a));
    return { preparing, route, done };
  }, [todayOrders]);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function changeStatus(orderId: string, toStatus: "ready" | "in_delivery" | "delivered" | "preparing" | "completed"): Promise<void> {
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

  function shouldFallbackViaReady(error: unknown, toStatus: "in_delivery" | "delivered"): boolean {
    if (!(error instanceof Error)) return false;
    const message = error.message || "";
    if (!message.includes("Cannot transition")) return false;
    if (toStatus === "in_delivery") return message.includes("preparing -> in_delivery");
    return message.includes("preparing -> delivered");
  }

  async function advanceStatusWithCompatibility(
    orderId: string,
    toStatus: "in_delivery" | "delivered" | "preparing" | "completed",
  ): Promise<void> {
    try {
      await changeStatus(orderId, toStatus);
    } catch (error) {
      if (toStatus === "in_delivery" && shouldFallbackViaReady(error, "in_delivery")) {
        await changeStatus(orderId, "ready");
        await changeStatus(orderId, "in_delivery");
        return;
      }
      if (toStatus === "delivered" && shouldFallbackViaReady(error, "delivered")) {
        await changeStatus(orderId, "ready");
        await changeStatus(orderId, "delivered");
        return;
      }
      throw error;
    }
  }

  async function runCardAction(orderId: string, action: SellerAction) {
    try {
      setUpdatingOrderId(orderId);
      await advanceStatusWithCompatibility(orderId, action.toStatus);
      if (action.toStatus === "completed") {
        setCelebrationOrderId(orderId);
        deliveredEmojiScale.setValue(0.4);
        deliveredEmojiOpacity.setValue(0);
        Animated.sequence([
          Animated.parallel([
            Animated.timing(deliveredEmojiOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
            Animated.spring(deliveredEmojiScale, { toValue: 1, friction: 6, tension: 120, useNativeDriver: true }),
          ]),
          Animated.delay(520),
          Animated.parallel([
            Animated.timing(deliveredEmojiOpacity, { toValue: 0, duration: 260, useNativeDriver: true }),
            Animated.timing(deliveredEmojiScale, { toValue: 1.25, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          ]),
        ]).start(() => setCelebrationOrderId(null));
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
          <TouchableOpacity style={styles.quickLpiPill} activeOpacity={0.85} onPress={onOpenProfile}>
            <Text style={styles.quickButtonText}>Cüzdanım</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Stats header */}
      <View style={styles.ordersHead}>
        <TouchableOpacity style={styles.statBlock} activeOpacity={0.75} onPress={() => {
          pagerRef.current?.scrollTo({ x: 0, animated: true });
          setActivePage(0);
        }}>
          <Text style={[styles.statCount, activePage === 0 && styles.statCountActive]}>{loading ? "—" : todayOrders.length}</Text>
          <Text style={[styles.statLabel, activePage === 0 && styles.statLabelActive]}>Bugünkü Siparişler</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.statBlock} activeOpacity={0.75} onPress={() => {
          pagerRef.current?.scrollTo({ x: screenWidth, animated: true });
          setActivePage(1);
        }}>
          <Text style={[styles.statCount, activePage === 1 && styles.statCountActive]}>{loading ? "—" : activeFoods.length}</Text>
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
            {loading ? (
              <>
                <View style={styles.skeletonCard}><View style={styles.skeletonLine} /><View style={styles.skeletonLineShort} /></View>
                <View style={styles.skeletonCard}><View style={styles.skeletonLine} /><View style={styles.skeletonLineShort} /></View>
              </>
            ) : todayOrders.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>Aktif sipariş yok</Text>
                <Text style={styles.emptySub}>Yeni sipariş geldiğinde burada görünecek.</Text>
              </View>
            ) : (
              ([
                { key: "preparing" as const, title: "Hazırlananlar", data: groupedOrders.preparing },
                { key: "route" as const, title: "Yolda / Kapıda", data: groupedOrders.route },
                { key: "done" as const, title: "Tamamlananlar", data: groupedOrders.done },
              ]).map((section) => (
                <View key={section.key} style={styles.groupSection}>
                  <View style={styles.groupHeader}>
                    <Text style={styles.groupTitle}>{section.title}</Text>
                    <Text style={styles.groupCount}>{section.data.length}</Text>
                  </View>
                  {section.data.length === 0 ? (
                    <View style={styles.groupEmptyCard}>
                      <Text style={styles.groupEmptyText}>Bu grupta sipariş yok.</Text>
                    </View>
                  ) : (
                    section.data.map((item) => {
                      const action = cardActionByStatus(item.status, item.deliveryType);
                      const isUpdating = updatingOrderId === item.id;
                      const statusText = statusLabel(item.status, item.deliveryType);
                      const passiveTone = toneFromStatus(item.status, item.deliveryType);
                      const resolvedTone = action?.tone ?? passiveTone;
                      const canRunAction = Boolean(action);
                      const normalizedStatus = normalizeDisplayStatus(item.status, item.deliveryType);
                      const showSmallThumb = normalizedStatus === "completed";
                      const isDoorStep = normalizedStatus === "delivered";
                      const isNewOrder = (newOrderUntilById[item.id] ?? 0) > clockMs;
                      return (
                        <View key={item.id} style={styles.orderCard}>
                          {isDoorStep ? (
                            <Animated.View
                              pointerEvents="none"
                              style={[
                                styles.kapidaHighlightLayer,
                                {
                                  opacity: pulseValue.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [0.08, 0.2],
                                  }),
                                },
                              ]}
                            />
                          ) : null}
                          {isNewOrder ? (
                            <Animated.View
                              pointerEvents="none"
                              style={[
                                styles.newHighlightLayer,
                                {
                                  opacity: pulseValue.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [0.12, 0.24],
                                  }),
                                },
                              ]}
                            />
                          ) : null}
                          <TouchableOpacity activeOpacity={0.82} onPress={() => onOpenOrder(item.id)}>
                            <View style={styles.orderTopRow}>
                              <View style={styles.orderTitleWrap}>
                                <View style={styles.orderTitleRow}>
                                  <Text style={styles.orderNo} numberOfLines={1}>
                                    {item.primaryFoodName?.trim() || item.orderNo || `#${item.id.slice(0, 8).toUpperCase()}`}
                                    {item.itemCount && item.itemCount > 1 ? ` +${item.itemCount - 1}` : ""}
                                  </Text>
                                  {isNewOrder ? (
                                    <View style={styles.newBadge}>
                                      <Text style={styles.newBadgeText}>Yeni</Text>
                                    </View>
                                  ) : null}
                                </View>
                                <Text style={styles.orderMeta}>Alıcı: {item.buyerName || "-"}</Text>
                              </View>
                              <View style={styles.orderTopRight}>
                                <Text style={styles.orderIdText}>{item.orderNo || `#${item.id.slice(0, 8).toUpperCase()}`}</Text>
                                <Text style={styles.orderDateText}>{formatOrderDateTime(item.createdAt)}</Text>
                              </View>
                            </View>
                            <View style={styles.orderMetaRow}>
                              <Text style={styles.orderElapsedText}>{formatElapsed(item.createdAt, clockMs)}</Text>
                              <View
                                style={[
                                  styles.deliveryTypeBadge,
                                  item.deliveryType === "pickup" ? styles.deliveryTypePickup : styles.deliveryTypeDelivery,
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.deliveryTypeText,
                                    item.deliveryType === "pickup" ? styles.deliveryTypePickupText : styles.deliveryTypeDeliveryText,
                                  ]}
                                >
                                  {item.deliveryType === "pickup" ? "Pickup" : "Delivery"}
                                </Text>
                              </View>
                            </View>
                            <View style={styles.orderBottomRow}>
                              <Text style={styles.orderTotal}>{Number(item.totalPrice ?? 0).toFixed(2)} TL</Text>
                              {showSmallThumb ? <Text style={styles.orderThumbSmall}>👍</Text> : null}
                            </View>
                          </TouchableOpacity>
                          {resolvedTone ? (
                            <View style={styles.cardActionRow}>
                              {celebrationOrderId === item.id ? (
                                <Animated.View
                                  pointerEvents="none"
                                  style={[
                                    styles.cardCelebrateEmojiWrap,
                                    {
                                      opacity: deliveredEmojiOpacity,
                                      transform: [{ scale: deliveredEmojiScale }],
                                    },
                                  ]}
                                >
                                  <Text style={styles.cardCelebrateEmoji}>👍</Text>
                                </Animated.View>
                              ) : null}
                              <TouchableOpacity
                                activeOpacity={0.86}
                                style={[
                                  styles.cardActionBtn,
                                  resolvedTone === "preparing"
                                    ? styles.cardActionBtnPreparing
                                    : resolvedTone === "in_delivery"
                                      ? styles.cardActionBtnInDelivery
                                      : resolvedTone === "delivered"
                                        ? styles.cardActionBtnDelivered
                                        : styles.cardActionBtnCompleted,
                                  isDoorStep && styles.cardActionBtnKapidaPulse,
                                  isUpdating && styles.cardActionBtnDisabled,
                                ]}
                                disabled={isUpdating || !canRunAction}
                                onPress={() => {
                                  if (!action) return;
                                  void runCardAction(item.id, action);
                                }}
                              >
                                <Text style={styles.cardActionBtnText}>
                                  {isUpdating ? "İşleniyor..." : (action?.label ?? statusText)}
                                </Text>
                              </TouchableOpacity>
                            </View>
                          ) : null}
                        </View>
                      );
                    })
                  )}
                </View>
              ))
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
            {loading ? (
              <>
                <View style={styles.skeletonCard}><View style={styles.skeletonLine} /><View style={styles.skeletonLineShort} /></View>
                <View style={styles.skeletonCard}><View style={styles.skeletonLine} /><View style={styles.skeletonLineShort} /></View>
              </>
            ) : activeFoods.length === 0 ? (
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
    paddingHorizontal: 12,
    paddingTop: 44,
    paddingBottom: 8,
    backgroundColor: "#F7F4EF",
    borderBottomWidth: 1,
    borderBottomColor: "#E6DED1",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  headerLeft: {
    flex: 1,
    paddingRight: 14,
  },
  title: {
    fontSize: 24,
    color: "#4A3B2F",
    letterSpacing: -0.5,
    marginTop: 6,
    ...(Platform.OS === "ios"
      ? { fontFamily: "AvenirNextCondensed-Bold", fontWeight: "700" }
      : { fontFamily: "sans-serif-condensed", fontWeight: "700" }),
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#3F855C",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#fff", fontSize: 18, fontWeight: "800" },
  quickButtonsRow: { flexDirection: "row", gap: 10, marginBottom: 6, alignItems: "stretch" },
  quickButton: {
    flex: 1,
    height: 40,
    backgroundColor: "#F9E9D5",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#79BA94",
    alignItems: "center",
    justifyContent: "center",
  },
  quickButtonText: {
    color: "#1D5634",
    fontSize: 18,
    fontWeight: "800",
    ...(Platform.OS === "ios"
      ? { fontFamily: "AvenirNextCondensed-Bold" }
      : { fontFamily: "sans-serif-condensed", includeFontPadding: false }),
  },
  quickLpiPill: {
    flex: 1,
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#79BA94",
    backgroundColor: "#F9E9D5",
    alignItems: "center",
    justifyContent: "center",
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
  skeletonCard: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5DDCF", padding: 12, marginBottom: 10, gap: 10 },
  skeletonLine: { height: 14, borderRadius: 6, backgroundColor: "#EDE8E0", width: "70%" },
  skeletonLineShort: { height: 12, borderRadius: 6, backgroundColor: "#F2EDE6", width: "40%" },
  emptyCard: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5DDCF", padding: 12 },
  emptyTitle: { color: "#4A3B2F", fontWeight: "800" },
  emptySub: { color: "#6C6055", marginTop: 4 },
  groupSection: { marginBottom: 12 },
  groupHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8, paddingHorizontal: 2 },
  groupTitle: { color: "#3F3126", fontSize: 16, fontWeight: "800" },
  groupCount: { color: "#6A5A4B", fontSize: 14, fontWeight: "800" },
  groupEmptyCard: { backgroundColor: "#FCFAF7", borderRadius: 10, borderWidth: 1, borderColor: "#ECE3D7", padding: 10, marginBottom: 8 },
  groupEmptyText: { color: "#8A7A6B", fontWeight: "600" },
  orderCard: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5DDCF", padding: 12, marginBottom: 10, overflow: "hidden" },
  kapidaHighlightLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#FFD166",
  },
  newHighlightLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#8FD9A8",
  },
  orderTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  orderTitleWrap: { flex: 1, paddingRight: 8 },
  orderTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  orderNo: { color: "#4A3B2F", fontWeight: "800", fontSize: 16, flex: 1 },
  orderTopRight: { alignItems: "flex-end", minWidth: 108 },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#D6CCBD",
    backgroundColor: "#F7EFE2",
  },
  statusBadgeText: { color: "#5C4A3A", fontSize: 11, fontWeight: "700" },
  orderIdText: { color: "#887766", fontSize: 12, fontWeight: "800" },
  orderDateText: { color: "#9A8A7A", fontSize: 11, fontWeight: "700", marginTop: 2 },
  orderMeta: { color: "#6C6055", marginTop: 3 },
  orderMetaRow: { marginTop: 6, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  orderElapsedText: { color: "#7A6C5E", fontSize: 12, fontWeight: "700" },
  deliveryTypeBadge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  deliveryTypePickup: {
    backgroundColor: "#F4ECFF",
    borderColor: "#A78BFA",
  },
  deliveryTypeDelivery: {
    backgroundColor: "#E5E7EB",
    borderColor: "#4B5563",
  },
  deliveryTypeText: { fontSize: 11, fontWeight: "800" },
  deliveryTypePickupText: { color: "#5B21B6" },
  deliveryTypeDeliveryText: { color: "#1F2937" },
  newBadge: {
    borderRadius: 999,
    backgroundColor: "#157347",
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  newBadgeText: { color: "#FFFFFF", fontSize: 10, fontWeight: "800" },
  orderBottomRow: { marginTop: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  orderTotal: { color: "#4A3B2F", fontWeight: "800" },
  orderThumbSmall: { fontSize: 16, lineHeight: 18 },
  cardActionRow: { marginTop: 10, flexDirection: "row", gap: 8 },
  cardCelebrateEmojiWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: -38,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  cardCelebrateEmoji: {
    fontSize: 44,
    lineHeight: 48,
  },
  cardActionBtn: { flex: 1, borderRadius: 10, borderWidth: 1, paddingVertical: 10, alignItems: "center" },
  cardActionBtnPreparing: { backgroundColor: "#B86A00", borderColor: "#B86A00" },
  cardActionBtnInDelivery: { backgroundColor: "#1D4ED8", borderColor: "#1D4ED8" },
  cardActionBtnDelivered: { backgroundColor: "#0F766E", borderColor: "#0F766E" },
  cardActionBtnCompleted: { backgroundColor: "#166534", borderColor: "#166534" },
  cardActionBtnKapidaPulse: { borderWidth: 2, borderColor: "#F97316" },
  cardActionBtnDisabled: { opacity: 0.6 },
  cardActionBtnText: { fontWeight: "800", fontSize: 13, color: "#FFFFFF" },
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
