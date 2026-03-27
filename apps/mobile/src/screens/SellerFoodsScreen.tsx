import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { AuthSession } from "../utils/auth";
import { refreshAuthSession } from "../utils/auth";
import { actorRoleHeader } from "../utils/actorRole";
import { loadSettings } from "../utils/settings";
import { theme } from "../theme/colors";
import ScreenHeader from "../components/ScreenHeader";

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

type SellerFood = {
  id: string;
  name: string;
  cardSummary: string | null;
  description: string | null;
  recipe: string | null;
  price: number;
  imageUrl: string | null;
  ingredients: string[];
  allergens: string[];
  preparationTimeMinutes: number | null;
  isActive: boolean;
  stock: number;
};

export default function SellerFoodsScreen({ auth, onBack, onAuthRefresh }: Props) {
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [foods, setFoods] = useState<SellerFood[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingFood, setEditingFood] = useState<SellerFood | null>(null);

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [cardSummary, setCardSummary] = useState("");
  const [description, setDescription] = useState("");
  const [recipe, setRecipe] = useState("");
  const [ingredients, setIngredients] = useState("");
  const [allergens, setAllergens] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [prepTime, setPrepTime] = useState("");

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
      const baseUrl = settings.apiUrl;
      setApiUrl(baseUrl);
      const res = await authedFetch("/v1/seller/foods", undefined, baseUrl);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Yemekler yüklenemedi");
      setFoods(Array.isArray(json?.data) ? json.data : []);
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Yemekler yüklenemedi");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadFoods();
  }, []);

  function openCreate() {
    setEditingFood(null);
    setName("");
    setPrice("");
    setCardSummary("");
    setDescription("");
    setRecipe("");
    setIngredients("");
    setAllergens("");
    setImageUrl("");
    setPrepTime("");
    setModalVisible(true);
  }

  function openEdit(food: SellerFood) {
    setEditingFood(food);
    setName(food.name);
    setPrice(String(food.price));
    setCardSummary(food.cardSummary ?? "");
    setDescription(food.description ?? "");
    setRecipe(food.recipe ?? "");
    setIngredients(food.ingredients.join(", "));
    setAllergens(food.allergens.join(", "));
    setImageUrl(food.imageUrl ?? "");
    setPrepTime(food.preparationTimeMinutes ? String(food.preparationTimeMinutes) : "");
    setModalVisible(true);
  }

  async function saveFood() {
    try {
      const payload = {
        name: name.trim(),
        price: Number(price),
        cardSummary: cardSummary.trim() || undefined,
        description: description.trim() || undefined,
        recipe: recipe.trim() || undefined,
        ingredients: ingredients.split(",").map((x) => x.trim()).filter(Boolean),
        allergens: allergens.split(",").map((x) => x.trim()).filter(Boolean),
        preparationTimeMinutes: prepTime.trim() ? Number(prepTime) : undefined,
      };
      if (!payload.name || !Number.isFinite(payload.price) || payload.price <= 0) {
        Alert.alert("Hata", "Yemek adı ve fiyat zorunlu.");
        return;
      }
      const path = editingFood ? `/v1/seller/foods/${editingFood.id}` : "/v1/seller/foods";
      const method = editingFood ? "PATCH" : "POST";
      const res = await authedFetch(path, { method, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Kaydedilemedi");

      const foodId = editingFood?.id ?? json?.data?.foodId;
      if (foodId && imageUrl.trim()) {
        await authedFetch(`/v1/seller/foods/${foodId}/image`, {
          method: "POST",
          body: JSON.stringify({ imageUrl: imageUrl.trim() }),
        });
      }
      setModalVisible(false);
      await loadFoods();
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Yemek kaydedilemedi");
    }
  }

  async function toggleStatus(food: SellerFood) {
    try {
      const res = await authedFetch(`/v1/seller/foods/${food.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !food.isActive }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Durum değiştirilemedi");
      await loadFoods();
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Durum değiştirilemedi");
    }
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Yemeklerim"
        onBack={onBack}
        rightAction={
          <TouchableOpacity onPress={openCreate}>
            <Text style={styles.add}>+ Ekle</Text>
          </TouchableOpacity>
        }
      />
      {loading ? (
        <ActivityIndicator size="large" color={theme.primary} />
      ) : (
        <FlatList
          data={foods}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 14, gap: 10 }}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.foodName}>{item.name}</Text>
              <Text style={styles.meta}>{item.price.toFixed(2)} TL · Stok: {item.stock}</Text>
              <Text style={styles.meta}>{item.isActive ? "Aktif" : "Pasif"}</Text>
              <View style={styles.row}>
                <TouchableOpacity style={styles.ghostBtn} onPress={() => openEdit(item)}><Text>Düzenle</Text></TouchableOpacity>
                <TouchableOpacity style={styles.ghostBtn} onPress={() => void toggleStatus(item)}><Text>{item.isActive ? "Pasifleştir" : "Aktifleştir"}</Text></TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}

      <Modal visible={modalVisible} animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <ScrollView style={styles.modal} contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.modalTitle}>{editingFood ? "Yemeği Düzenle" : "Yeni Yemek"}</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Yemek adı" />
          <TextInput style={styles.input} value={price} onChangeText={setPrice} placeholder="Fiyat" keyboardType="decimal-pad" />
          <TextInput style={styles.input} value={cardSummary} onChangeText={setCardSummary} placeholder="Kısa özet" />
          <TextInput style={styles.input} value={description} onChangeText={setDescription} placeholder="Açıklama" />
          <TextInput style={styles.input} value={recipe} onChangeText={setRecipe} placeholder="Tarif" />
          <TextInput style={styles.input} value={ingredients} onChangeText={setIngredients} placeholder="İçerikler (virgül)" />
          <TextInput style={styles.input} value={allergens} onChangeText={setAllergens} placeholder="Alerjenler (virgül)" />
          <TextInput style={styles.input} value={prepTime} onChangeText={setPrepTime} placeholder="Hazırlık süresi (dk)" keyboardType="number-pad" />
          <TextInput style={styles.input} value={imageUrl} onChangeText={setImageUrl} placeholder="Görsel URL" />
          <TouchableOpacity style={styles.saveBtn} onPress={() => void saveFood()}><Text style={styles.saveText}>Kaydet</Text></TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalVisible(false)}><Text>Vazgeç</Text></TouchableOpacity>
        </ScrollView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F4EF" },
  add: { color: "#3F855C", fontWeight: "700", fontSize: 14 },
  card: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5DDCF", padding: 12 },
  foodName: { color: "#2E241C", fontWeight: "800", fontSize: 16 },
  meta: { color: "#6F6358", marginTop: 4 },
  row: { marginTop: 10, flexDirection: "row", gap: 8 },
  ghostBtn: { backgroundColor: "#F4EEE4", paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8 },
  modal: { flex: 1, backgroundColor: "#F7F4EF" },
  modalContent: { padding: 16, paddingBottom: 40 },
  modalTitle: { fontSize: 22, fontWeight: "800", color: "#2E241C", marginBottom: 10 },
  input: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5DDCF", paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8, color: "#2E241C" },
  saveBtn: { marginTop: 8, backgroundColor: "#3F855C", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  saveText: { color: "#fff", fontWeight: "700" },
  cancelBtn: { marginTop: 8, backgroundColor: "#EFE7DA", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
});
