import React, { useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { AuthSession } from "../utils/auth";
import { apiRequest } from "../utils/api";
import { theme } from "../theme/colors";
import ScreenHeader from "../components/ScreenHeader";
import ActionButton from "../components/ActionButton";

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

type SellerFood = { id: string; name: string };
type SellerLot = {
  id: string;
  food_id: string;
  lot_number: string;
  quantity_available: number;
  quantity_produced: number;
  sale_ends_at: string;
  lifecycle_status: string;
};

export default function SellerLotsScreen({ auth, onBack, onAuthRefresh }: Props) {
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [foods, setFoods] = useState<SellerFood[]>([]);
  const [lots, setLots] = useState<SellerLot[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedFoodId, setSelectedFoodId] = useState("");
  const [quantity, setQuantity] = useState("10");

  useEffect(() => setCurrentAuth(auth), [auth]);

  function handleRefresh(session: AuthSession) {
    setCurrentAuth(session);
    onAuthRefresh?.(session);
  }

  async function loadData() {
    setLoading(true);
    try {
      const [foodsRes, lotsRes] = await Promise.all([
        apiRequest<SellerFood[]>("/v1/seller/foods", currentAuth, { actorRole: "seller" }, handleRefresh),
        apiRequest<SellerLot[]>("/v1/seller/lots", currentAuth, { actorRole: "seller" }, handleRefresh),
      ]);
      if (!foodsRes.ok) throw new Error(foodsRes.message ?? "Yemekler yüklenemedi");
      if (!lotsRes.ok) throw new Error(lotsRes.message ?? "Lotlar yüklenemedi");
      const rows: SellerFood[] = Array.isArray(foodsRes.data)
        ? foodsRes.data.map((row) => ({ id: row.id, name: row.name }))
        : [];
      setFoods(rows);
      setLots(Array.isArray(lotsRes.data) ? lotsRes.data : []);
      if (!selectedFoodId && rows[0]?.id) setSelectedFoodId(rows[0].id);
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Lotlar yüklenemedi");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const foodNameById = useMemo(() => {
    const map = new Map<string, string>();
    foods.forEach((food) => map.set(food.id, food.name));
    return map;
  }, [foods]);

  async function createLot() {
    if (!selectedFoodId) {
      Alert.alert("Hata", "Önce yemek seç.");
      return;
    }
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      Alert.alert("Hata", "Geçerli adet gir.");
      return;
    }
    const now = new Date();
    const end = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    setCreating(true);
    try {
      const res = await apiRequest("/v1/seller/lots", currentAuth, {
        method: "POST",
        body: {
          foodId: selectedFoodId,
          producedAt: now.toISOString(),
          saleStartsAt: now.toISOString(),
          saleEndsAt: end.toISOString(),
          quantityProduced: qty,
          quantityAvailable: qty,
          notes: "Mobil hızlı lot",
        },
        actorRole: "seller",
      }, handleRefresh);
      if (!res.ok) throw new Error(res.message ?? "Lot açılamadı");
      setModalVisible(false);
      await loadData();
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Lot açılamadı");
    } finally {
      setCreating(false);
    }
  }

  async function recallLot(lotId: string) {
    try {
      const res = await apiRequest(`/v1/seller/lots/${lotId}/recall`, currentAuth, {
        method: "POST",
        body: { reason: "Mobil panel recall" },
        actorRole: "seller",
      }, handleRefresh);
      if (!res.ok) throw new Error(res.message ?? "Recall yapılamadı");
      await loadData();
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Recall yapılamadı");
    }
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Lot / Stok"
        onBack={onBack}
        rightAction={
          <TouchableOpacity onPress={() => setModalVisible(true)} style={styles.addBtn}>
            <Text style={styles.addText}>+ Lot</Text>
          </TouchableOpacity>
        }
      />
      {loading ? (
        <Text style={styles.loadingText}>Yükleniyor...</Text>
      ) : lots.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Henüz lot açmadın.</Text>
          <Text style={styles.emptyText}>Hızlıca bir lot aç, stok yönetimi başlasın.</Text>
        </View>
      ) : (
        <>
          <View style={styles.heroCard}>
            <Text style={styles.heroTitle}>Lot ve stok takibi burada.</Text>
            <Text style={styles.heroText}>Satışta olan lotları izle, gerekirse tek dokunuşla geri çağır.</Text>
          </View>
          <FlatList
            data={lots}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <Text style={styles.lotTitle}>{foodNameById.get(item.food_id) ?? item.food_id}</Text>
                <Text style={styles.meta}>Lot: {item.lot_number}</Text>
                <Text style={styles.meta}>Stok: {item.quantity_available}/{item.quantity_produced}</Text>
                <Text style={styles.meta}>Durum: {item.lifecycle_status}</Text>
                <View style={styles.recallRow}>
                  <ActionButton label="Geri Çağır" onPress={() => void recallLot(item.id)} variant="danger" size="sm" />
                </View>
              </View>
            )}
          />
        </>
      )}

      <Modal visible={modalVisible} animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>Hızlı Lot Aç</Text>
          <Text style={styles.label}>Yemek</Text>
          {foods.map((food) => (
            <TouchableOpacity
              key={food.id}
              style={[styles.foodPick, selectedFoodId === food.id && styles.foodPickActive]}
              onPress={() => setSelectedFoodId(food.id)}
            >
              <Text style={selectedFoodId === food.id ? styles.foodPickTextActive : styles.foodPickText}>
                {food.name}
              </Text>
            </TouchableOpacity>
          ))}
          <Text style={styles.label}>Üretim adedi</Text>
          <TextInput style={styles.input} value={quantity} onChangeText={setQuantity} keyboardType="number-pad" />
          <ActionButton label="Lot Aç" onPress={() => void createLot()} loading={creating} fullWidth />
          <View style={styles.gap} />
          <ActionButton label="Vazgeç" onPress={() => setModalVisible(false)} variant="soft" fullWidth />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F4EF" },
  heroCard: {
    marginHorizontal: 14,
    marginTop: 10,
    backgroundColor: "#F1E8D9",
    borderColor: "#E8D6BB",
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  heroTitle: { color: "#4B3422", fontWeight: "800", fontSize: 16 },
  heroText: { marginTop: 4, color: "#6B5545", lineHeight: 18 },
  list: { padding: 14, gap: 10 },
  loadingText: { textAlign: "center", marginTop: 40, color: "#6C6055" },
  emptyWrap: { marginTop: 48, alignItems: "center", paddingHorizontal: 24 },
  emptyTitle: { color: "#2E241C", fontWeight: "800", fontSize: 18, textAlign: "center" },
  emptyText: { textAlign: "center", marginTop: 6, color: "#9E8E7E" },
  addBtn: { padding: 4 },
  addText: { color: theme.primary, fontWeight: "700", fontSize: 15 },
  card: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5DDCF", padding: 12 },
  lotTitle: { fontSize: 16, fontWeight: "800", color: "#2E241C" },
  meta: { color: "#6B5F54", marginTop: 4 },
  recallRow: { marginTop: 8, flexDirection: "row" },
  modal: { flex: 1, backgroundColor: "#F7F4EF", padding: 16 },
  modalTitle: { fontSize: 22, fontWeight: "800", color: "#2E241C", marginBottom: 10 },
  label: { fontWeight: "700", color: "#2E241C", marginTop: 8, marginBottom: 6 },
  foodPick: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: "#E2D9CA", backgroundColor: "#fff", marginBottom: 6 },
  foodPickActive: { borderColor: "#3F855C", backgroundColor: "#EAF4ED" },
  foodPickText: { color: "#2E241C" },
  foodPickTextActive: { color: "#2E6B44", fontWeight: "700" },
  input: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5DDCF", paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 },
  gap: { height: 8 },
});
