import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { AuthSession } from "../utils/auth";
import { refreshAuthSession } from "../utils/auth";
import { actorRoleHeader } from "../utils/actorRole";
import { loadSettings } from "../utils/settings";
import { theme } from "../theme/colors";

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
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [foods, setFoods] = useState<SellerFood[]>([]);
  const [lots, setLots] = useState<SellerLot[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedFoodId, setSelectedFoodId] = useState("");
  const [quantity, setQuantity] = useState("10");

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

  async function loadData() {
    setLoading(true);
    try {
      const settings = await loadSettings();
      const baseUrl = settings.apiUrl;
      setApiUrl(baseUrl);
      const [foodsRes, lotsRes] = await Promise.all([
        authedFetch("/v1/seller/foods", undefined, baseUrl),
        authedFetch("/v1/seller/lots", undefined, baseUrl),
      ]);
      const foodsJson = await foodsRes.json();
      const lotsJson = await lotsRes.json();
      if (!foodsRes.ok) throw new Error(foodsJson?.error?.message ?? "Yemekler yüklenemedi");
      if (!lotsRes.ok) throw new Error(lotsJson?.error?.message ?? "Lotlar yüklenemedi");
      const rows = Array.isArray(foodsJson?.data) ? foodsJson.data : [];
      setFoods(rows.map((row: any) => ({ id: row.id, name: row.name })));
      setLots(Array.isArray(lotsJson?.data) ? lotsJson.data : []);
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
    try {
      const res = await authedFetch("/v1/seller/lots", {
        method: "POST",
        body: JSON.stringify({
          foodId: selectedFoodId,
          producedAt: now.toISOString(),
          saleStartsAt: now.toISOString(),
          saleEndsAt: end.toISOString(),
          quantityProduced: qty,
          quantityAvailable: qty,
          notes: "Mobil hızlı lot",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Lot açılamadı");
      setModalVisible(false);
      await loadData();
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Lot açılamadı");
    }
  }

  async function recallLot(lotId: string) {
    try {
      const res = await authedFetch(`/v1/seller/lots/${lotId}/recall`, {
        method: "POST",
        body: JSON.stringify({ reason: "Mobil panel recall" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Recall yapılamadı");
      await loadData();
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Recall yapılamadı");
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}><Text style={styles.back}>Geri</Text></TouchableOpacity>
        <Text style={styles.title}>Lot / Stok</Text>
        <TouchableOpacity onPress={() => setModalVisible(true)}><Text style={styles.add}>+ Lot</Text></TouchableOpacity>
      </View>
      {loading ? (
        <ActivityIndicator size="large" color={theme.primary} />
      ) : (
        <FlatList
          data={lots}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 14, gap: 10 }}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.lotTitle}>{foodNameById.get(item.food_id) ?? item.food_id}</Text>
              <Text style={styles.meta}>Lot: {item.lot_number}</Text>
              <Text style={styles.meta}>Stok: {item.quantity_available}/{item.quantity_produced}</Text>
              <Text style={styles.meta}>Durum: {item.lifecycle_status}</Text>
              <TouchableOpacity style={styles.recallBtn} onPress={() => void recallLot(item.id)}>
                <Text style={styles.recallText}>Recall</Text>
              </TouchableOpacity>
            </View>
          )}
        />
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
              <Text>{food.name}</Text>
            </TouchableOpacity>
          ))}
          <Text style={styles.label}>Üretim adedi</Text>
          <TextInput style={styles.input} value={quantity} onChangeText={setQuantity} keyboardType="number-pad" />
          <TouchableOpacity style={styles.saveBtn} onPress={() => void createLot()}><Text style={styles.saveText}>Lot Aç</Text></TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalVisible(false)}><Text>Vazgeç</Text></TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F4EF" },
  header: { paddingHorizontal: 16, paddingVertical: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  back: { color: "#3F855C", fontWeight: "700" },
  title: { fontSize: 20, fontWeight: "800", color: "#2E241C" },
  add: { color: "#3F855C", fontWeight: "700" },
  card: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5DDCF", padding: 12 },
  lotTitle: { fontSize: 16, fontWeight: "800", color: "#2E241C" },
  meta: { color: "#6B5F54", marginTop: 4 },
  recallBtn: { marginTop: 8, alignSelf: "flex-start", backgroundColor: "#FCEAEA", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  recallText: { color: "#B42318", fontWeight: "700" },
  modal: { flex: 1, backgroundColor: "#F7F4EF", padding: 16 },
  modalTitle: { fontSize: 22, fontWeight: "800", color: "#2E241C", marginBottom: 10 },
  label: { fontWeight: "700", color: "#2E241C", marginTop: 8, marginBottom: 6 },
  foodPick: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: "#E2D9CA", backgroundColor: "#fff", marginBottom: 6 },
  foodPickActive: { borderColor: "#3F855C", backgroundColor: "#EAF4ED" },
  input: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5DDCF", paddingHorizontal: 12, paddingVertical: 10 },
  saveBtn: { marginTop: 12, backgroundColor: "#3F855C", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  saveText: { color: "#fff", fontWeight: "700" },
  cancelBtn: { marginTop: 8, backgroundColor: "#EFE7DA", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
});
