import React, { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import type { AuthSession } from "../utils/auth";
import { apiRequest } from "../utils/api";
import ScreenHeader from "../components/ScreenHeader";
import ActionButton from "../components/ActionButton";

type Props = {
  auth: AuthSession;
  orderId: string;
  onBack: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

type OrderDetail = {
  id: string;
  orderNo?: string;
  status: string;
  buyerName?: string;
  deliveryType?: string;
  totalPrice: number;
  items?: Array<{ name: string; quantity: number; unitPrice: number }>;
  deliveryAddress?: { title?: string; addressLine?: string } | null;
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
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [order, setOrder] = useState<OrderDetail | null>(null);

  useEffect(() => setCurrentAuth(auth), [auth]);

  function handleRefresh(session: AuthSession) {
    setCurrentAuth(session);
    onAuthRefresh?.(session);
  }

  async function loadOrder() {
    setLoading(true);
    try {
      const res = await apiRequest<OrderDetail>(`/v1/orders/${orderId}`, currentAuth, { actorRole: "seller" }, handleRefresh);
      if (!res.ok) throw new Error(res.message ?? "Sipariş detay yüklenemedi");
      setOrder(res.data ?? null);
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Sipariş detay yüklenemedi");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOrder();
  }, [orderId]);

  const actions = useMemo(() => transitionActions[order?.status ?? ""] ?? [], [order?.status]);

  async function runAction(action: { label: string; toStatus?: string; endpoint?: "approve" | "reject" }) {
    if (!order) return;
    setUpdating(true);
    try {
      const path = action.endpoint
        ? `/v1/orders/${order.id}/${action.endpoint}`
        : `/v1/orders/${order.id}/status`;
      const body = action.endpoint ? {} : { toStatus: action.toStatus };
      const res = await apiRequest(path, currentAuth, { method: "POST", body, actorRole: "seller" }, handleRefresh);
      if (!res.ok) throw new Error(res.message ?? "Durum güncellenemedi");
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
          <Text style={styles.loadingText}>Yükleniyor...</Text>
        ) : (
          <>
            <View style={styles.heroCard}>
              <Text style={styles.heroTitle}>Sipariş akışını buradan yönetebilirsin.</Text>
              <Text style={styles.heroText}>Adım adım ilerlet, müşteri tarafta durum anlık güncellensin.</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.orderNo}>{order.orderNo || order.id.slice(0, 8)}</Text>
              <Text style={styles.meta}>Durum: {order.status}</Text>
              <Text style={styles.meta}>Alıcı: {order.buyerName || "-"}</Text>
              <Text style={styles.meta}>Teslimat: {order.deliveryType || "-"}</Text>
              <Text style={styles.total}>{Number(order.totalPrice ?? 0).toFixed(2)} TL</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Teslimat Adresi</Text>
              <Text style={styles.meta}>{order.deliveryAddress?.title || "-"}</Text>
              <Text style={styles.meta}>{order.deliveryAddress?.addressLine || "-"}</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Ürünler</Text>
              {(order.items ?? []).map((item, index) => (
                <Text key={`${item.name}-${index}`} style={styles.meta}>
                  {item.name} x{item.quantity} · {Number(item.unitPrice ?? 0).toFixed(2)} TL
                </Text>
              ))}
            </View>
            {actions.length > 0 ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Sonraki Adım</Text>
                <View style={styles.actionRow}>
                  {actions.map((action) => (
                    <ActionButton
                      key={action.label}
                      label={action.label}
                      onPress={() => void runAction(action)}
                      loading={updating}
                      variant={action.endpoint === "reject" ? "danger" : "primary"}
                      fullWidth
                    />
                  ))}
                </View>
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
  loadingText: { textAlign: "center", marginTop: 40, color: "#6C6055" },
  heroCard: { backgroundColor: "#F1E8D9", borderColor: "#E8D6BB", borderWidth: 1, borderRadius: 14, padding: 12 },
  heroTitle: { color: "#4B3422", fontWeight: "800", fontSize: 15, lineHeight: 20 },
  heroText: { marginTop: 4, color: "#6B5545", lineHeight: 18 },
  card: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5DDCF", padding: 12 },
  orderNo: { fontSize: 17, fontWeight: "800", color: "#2E241C" },
  meta: { marginTop: 4, color: "#6C6055" },
  total: { marginTop: 8, color: "#2E241C", fontWeight: "800" },
  sectionTitle: { color: "#2E241C", fontWeight: "800", marginBottom: 8 },
  actionRow: { gap: 8 },
});
