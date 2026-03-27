import React, { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { AuthSession } from "../utils/auth";
import { apiRequest } from "../utils/api";
import ScreenHeader from "../components/ScreenHeader";

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onOpenOrder: (orderId: string) => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

type SellerOrder = {
  id: string;
  orderNo?: string | null;
  sellerId: string;
  buyerName?: string | null;
  status: string;
  totalPrice: number;
  createdAt?: string;
  deliveryType?: "pickup" | "delivery";
  deliveryAddress?: unknown;
  items?: Array<{ name: string; quantity: number; unitPrice?: number; lineTotal?: number }>;
};

function parseAddress(value: unknown): string {
  if (!value || typeof value !== "object") return "-";
  const obj = value as Record<string, unknown>;
  const parts = [obj.title, obj.addressLine, obj.district, obj.city]
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim());
  return parts.length ? parts.join(", ") : "-";
}

function formatTime(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

function statusLabel(status: string) {
  if (status === "pending_seller_approval") return "Onay Bekliyor";
  if (status === "seller_approved") return "Onaylandı";
  if (status === "preparing") return "Hazırlanıyor";
  if (status === "ready") return "Hazır";
  if (status === "in_delivery") return "Yolda";
  if (status === "delivered") return "Teslim Edildi";
  if (status === "completed") return "Tamamlandı";
  if (status === "cancelled") return "İptal";
  return status;
}

export default function SellerOrdersScreen({ auth, onBack, onOpenOrder, onAuthRefresh }: Props) {
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [orders, setOrders] = useState<SellerOrder[]>([]);

  useEffect(() => setCurrentAuth(auth), [auth]);

  function handleRefresh(session: AuthSession) {
    setCurrentAuth(session);
    onAuthRefresh?.(session);
  }

  async function loadOrders() {
    setLoading(true);
    try {
      const res = await apiRequest<SellerOrder[]>("/v1/orders?role=seller&page=1&pageSize=50", currentAuth, { actorRole: "seller" }, handleRefresh);
      if (!res.ok) throw new Error(res.message ?? "Siparişler yüklenemedi");
      setOrders(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Siparişler yüklenemedi");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOrders();
  }, []);

  const pendingOrders = useMemo(
    () => orders.filter((x) => x.status === "pending_seller_approval"),
    [orders],
  );
  const otherOrders = useMemo(
    () => orders.filter((x) => x.status !== "pending_seller_approval"),
    [orders],
  );

  async function handleOrderAction(orderId: string, endpoint: "approve" | "reject") {
    setUpdatingId(orderId);
    try {
      const result = await apiRequest(
        `/v1/orders/${orderId}/${endpoint}`,
        currentAuth,
        { method: "POST", body: {}, actorRole: "seller" },
        handleRefresh,
      );
      if (!result.ok) throw new Error(result.message ?? "Sipariş güncellenemedi");
      await loadOrders();
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Sipariş güncellenemedi");
    } finally {
      setUpdatingId(null);
    }
  }

  function renderOrderDetails(item: SellerOrder, compact = false) {
    const firstFood = item.items?.[0]?.name || (item.orderNo || item.id.slice(0, 8));
    const totalQty = (item.items ?? []).reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    const pickup = item.deliveryType === "pickup";
    const deliveryText = pickup ? "Gel Al" : "Teslimat";

    return (
      <View key={item.id} style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={styles.foodTitle}>{firstFood}</Text>
          <Text style={[styles.statusPill, item.status === "pending_seller_approval" ? styles.statusWait : styles.statusDone]}>
            {statusLabel(item.status)}
          </Text>
        </View>

        <Text style={styles.meta}>Müşteri: {item.buyerName || "-"}</Text>
        {!compact ? <Text style={styles.meta}>Telefon: -</Text> : null}
        <Text style={styles.meta}>Miktar: {totalQty || "-"} adet</Text>
        <Text style={styles.meta}>Toplam: ₺{Number(item.totalPrice ?? 0).toFixed(0)}</Text>
        <Text style={styles.meta}>Sipariş Tarihi: {formatTime(item.createdAt)}</Text>
        <Text style={styles.meta}>Teslimat: {deliveryText}</Text>
        {!pickup && !compact ? <Text style={styles.meta}>Adres: {parseAddress(item.deliveryAddress)}</Text> : null}

        {!compact && item.status === "pending_seller_approval" ? (
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.rejectBtn}
              onPress={() => void handleOrderAction(item.id, "reject")}
              disabled={updatingId === item.id}
            >
              <Text style={styles.rejectText}>{updatingId === item.id ? "Bekle..." : "Reddet"}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.approveBtn}
              onPress={() => void handleOrderAction(item.id, "approve")}
              disabled={updatingId === item.id}
            >
              <Text style={styles.approveText}>{updatingId === item.id ? "Bekle..." : "Onayla"}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <TouchableOpacity onPress={() => onOpenOrder(item.id)} activeOpacity={0.8}>
          <Text style={styles.detailLink}>Detay</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Siparişler" onBack={onBack} />
      {loading ? (
        <Text style={styles.loadingText}>Yükleniyor...</Text>
      ) : orders.length === 0 ? (
        <Text style={styles.emptyText}>Şu an sipariş yok.</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.groupTitle}>Bekleyen Siparişler ({pendingOrders.length})</Text>
          {pendingOrders.map((item) => renderOrderDetails(item))}

          <Text style={[styles.groupTitle, styles.otherTitle]}>Diğer Siparişler</Text>
          {otherOrders.map((item) => renderOrderDetails(item, true))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ECEBE7" },
  content: { padding: 14, paddingBottom: 24 },
  loadingText: { textAlign: "center", marginTop: 40, color: "#6C6055" },
  emptyText: { textAlign: "center", marginTop: 40, color: "#9E8E7E" },

  groupTitle: { color: "#2F2D2B", fontWeight: "800", fontSize: 28 / 2, marginBottom: 8 },
  otherTitle: { marginTop: 14 },

  card: {
    backgroundColor: "#F8F8F6",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#D4D3CD",
    padding: 12,
    marginBottom: 10,
  },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6 },
  foodTitle: { color: "#2E241C", fontWeight: "800", fontSize: 31 / 2, flex: 1 },

  meta: { color: "#3F3B35", marginTop: 2, fontSize: 24 / 1.6 },

  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    overflow: "hidden",
    fontWeight: "800",
    fontSize: 11,
  },
  statusWait: { backgroundColor: "#FFE9CC", color: "#C77700" },
  statusDone: { backgroundColor: "#E6F4E8", color: "#2A7A44" },

  actionRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  rejectBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#FF3B30",
    borderRadius: 8,
    alignItems: "center",
    paddingVertical: 10,
    backgroundColor: "#fff",
  },
  rejectText: { color: "#FF3B30", fontWeight: "700" },
  approveBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#8EA18F",
    borderRadius: 8,
    alignItems: "center",
    paddingVertical: 10,
    backgroundColor: "#8EA18F",
  },
  approveText: { color: "#fff", fontWeight: "800" },

  detailLink: { marginTop: 8, color: "#3E845B", fontWeight: "700" },
});
