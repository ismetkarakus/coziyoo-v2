import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { AuthSession } from "../utils/auth";
import { refreshAuthSession } from "../utils/auth";
import { actorRoleHeader } from "../utils/actorRole";
import { loadSettings } from "../utils/settings";
import { theme } from "../theme/colors";
import ScreenHeader from "../components/ScreenHeader";
import StatusBadge from "../components/StatusBadge";

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
  deliveryAddress?: { title?: string; addressLine?: string; line?: string } | null;
};

const transitionActions: Record<string, Array<{ label: string; toStatus?: string; endpoint?: "approve" | "reject" }>> = {
  pending_seller_approval: [
    { label: "Onayla", endpoint: "approve" },
    { label: "Reddet", endpoint: "reject" },
  ],
  seller_approved: [{ label: "Hazırlanıyor", toStatus: "preparing" }],
  awaiting_payment: [{ label: "Hazırlanıyor", toStatus: "preparing" }],
  paid: [{ label: "Hazırlanıyor", toStatus: "preparing" }],
  preparing: [{ label: "Hazır", toStatus: "ready" }],
  ready: [{ label: "Yola Çıktı", toStatus: "in_delivery" }],
  in_delivery: [{ label: "Teslim Edildi", toStatus: "delivered" }],
  delivered: [{ label: "Tamamlandı", toStatus: "completed" }],
};

export default function SellerOrderDetailScreen({ auth, orderId, onBack, onAuthRefresh }: Props) {
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [order, setOrder] = useState<OrderDetail | null>(null);

  useEffect(() => setCurrentAuth(auth), [auth]);

  async function authedFetch(path: string, init?: RequestInit, baseUrl = apiUrl): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${currentAuth.accessToken}`,
      ...actorRoleHeader(currentAuth, "seller"),
      ...(init?.headers as Record<string, string> | undefined),
    };
    let res = await fetch(`${baseUrl}${path}`, { ...init, headers });
    if (res.status !== 401) return res;
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

  const actions = useMemo(() => {
    const base = transitionActions[order?.status ?? ""] ?? [];
    if (order?.status === "ready" && order.deliveryType === "pickup") {
      return [{ label: "Teslim Edildi", toStatus: "delivered" }];
    }
    return base;
  }, [order?.status, order?.deliveryType]);

  async function runAction(action: { label: string; toStatus?: string; endpoint?: "approve" | "reject" }) {
    if (!order) return;
    setUpdating(true);
    try {
      let res: Response;
      if (action.endpoint) {
        res = await authedFetch(`/v1/orders/${order.id}/${action.endpoint}`, { method: "POST", body: JSON.stringify({}) });
      } else {
        res = await authedFetch(`/v1/orders/${order.id}/status`, {
          method: "POST",
          body: JSON.stringify({ toStatus: action.toStatus }),
        });
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Durum güncellenemedi");
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
      <ScrollView contentContainerStyle={styles.content}>
      {loading || !order ? (
        <ActivityIndicator size="large" color={theme.primary} />
      ) : (
        <>
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.orderNo}>{order.orderNo || "#" + order.id.slice(0, 8).toUpperCase()}</Text>
              <StatusBadge status={order.status} size="sm" />
            </View>
            <Text style={styles.meta}>Alıcı: {order.buyerName || "-"}</Text>
            <Text style={styles.meta}>Teslimat: {order.deliveryType === "delivery" ? "Teslimat" : "Gel Al"}</Text>
            {order.createdAt ? <Text style={styles.meta}>Tarih: {formatOrderDate(order.createdAt)}</Text> : null}
            <Text style={styles.total}>{Number(order.totalPrice ?? 0).toFixed(2)} TL</Text>
          </View>
          {order.deliveryType === "delivery" ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Teslimat Adresi</Text>
              <Text style={styles.meta}>{order.deliveryAddress?.title || "-"}</Text>
              <Text style={styles.meta}>{order.deliveryAddress?.addressLine || order.deliveryAddress?.line || "-"}</Text>
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Gel Al</Text>
              <Text style={styles.meta}>Alıcı siparişi sizden teslim alacak.</Text>
            </View>
          )}
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

          {actions.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Aksiyonlar</Text>
              {actions.map((action, index) => (
                <TouchableOpacity
                  key={`${action.label}-${action.toStatus ?? action.endpoint ?? "none"}-${index}`}
                  style={[styles.actionBtn, updating && styles.actionDisabled]}
                  disabled={updating}
                  onPress={() => void runAction(action)}
                >
                  <Text style={styles.actionText}>{action.label}</Text>
                </TouchableOpacity>
              ))}
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
  itemRowWrap: { marginTop: 4 },
  addonMeta: { marginTop: 4, color: "#8A7D72", fontSize: 12.5 },
  actionBtn: { marginTop: 8, backgroundColor: "#3F855C", borderRadius: 10, paddingVertical: 11, alignItems: "center" },
  actionDisabled: { opacity: 0.45 },
  actionText: { color: "#fff", fontWeight: "700" },
});
