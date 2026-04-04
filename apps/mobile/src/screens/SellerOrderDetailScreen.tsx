import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import type { AuthSession } from "../utils/auth";
import { refreshAuthSession } from "../utils/auth";
import { actorRoleHeader } from "../utils/actorRole";
import { loadSettings } from "../utils/settings";
import { theme } from "../theme/colors";
import ScreenHeader from "../components/ScreenHeader";
import StatusBadge from "../components/StatusBadge";
import { subscribeOrderRealtime } from "../utils/realtime";

type Props = {
  auth: AuthSession;
  orderId: string;
  onBack: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

function formatOrderDate(iso: string | undefined): string {
  if (!iso) return "-";
  const normalized = iso.trim().replace(" ", "T").replace(/(\.\d+)?([+-]\d{2})$/, "$1$2:00");
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return "-";
  const months = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()} ${h}:${m}`;
}

type OrderDetail = {
  id: string;
  orderNo?: string;
  status: string;
  createdAt?: string;
  buyerName?: string;
  deliveryType?: string;
  totalPrice: number;
  items?: Array<{
    id: string;
    name: string;
    quantity: number;
    unitPrice: number;
    selectedAddons?: {
      free?: Array<{ name: string; kind?: "sauce" | "extra" | "appetizer" }>;
      paid?: Array<{ name: string; kind?: "sauce" | "extra" | "appetizer"; price: number; quantity?: number }>;
    };
  }>;
  deliveryAddress?: {
    title?: string;
    addressLine?: string;
    line?: string;
    lat?: number | string;
    lng?: number | string;
    latitude?: number | string;
    longitude?: number | string;
  } | null;
  sellerAddress?: {
    title?: string;
    addressLine?: string;
    line?: string;
    lat?: number | string;
    lng?: number | string;
    latitude?: number | string;
    longitude?: number | string;
  } | null;
};

type MapCoordinates = { lat: number; lng: number };

async function openAddressInMaps(address: string): Promise<void> {
  const query = address.trim();
  if (!query) return;
  const encoded = encodeURIComponent(query);
  const appleDirectionsUrl = `http://maps.apple.com/?daddr=${encoded}&dirflg=d`;
  const googleNavUrl = `google.navigation:q=${encoded}&mode=d`;
  const googleDirectionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encoded}&travelmode=driving`;
  const candidates = Platform.OS === "ios"
    ? [appleDirectionsUrl]
    : [googleNavUrl, googleDirectionsUrl];
  for (const url of candidates) {
    const supported = await Linking.canOpenURL(url);
    if (!supported) continue;
    await Linking.openURL(url);
    return;
  }
  throw new Error("Harita uygulaması açılamadı");
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extractAddressCoordinates(value: unknown): MapCoordinates | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const lat = toFiniteNumber(row.lat ?? row.latitude);
  const lng = toFiniteNumber(row.lng ?? row.longitude);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

async function openAddressInMapsWithCoordinates(
  address: string | null | undefined,
  coordinates: MapCoordinates | null,
): Promise<void> {
  const fallbackAddress = String(address ?? "").trim();
  if (coordinates) {
    return openAddressInMaps(`${coordinates.lat},${coordinates.lng}`);
  }
  return openAddressInMaps(fallbackAddress);
}

function normalizeFlowStatus(status: string): string {
  if (status === "completed") return "delivered";
  return status;
}

function getNextAction(status: string, deliveryType?: string): { label: string; toStatus: string } | null {
  const normalized = normalizeFlowStatus(status);
  const pickup = deliveryType === "pickup";
  if (normalized === "paid") {
    return { label: "Hazırlıyorum", toStatus: "preparing" };
  }
  if (normalized === "preparing") {
    return { label: "Hazırlandı", toStatus: "ready" };
  }
  // Pickup: seller's work ends at ready; buyer handles the rest
  if (pickup) return null;
  // Delivery flow
  if (normalized === "ready") {
    return { label: "Yola Çıktı", toStatus: "in_delivery" };
  }
  if (normalized === "in_delivery") return { label: "Yaklaştı", toStatus: "approaching" };
  if (normalized === "approaching") return { label: "Kapıda", toStatus: "at_door" };
  if (normalized === "at_door") return { label: "Teslim Edildi", toStatus: "delivered" };
  return null;
}

function actionTone(toStatus: string): { bg: string; border: string } {
  if (toStatus === "preparing") return { bg: "#B86A00", border: "#B86A00" };
  if (toStatus === "ready") return { bg: "#166534", border: "#166534" };
  if (toStatus === "in_delivery") return { bg: "#1D4ED8", border: "#1D4ED8" };
  if (toStatus === "approaching") return { bg: "#0F766E", border: "#0F766E" };
  if (toStatus === "at_door") return { bg: "#0F766E", border: "#0F766E" };
  if (toStatus === "delivered" || toStatus === "completed") return { bg: "#166534", border: "#166534" };
  return { bg: "#3F855C", border: "#3F855C" };
}

export default function SellerOrderDetailScreen({ auth, orderId, onBack, onAuthRefresh }: Props) {
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [pinCode, setPinCode] = useState("");
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => setCurrentAuth(auth), [auth]);

  async function authedFetch(path: string, init?: RequestInit, baseUrl = apiUrl): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${currentAuth.accessToken}`,
      ...actorRoleHeader(currentAuth, "seller"),
      ...(init?.headers as Record<string, string> | undefined),
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

  async function loadOrder() {
    setLoading(true);
    try {
      const settings = await loadSettings();
      const baseUrl = settings.apiUrl;
      setApiUrl(baseUrl);
      const res = await authedFetch(`/v1/orders/${orderId}`, undefined, baseUrl);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Sipariş detay yüklenemedi");
      setOrder(json?.data ?? null);
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Sipariş detay yüklenemedi");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOrder();
  }, [orderId]);

  async function refreshOrderStatus() {
    try {
      const res = await authedFetch(`/v1/orders/${orderId}`);
      const json = await res.json();
      if (res.ok) setOrder(json?.data ?? null);
    } catch {
      // silent refresh — don't alert
    }
  }

  useEffect(() => {
    if (statusPollRef.current) {
      clearInterval(statusPollRef.current);
      statusPollRef.current = null;
    }
    if (!order) return;
    const terminal = ["completed", "cancelled", "rejected"].includes(order.status);
    if (terminal) return;
    statusPollRef.current = setInterval(() => { void refreshOrderStatus(); }, 8_000);
    return () => {
      if (statusPollRef.current) {
        clearInterval(statusPollRef.current);
        statusPollRef.current = null;
      }
    };
  }, [order?.status]);

  useEffect(() => {
    if (!order?.id) return () => {};
    return subscribeOrderRealtime(order.id, () => { void refreshOrderStatus(); });
  }, [order?.id]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, (event) => {
      setKeyboardInset(event.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardInset(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const action = useMemo(() => {
    if (!order) return null;
    return getNextAction(order.status, order.deliveryType);
  }, [order?.status, order?.deliveryType]);
  const actionColors = action ? actionTone(action.toStatus) : null;
  const shouldCheckPinBeforeComplete = useMemo(
    () =>
      Boolean(
        order &&
          action &&
          action.toStatus === "delivered" &&
          order.deliveryType === "delivery" &&
          normalizeFlowStatus(order.status) === "at_door"
      ),
    [order, action]
  );
  const isPinReady = pinCode.trim().length >= 4 && pinCode.trim().length <= 8;
  const deliveryAddressText = useMemo(() => {
    if (!order) return "";
    return [order.deliveryAddress?.title, order.deliveryAddress?.addressLine || order.deliveryAddress?.line].filter(Boolean).join(" · ");
  }, [order]);
  const mapAddressText = deliveryAddressText;
  const mapCoordinates = useMemo(() => {
    if (!order) return null;
    return extractAddressCoordinates(order.deliveryAddress);
  }, [order]);
  const sellerStatusBadgeKey = useMemo(() => {
    if (!order) return "";
    const normalized = normalizeFlowStatus(order.status);
    if (order.deliveryType === "pickup" && ["ready", "in_delivery", "approaching", "at_door"].includes(normalized)) {
      return "pickup_ready_seller";
    }
    return normalized;
  }, [order]);

  useEffect(() => {
    if (!shouldCheckPinBeforeComplete) setPinCode("");
  }, [shouldCheckPinBeforeComplete]);

  async function runAction(action: { label: string; toStatus: string }) {
    if (!order) return;
    setUpdating(true);
    try {
      const changeStatus = async (toStatus: string) => {
        const res = await authedFetch(`/v1/orders/${order.id}/status`, {
          method: "POST",
          body: JSON.stringify({ toStatus }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error?.message ?? "Durum güncellenemedi");
      };
      const verifyPin = async (pin: string) => {
        const res = await authedFetch(`/v1/orders/${order.id}/delivery-proof/pin/verify`, {
          method: "POST",
          body: JSON.stringify({ pin }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error?.message ?? "PIN doğrulanamadı");
      };

      try {
        if (shouldCheckPinBeforeComplete && action.toStatus === "delivered") {
          const pin = pinCode.trim();
          if (!/^\d{4,8}$/.test(pin)) throw new Error("4-8 haneli kod gir.");
          await verifyPin(pin);
          await changeStatus("delivered");
          await changeStatus("completed");
        } else {
          await changeStatus(action.toStatus);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message.includes("Cannot transition")) {
          await loadOrder();
          throw new Error("Durum güncellendi, sıradaki adımı tekrar onayla.");
        }
        if (message.includes("PIN")) {
          throw new Error("Kod doğrulanamadı. Kodu kontrol et.");
        }
        throw error;
      }
      await loadOrder();
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Durum güncellenemedi");
    } finally {
      setUpdating(false);
    }
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Sipariş Detayı" onBack={onBack} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          keyboardInset > 0 ? { paddingBottom: 36 + keyboardInset } : null,
        ]}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="on-drag"
      >
      {loading || !order ? (
        <ActivityIndicator size="large" color={theme.primary} />
      ) : (
        <>
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.orderNo}>{order.orderNo || "#" + order.id.slice(0, 8).toUpperCase()}</Text>
              <StatusBadge
                status={sellerStatusBadgeKey}
                size="sm"
                deliveryType={order.deliveryType === "pickup" ? undefined : order.deliveryType}
              />
            </View>
            <Text style={styles.meta}>Alıcı: {order.buyerName || "-"}</Text>
            <Text style={styles.meta}>Sipariş Türü: {order.deliveryType === "delivery" ? "Teslimat" : "Gel Al"}</Text>
            {order.createdAt ? <Text style={styles.meta}>Tarih: {formatOrderDate(order.createdAt)}</Text> : null}
            <Text style={styles.total}>{Number(order.totalPrice ?? 0).toFixed(2)} TL</Text>
          </View>
          {order.deliveryType === "delivery" ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Teslimat Adresi</Text>
              <TouchableOpacity
                activeOpacity={mapAddressText ? 0.78 : 1}
                disabled={!mapAddressText}
                onPress={() => {
                  if (!mapAddressText) return;
                  openAddressInMapsWithCoordinates(mapAddressText, mapCoordinates).catch((error) => {
                    Alert.alert("Hata", error instanceof Error ? error.message : "Harita açılamadı");
                  });
                }}
              >
                <Text style={[styles.meta, mapAddressText ? styles.linkText : null]}>{order.deliveryAddress?.title || "-"}</Text>
                <Text style={[styles.meta, mapAddressText ? styles.linkText : null]}>{order.deliveryAddress?.addressLine || order.deliveryAddress?.line || "-"}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Ürünler</Text>
            {(order.items ?? []).map((item, index) => (
              <View key={`${item.id || item.name}-${index}`} style={styles.itemRowWrap}>
                <Text style={styles.meta}>
                  {item.name} x{item.quantity} · {Number(item.unitPrice ?? 0).toFixed(2)} TL
                </Text>
                {(item.selectedAddons?.free?.length ?? 0) > 0 ? (
                  <Text style={styles.addonMeta}>
                    Ücretsiz: {(item.selectedAddons?.free ?? []).map((addon) => addon.name).join(", ")}
                  </Text>
                ) : null}
                {(item.selectedAddons?.paid?.length ?? 0) > 0
                  ? (item.selectedAddons?.paid ?? []).map((addon, addonIndex) => {
                      const qty = Number.isInteger(addon.quantity) && Number(addon.quantity) > 0 ? Number(addon.quantity) : 1;
                      const subtotal = Number(addon.price ?? 0) * qty;
                      return (
                        <Text key={`${item.id || item.name}-${index}-paid-${addon.name}-${addonIndex}`} style={styles.addonMeta}>
                          • {addon.name} x{qty} (+{subtotal.toFixed(2)} TL)
                        </Text>
                      );
                    })
                  : null}
              </View>
            ))}
          </View>

          {action ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Aksiyonlar</Text>
              {shouldCheckPinBeforeComplete ? (
                <>
                  <Text style={styles.meta}>Alıcıdan kodu alıp doğrula.</Text>
                  <TextInput
                    style={styles.pinInput}
                    value={pinCode}
                    onChangeText={(value) => setPinCode(value.replace(/[^0-9]/g, "").slice(0, 8))}
                    keyboardType="number-pad"
                    maxLength={8}
                    placeholder="Kodu gir (4-8 hane)"
                    placeholderTextColor="#9C8E81"
                    editable={!updating}
                  />
                </>
              ) : null}
              <TouchableOpacity
                style={[
                  styles.actionBtn,
                  actionColors ? { backgroundColor: actionColors.bg, borderColor: actionColors.border } : null,
                  (updating || (shouldCheckPinBeforeComplete && !isPinReady)) && styles.actionDisabled,
                ]}
                disabled={updating || (shouldCheckPinBeforeComplete && !isPinReady)}
                onPress={() => void runAction(action)}
              >
                <Text style={styles.actionText}>
                  {shouldCheckPinBeforeComplete ? "Kodu Doğrula ve Teslim Et" : action.label}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </>
      )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F4EF" },
  content: { padding: 16, paddingBottom: 36, gap: 10 },
  card: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5DDCF", padding: 12 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  orderNo: { fontSize: 17, fontWeight: "800", color: "#2E241C" },
  meta: { marginTop: 4, color: "#6C6055" },
  total: { marginTop: 8, color: "#2E241C", fontWeight: "800" },
  sectionTitle: { color: "#2E241C", fontWeight: "800", marginBottom: 4 },
  linkText: { textDecorationLine: "underline" },
  itemRowWrap: { marginTop: 4 },
  addonMeta: { marginTop: 4, color: "#8A7D72", fontSize: 12.5 },
  pinInput: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#DCCFBF",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#2E241C",
    fontWeight: "600",
    letterSpacing: 1.5,
  },
  actionBtn: { marginTop: 8, backgroundColor: "#3F855C", borderRadius: 10, borderWidth: 1, paddingVertical: 11, alignItems: "center" },
  actionDisabled: { opacity: 0.45 },
  actionText: { color: "#fff", fontWeight: "700" },
});
