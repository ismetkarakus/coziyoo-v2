import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
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
  const [tab, setTab] = useState<"active" | "passive">("active");

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

  const [cuisine, setCuisine] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [deliveryPickup, setDeliveryPickup] = useState(true);
  const [deliveryCourier, setDeliveryCourier] = useState(false);

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

  function resetForm() {
    setName("");
    setPrice("");
    setCardSummary("");
    setDescription("");
    setRecipe("");
    setIngredients("");
    setAllergens("");
    setImageUrl("");
    setPrepTime("");

    setCuisine("");
    setCategoryName("");
    setStartDate("");
    setEndDate("");
    setDeliveryPickup(true);
    setDeliveryCourier(false);
  }

  function openCreate() {
    setEditingFood(null);
    resetForm();
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

  const activeFoods = useMemo(() => foods.filter((x) => x.isActive), [foods]);
  const passiveFoods = useMemo(() => foods.filter((x) => !x.isActive), [foods]);
  const shownFoods = tab === "active" ? activeFoods : passiveFoods;

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Yemek Ekle"
        onBack={onBack}
        rightAction={
          <TouchableOpacity onPress={openCreate} style={styles.addBtn}>
            <Text style={styles.addText}>+ Yeni</Text>
          </TouchableOpacity>
        }
      />

      {loading ? (
        <Text style={styles.loadingText}>Yükleniyor...</Text>
      ) : foods.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Henüz yemek yok</Text>
          <Text style={styles.emptyText}>İlk yemeğini ekle, müşteriler seni görsün.</Text>
          <View style={{ height: 10 }} />
          <ActionButton label="Yemek Ekle" onPress={openCreate} />
        </View>
      ) : (
        <>
          <View style={styles.tabsRow}>
            <TouchableOpacity style={[styles.tabBtn, tab === "active" && styles.tabBtnActive]} onPress={() => setTab("active")}>
              <Text style={[styles.tabText, tab === "active" && styles.tabTextActive]}>Aktif ({activeFoods.length})</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.tabBtn, tab === "passive" && styles.tabBtnActive]} onPress={() => setTab("passive")}>
              <Text style={[styles.tabText, tab === "passive" && styles.tabTextActive]}>Pasif ({passiveFoods.length})</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={shownFoods}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.foodName}>{item.name}</Text>
                    <Text style={styles.meta}>Stok: {item.stock}</Text>
                    <Text style={styles.meta}>{item.price.toFixed(2)} ₺</Text>
                  </View>
                  <Text style={[styles.badge, item.isActive ? styles.badgeActive : styles.badgePassive]}>
                    {item.isActive ? "Yayında" : "Pasif"}
                  </Text>
                </View>

                {item.cardSummary ? <Text style={styles.summary}>{item.cardSummary}</Text> : null}

                <View style={styles.row}>
                  <ActionButton label="Düzenle" onPress={() => openEdit(item)} variant="soft" size="sm" />
                  <ActionButton
                    label={item.isActive ? "Satışı Kapat" : "Yayına Al"}
                    onPress={() => void toggleStatus(item)}
                    variant={item.isActive ? "danger" : "outline"}
                    size="sm"
                  />
                </View>
              </View>
            )}
          />
        </>
      )}

      <Modal visible={modalVisible} animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalRoot}>
          <ScreenHeader title={editingFood ? "Yemek Düzenle" : "Yemek Ekle"} onBack={() => setModalVisible(false)} />

          <ScrollView contentContainerStyle={styles.formWrap}>
            <Text style={styles.sectionTitle}>Yemek Fotoğrafları</Text>
            <View style={styles.uploadBox}>
              <Text style={styles.uploadEmoji}>📸</Text>
              <Text style={styles.uploadTitle}>Resim Ekle</Text>
              <Text style={styles.uploadHint}>(0/5)</Text>
            </View>
            <TextInput
              style={styles.input}
              value={imageUrl}
              onChangeText={setImageUrl}
              placeholder="Görsel URL"
              placeholderTextColor="#8F8A82"
            />

            <Text style={styles.label}>🌍 Hangi ülke/şehir mutfağı</Text>
            <TextInput
              style={styles.input}
              value={cuisine}
              onChangeText={setCuisine}
              placeholder="Örn: Türkiye, Hatay, İtalya"
              placeholderTextColor="#8F8A82"
            />

            <Text style={styles.label}>Kategori Seç</Text>
            <TextInput
              style={styles.input}
              value={categoryName}
              onChangeText={setCategoryName}
              placeholder="Kategori seçin"
              placeholderTextColor="#8F8A82"
            />

            <Text style={styles.label}>Yemek Adı *</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Örn: Ev Yapımı Mantı"
              placeholderTextColor="#8F8A82"
            />

            <Text style={styles.label}>Kart Sloganı (Kısa)</Text>
            <TextInput
              style={styles.input}
              value={cardSummary}
              onChangeText={setCardSummary}
              placeholder="Örn: Günlük taze, el yapımı"
              placeholderTextColor="#8F8A82"
            />

            <Text style={styles.label}>Açıklama / Baharatlar *</Text>
            <TextInput
              style={[styles.input, styles.area]}
              value={description}
              onChangeText={setDescription}
              placeholder="Yemeğinizin özelliklerini anlatın..."
              placeholderTextColor="#8F8A82"
              multiline
            />
            <Text style={styles.counter}>0/500 karakter</Text>

            <Text style={styles.label}>Tarif</Text>
            <TextInput
              style={[styles.input, styles.area]}
              value={recipe}
              onChangeText={setRecipe}
              placeholder="Yemeğin hazırlanış tarifini yazın..."
              placeholderTextColor="#8F8A82"
              multiline
            />
            <Text style={styles.counter}>0/500 karakter</Text>

            <Text style={styles.label}>Fiyat (₺) *</Text>
            <TextInput
              style={styles.input}
              value={price}
              onChangeText={setPrice}
              keyboardType="decimal-pad"
              placeholder="25"
              placeholderTextColor="#8F8A82"
            />

            <Text style={styles.label}>Günlük Stok *</Text>
            <TextInput
              style={styles.input}
              value={prepTime}
              onChangeText={setPrepTime}
              keyboardType="number-pad"
              placeholder="10"
              placeholderTextColor="#8F8A82"
            />

            <View style={styles.dateRow}>
              <View style={styles.dateCol}>
                <Text style={styles.label}>Başlangıç Tarihi</Text>
                <TextInput
                  style={styles.input}
                  value={startDate}
                  onChangeText={setStartDate}
                  placeholder="DD/MM/YYYY"
                  placeholderTextColor="#8F8A82"
                />
              </View>
              <View style={styles.dateCol}>
                <Text style={styles.label}>Bitiş Tarihi</Text>
                <TextInput
                  style={styles.input}
                  value={endDate}
                  onChangeText={setEndDate}
                  placeholder="DD/MM/YYYY"
                  placeholderTextColor="#8F8A82"
                />
              </View>
            </View>

            <Text style={styles.sectionTitle}>Teslimat Seçenekleri</Text>
            <View style={styles.optionRow}>
              <TouchableOpacity
                style={[styles.optionBtn, deliveryPickup && styles.optionBtnActive]}
                onPress={() => setDeliveryPickup((v) => !v)}
              >
                <Text style={[styles.optionText, deliveryPickup && styles.optionTextActive]}>
                  {deliveryPickup ? "✓ " : ""}Gel Al
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.optionBtn, deliveryCourier && styles.optionBtnActive]}
                onPress={() => setDeliveryCourier((v) => !v)}
              >
                <Text style={[styles.optionText, deliveryCourier && styles.optionTextActive]}>
                  {deliveryCourier ? "✓ " : ""}Teslimat
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionTitle}>Önizleme (Müşteri Görünümü)</Text>
            <View style={styles.previewCard}>
              <Text style={styles.previewName}>{name || "Yemek adı"}</Text>
              <Text style={styles.previewSummary}>{cardSummary || "Kısa slogan"}</Text>
              <Text style={styles.previewMeta}>{price || "0"} ₺</Text>
            </View>

            <View style={styles.submitRow}>
              <ActionButton label="İptal" onPress={() => setModalVisible(false)} variant="soft" fullWidth />
              <ActionButton
                label={saving ? "Kaydediliyor..." : "Kaydet"}
                onPress={() => void saveFood()}
                loading={saving}
                fullWidth
              />
            </View>

            <TextInput
              style={styles.hiddenInput}
              value={ingredients}
              onChangeText={setIngredients}
              placeholder="İçerikler"
            />
            <TextInput
              style={styles.hiddenInput}
              value={allergens}
              onChangeText={setAllergens}
              placeholder="Alerjenler"
            />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ECEBE7" },
  addBtn: { paddingHorizontal: 6, paddingVertical: 2 },
  addText: { color: theme.primary, fontWeight: "800", fontSize: 15 },

  loadingText: { textAlign: "center", marginTop: 40, color: "#6C6055" },
  emptyWrap: { marginTop: 48, alignItems: "center", paddingHorizontal: 24 },
  emptyTitle: { color: "#2E241C", fontWeight: "800", fontSize: 19, textAlign: "center" },
  emptyText: { textAlign: "center", marginTop: 6, color: "#9E8E7E" },

  tabsRow: { flexDirection: "row", paddingHorizontal: 12, gap: 8, marginTop: 8 },
  tabBtn: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#D2D0CA",
    backgroundColor: "#F1F1EE",
    alignItems: "center",
    paddingVertical: 9,
  },
  tabBtnActive: { backgroundColor: "#8EA18F", borderColor: "#8EA18F" },
  tabText: { color: "#4A463F", fontWeight: "700" },
  tabTextActive: { color: "#fff" },

  list: { padding: 12, gap: 10, paddingBottom: 24 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#D4D3CD",
    backgroundColor: "#F8F8F6",
    padding: 12,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  foodName: { color: "#2F2D2B", fontWeight: "800", fontSize: 17 },
  meta: { color: "#6E675D", marginTop: 2 },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 12,
    fontWeight: "800",
    overflow: "hidden",
  },
  badgeActive: { backgroundColor: "#E6F4E8", color: "#2A7A44" },
  badgePassive: { backgroundColor: "#F8EDEB", color: "#A0442E" },
  summary: { marginTop: 8, color: "#554C42" },
  row: { marginTop: 10, flexDirection: "row", gap: 8 },

  modalRoot: { flex: 1, backgroundColor: "#EDECE8" },
  formWrap: { padding: 14, paddingBottom: 40 },
  sectionTitle: { color: "#2F2D2B", fontWeight: "800", fontSize: 22, marginBottom: 8 },
  uploadBox: {
    width: 84,
    height: 84,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#CFCEC9",
    borderStyle: "dashed",
    backgroundColor: "#F6F6F3",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  uploadEmoji: { fontSize: 16 },
  uploadTitle: { color: "#5A554D", fontWeight: "700", marginTop: 2 },
  uploadHint: { color: "#8A847C", fontSize: 11, marginTop: 1 },

  label: { marginTop: 10, marginBottom: 5, color: "#2F2D2B", fontWeight: "700" },
  input: {
    backgroundColor: "#ECEBE8",
    borderWidth: 1,
    borderColor: "#CFCFC9",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#2F2D2B",
  },
  area: { minHeight: 115, textAlignVertical: "top" },
  counter: { marginTop: 5, color: "#8A847C", fontSize: 12 },

  dateRow: { flexDirection: "row", gap: 10 },
  dateCol: { flex: 1 },

  optionRow: { flexDirection: "row", gap: 10, marginTop: 6 },
  optionBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#CFCFC9",
    borderRadius: 8,
    backgroundColor: "#F5F5F3",
    paddingVertical: 11,
    alignItems: "center",
  },
  optionBtnActive: { backgroundColor: "#8EA18F", borderColor: "#8EA18F" },
  optionText: { color: "#2F2D2B", fontWeight: "700" },
  optionTextActive: { color: "#fff" },

  previewCard: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#D4D3CD",
    borderRadius: 10,
    backgroundColor: "#F8F8F6",
    padding: 12,
  },
  previewName: { fontWeight: "800", color: "#2F2D2B", fontSize: 16 },
  previewSummary: { marginTop: 4, color: "#6E675D" },
  previewMeta: { marginTop: 6, color: "#3E845B", fontWeight: "800" },

  submitRow: { marginTop: 12, gap: 8 },
  hiddenInput: { height: 0, opacity: 0 },
});
