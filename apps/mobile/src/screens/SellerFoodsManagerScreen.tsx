import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Modal, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { AuthSession } from "../utils/auth";
import { refreshAuthSession } from "../utils/auth";
import { actorRoleHeader } from "../utils/actorRole";
import { loadSettings } from "../utils/settings";
import ScreenHeader from "../components/ScreenHeader";
import ActionButton from "../components/ActionButton";

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

type SellerFood = {
  id: string;
  name: string;
  cardSummary?: string | null;
  price: number;
  isActive: boolean;
  stock?: number;
};

export default function SellerFoodsManagerScreen({ auth, onBack, onAuthRefresh }: Props) {
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [foods, setFoods] = useState<SellerFood[]>([]);
  const [editing, setEditing] = useState<SellerFood | null>(null);
  const [editName, setEditName] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editActive, setEditActive] = useState(true);

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

  async function loadFoods() {
    setLoading(true);
    try {
      const settings = await loadSettings();
      setApiUrl(settings.apiUrl);
      const res = await authedFetch("/v1/seller/foods", undefined, settings.apiUrl);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Yemekler yüklenemedi");
      const list: SellerFood[] = Array.isArray(json?.data) ? json.data.map((item: any) => ({
        id: String(item.id),
        name: String(item.name ?? ""),
        cardSummary: typeof item.cardSummary === "string" ? item.cardSummary : null,
        price: Number(item.price ?? 0),
        isActive: Boolean(item.isActive),
        stock: Number(item.stock ?? 0),
      })) : [];
      setFoods(list);
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Yemekler yüklenemedi");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadFoods();
  }, []);

  function openEdit(food: SellerFood) {
    setEditing(food);
    setEditName(food.name);
    setEditSummary(food.cardSummary ?? "");
    setEditPrice(String(food.price));
    setEditActive(food.isActive);
  }

  async function saveEdit() {
    if (!editing) return;
    const nextPrice = Number(editPrice);
    if (!editName.trim()) {
      Alert.alert("Hata", "Yemek adı boş olamaz.");
      return;
    }
    if (!Number.isFinite(nextPrice) || nextPrice <= 0) {
      Alert.alert("Hata", "Fiyat 0'dan büyük olmalı.");
      return;
    }

    setSaving(true);
    try {
      const patchRes = await authedFetch(`/v1/seller/foods/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editName.trim(),
          cardSummary: editSummary.trim() || null,
          price: nextPrice,
        }),
      });
      const patchJson = await patchRes.json();
      if (!patchRes.ok) throw new Error(patchJson?.error?.message ?? "Yemek güncellenemedi");

      const statusRes = await authedFetch(`/v1/seller/foods/${editing.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: editActive }),
      });
      const statusJson = await statusRes.json();
      if (!statusRes.ok) throw new Error(statusJson?.error?.message ?? "Durum güncellenemedi");

      setEditing(null);
      await loadFoods();
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Yemek güncellenemedi");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Yemek Yönetimi" onBack={onBack} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#3F855C" />
        </View>
      ) : (
        <FlatList
          data={foods}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} activeOpacity={0.82} onPress={() => openEdit(item)}>
              <View style={styles.rowTop}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={[styles.badge, item.isActive ? styles.badgeActive : styles.badgePassive]}>
                  {item.isActive ? "Aktif" : "Pasif"}
                </Text>
              </View>
              <Text style={styles.summary}>{item.cardSummary || "Özet yok"}</Text>
              <View style={styles.rowBottom}>
                <Text style={styles.price}>{item.price.toFixed(2)} TL</Text>
                <Text style={styles.stock}>Stok: {item.stock ?? 0}</Text>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Henüz yemek yok</Text>
              <Text style={styles.emptySub}>Yemek eklediğinde burada göreceksin.</Text>
            </View>
          }
        />
      )}

      <Modal visible={Boolean(editing)} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Yemeği Düzenle</Text>

            <Text style={styles.label}>Yemek Adı</Text>
            <TextInput style={styles.input} value={editName} onChangeText={setEditName} placeholder="Yemek adı" />

            <Text style={styles.label}>Kısa Özet</Text>
            <TextInput style={styles.input} value={editSummary} onChangeText={setEditSummary} placeholder="Kısa özet" />

            <Text style={styles.label}>Fiyat (TL)</Text>
            <TextInput
              style={styles.input}
              value={editPrice}
              onChangeText={setEditPrice}
              keyboardType="decimal-pad"
              placeholder="Örn: 120"
            />

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Aktif Durum</Text>
              <Switch value={editActive} onValueChange={setEditActive} />
            </View>

            <View style={styles.modalActions}>
              <ActionButton label="Vazgeç" variant="soft" onPress={() => setEditing(null)} fullWidth />
              <ActionButton label="Kaydet" onPress={() => void saveEdit()} loading={saving} fullWidth />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F4EF" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 14, gap: 10, paddingBottom: 24 },
  card: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5DDCF", padding: 12, gap: 6 },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  name: { color: "#2E241C", fontWeight: "800", fontSize: 16, flex: 1, paddingRight: 8 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, fontSize: 11, fontWeight: "700", overflow: "hidden" },
  badgeActive: { color: "#2F6D49", backgroundColor: "#EAF4EE" },
  badgePassive: { color: "#7C6A58", backgroundColor: "#F3ECE5" },
  summary: { color: "#6C6055", fontSize: 13 },
  rowBottom: { flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
  price: { color: "#2E241C", fontWeight: "800" },
  stock: { color: "#6C6055", fontWeight: "600" },
  emptyCard: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5DDCF", padding: 14 },
  emptyTitle: { color: "#2E241C", fontSize: 16, fontWeight: "800" },
  emptySub: { color: "#6C6055", marginTop: 4 },
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.35)" },
  modalCard: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    gap: 8,
  },
  modalTitle: { color: "#2E241C", fontSize: 18, fontWeight: "800", marginBottom: 4 },
  label: { color: "#5E5247", fontWeight: "700", fontSize: 13 },
  input: {
    borderWidth: 1,
    borderColor: "#E2D8CC",
    backgroundColor: "#FCFAF7",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#2E241C",
  },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 6,
    marginBottom: 4,
  },
  switchLabel: { color: "#2E241C", fontWeight: "700" },
  modalActions: { gap: 8, marginTop: 4, paddingBottom: 8 },
});
