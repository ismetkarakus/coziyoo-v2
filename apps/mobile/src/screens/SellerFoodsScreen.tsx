import React, { useEffect, useState } from "react";
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
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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

  function handleRefresh(session: AuthSession) {
    setCurrentAuth(session);
    onAuthRefresh?.(session);
  }

  async function loadFoods() {
    setLoading(true);
    try {
      const res = await apiRequest<SellerFood[]>("/v1/seller/foods", currentAuth, { actorRole: "seller" }, handleRefresh);
      if (!res.ok) throw new Error(res.message ?? "Yemekler yüklenemedi");
      setFoods(Array.isArray(res.data) ? res.data : []);
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
    setName(""); setPrice(""); setCardSummary(""); setDescription("");
    setRecipe(""); setIngredients(""); setAllergens(""); setImageUrl(""); setPrepTime("");
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
    const payload: Record<string, unknown> = {
      name: name.trim(),
      price: Number(price),
      cardSummary: cardSummary.trim() || undefined,
      description: description.trim() || undefined,
      recipe: recipe.trim() || undefined,
      ingredients: ingredients.split(",").map((x) => x.trim()).filter(Boolean),
      allergens: allergens.split(",").map((x) => x.trim()).filter(Boolean),
      preparationTimeMinutes: prepTime.trim() ? Number(prepTime) : undefined,
      imageUrl: imageUrl.trim() || undefined,
    };
    if (!payload.name || !Number.isFinite(payload.price as number) || (payload.price as number) <= 0) {
      Alert.alert("Hata", "Yemek adı ve fiyat zorunlu.");
      return;
    }
    setSaving(true);
    try {
      const path = editingFood ? `/v1/seller/foods/${editingFood.id}` : "/v1/seller/foods";
      const method = editingFood ? "PATCH" : "POST";
      const res = await apiRequest<{ foodId: string }>(path, currentAuth, { method, body: payload, actorRole: "seller" }, handleRefresh);
      if (!res.ok) throw new Error(res.message ?? "Kaydedilemedi");
      setModalVisible(false);
      await loadFoods();
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Yemek kaydedilemedi");
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(food: SellerFood) {
    try {
      const res = await apiRequest(`/v1/seller/foods/${food.id}/status`, currentAuth, {
        method: "PATCH",
        body: { isActive: !food.isActive },
        actorRole: "seller",
      }, handleRefresh);
      if (!res.ok) throw new Error(res.message ?? "Durum değiştirilemedi");
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
          <TouchableOpacity onPress={openCreate} style={styles.addBtn}>
            <Text style={styles.addText}>+ Ekle</Text>
          </TouchableOpacity>
        }
      />
      {loading ? (
        <Text style={styles.loadingText}>Yükleniyor...</Text>
      ) : foods.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Henüz menünde yemek yok.</Text>
          <Text style={styles.emptyText}>İlk yemeğini ekle, müşteriler görmeye başlasın.</Text>
        </View>
      ) : (
        <>
          <View style={styles.heroCard}>
            <Text style={styles.heroTitle}>Menün burada.</Text>
            <Text style={styles.heroText}>Fiyatı, stok durumu ve görünürlüğü tek yerden kontrol edebilirsin.</Text>
          </View>
          <FlatList
            data={foods}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <Text style={styles.foodName}>{item.name}</Text>
                <Text style={styles.meta}>{item.price.toFixed(2)} TL · Stok: {item.stock}</Text>
                <Text style={[styles.badge, item.isActive ? styles.badgeActive : styles.badgePassive]}>
                  {item.isActive ? "Yayında" : "Yayında Değil"}
                </Text>
                <View style={styles.row}>
                  <ActionButton label="Düzenle" onPress={() => openEdit(item)} variant="soft" size="sm" />
                  <ActionButton
                    label={item.isActive ? "Yayından Kaldır" : "Yayına Al"}
                    onPress={() => void toggleStatus(item)}
                    variant="outline"
                    size="sm"
                  />
                </View>
              </View>
            )}
          />
        </>
      )}

      <Modal visible={modalVisible} animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>{editingFood ? "Yemeği Düzenle" : "Yeni Yemek Ekle"}</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Yemek adı" />
          <TextInput style={styles.input} value={price} onChangeText={setPrice} placeholder="Fiyat" keyboardType="decimal-pad" />
          <TextInput style={styles.input} value={cardSummary} onChangeText={setCardSummary} placeholder="Kısa özet" />
          <TextInput style={styles.input} value={description} onChangeText={setDescription} placeholder="Açıklama" />
          <TextInput style={styles.input} value={recipe} onChangeText={setRecipe} placeholder="Tarif" />
          <TextInput style={styles.input} value={ingredients} onChangeText={setIngredients} placeholder="İçerikler (virgül ile)" />
          <TextInput style={styles.input} value={allergens} onChangeText={setAllergens} placeholder="Alerjenler (virgül ile)" />
          <TextInput style={styles.input} value={prepTime} onChangeText={setPrepTime} placeholder="Hazırlık süresi (dk)" keyboardType="number-pad" />
          <TextInput style={styles.input} value={imageUrl} onChangeText={setImageUrl} placeholder="Görsel URL" />
          <ActionButton label="Kaydet" onPress={() => void saveFood()} loading={saving} fullWidth />
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
  foodName: { color: "#2E241C", fontWeight: "800", fontSize: 16 },
  meta: { color: "#6F6358", marginTop: 4 },
  badge: { alignSelf: "flex-start", marginTop: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, fontSize: 12, fontWeight: "700", overflow: "hidden" },
  badgeActive: { backgroundColor: "#EAF4ED", color: "#2E6B44" },
  badgePassive: { backgroundColor: "#F4EDEA", color: "#7A3E2A" },
  row: { marginTop: 10, flexDirection: "row", gap: 8 },
  modal: { flex: 1, backgroundColor: "#F7F4EF", padding: 16 },
  modalTitle: { fontSize: 22, fontWeight: "800", color: "#2E241C", marginBottom: 12 },
  input: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5DDCF", paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8, color: "#2E241C" },
  gap: { height: 8 },
});
