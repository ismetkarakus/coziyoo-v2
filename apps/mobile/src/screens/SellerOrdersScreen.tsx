import React, { useEffect, useMemo, useState } from "react";
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
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
};

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

  return (
    <View style={styles.container}>
      <ScreenHeader title="Siparişler" onBack={onBack} />
      {loading ? (
        <Text style={styles.loadingText}>Yükleniyor...</Text>
      ) : orders.length === 0 ? (
        <Text style={styles.emptyText}>Şu an sipariş yok, yeni sipariş geldiğinde burada göreceksin.</Text>
      ) : (
        <FlatList
          data={[...pendingOrders, ...otherOrders]}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <>
              <Text style={styles.groupTitle}>Bekleyen Siparişler ({pendingOrders.length})</Text>
              {pendingOrders.map((item) => (
                <View key={item.id} style={styles.card}>
                  <View style={styles.cardHead}>
                    <Text style={styles.orderNo}>{item.orderNo || item.id.slice(0, 8)}</Text>
                    <Text style={[styles.statusPill, styles.statusWait]}>{statusLabel(item.status)}</Text>
                  </View>
                  <Text style={styles.meta}>Müşteri: {item.buyerName || "-"}</Text>
                  <Text style={styles.meta}>Toplam: ₺{Number(item.totalPrice ?? 0).toFixed(2)}</Text>
                  <TouchableOpacity onPress={() => onOpenOrder(item.id)} activeOpacity={0.8}>
                    <Text style={styles.linkText}>Detayı Gör</Text>
                  </TouchableOpacity>
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
                </View>
              ))}
              <Text style={[styles.groupTitle, { marginTop: 16 }]}>Diğer Siparişler</Text>
            </>
          }
          renderItem={({ item }) => {
            if (item.status === "pending_seller_approval") return null;
            return (
              <TouchableOpacity style={styles.card} onPress={() => onOpenOrder(item.id)} activeOpacity={0.85}>
                <View style={styles.cardHead}>
                  <Text style={styles.orderNo}>{item.orderNo || item.id.slice(0, 8)}</Text>
                  <Text style={[styles.statusPill, styles.statusDone]}>{statusLabel(item.status)}</Text>
                </View>
                <Text style={styles.meta}>Müşteri: {item.buyerName || "-"}</Text>
                <Text style={styles.meta}>Toplam: ₺{Number(item.totalPrice ?? 0).toFixed(2)}</Text>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ECEBE7" },
  groupTitle: { marginHorizontal: 14, marginTop: 10, marginBottom: 6, color: "#2F2D2B", fontWeight: "800", fontSize: 26 / 2 },
  list: { padding: 14, gap: 10 },
  loadingText: { textAlign: "center", marginTop: 40, color: "#6C6055" },
  emptyText: { textAlign: "center", marginTop: 40, color: "#9E8E7E" },
  card: { backgroundColor: "#F8F8F6", borderRadius: 12, borderWidth: 1, borderColor: "#D4D3CD", padding: 12 },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  orderNo: { color: "#2E241C", fontWeight: "800", fontSize: 16 },
  meta: { color: "#3F3B35", marginTop: 3, fontSize: 15 },
  statusPill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, overflow: "hidden", fontWeight: "800", fontSize: 11 },
  statusWait: { backgroundColor: "#FFE9CC", color: "#C77700" },
  statusDone: { backgroundColor: "#E6F4E8", color: "#2A7A44" },
  linkText: { marginTop: 7, color: "#3E845B", fontWeight: "700" },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  rejectBtn: { flex: 1, borderWidth: 1, borderColor: "#FF3B30", borderRadius: 8, alignItems: "center", paddingVertical: 10, backgroundColor: "#fff" },
  rejectText: { color: "#FF3B30", fontWeight: "700" },
  approveBtn: { flex: 1, borderWidth: 1, borderColor: "#8EA18F", borderRadius: 8, alignItems: "center", paddingVertical: 10, backgroundColor: "#8EA18F" },
  approveText: { color: "#fff", fontWeight: "800" },
});
