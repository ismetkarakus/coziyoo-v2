import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

export default function SellerFoodsScreen({ auth, onBack, onAuthRefresh }: Props) {
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [foods, setFoods] = useState<SellerFood[]>([]);
  const [editingFood, setEditingFood] = useState<SellerFood | null>(null);

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [cardSummary, setCardSummary] = useState("");
  const [description, setDescription] = useState("");
  const [recipe, setRecipe] = useState("");
  const [ingredients, setIngredients] = useState("");
  const [allergens, setAllergens] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>([""]);
  const [prepTime, setPrepTime] = useState("");

  // UI parity fields (opsiyonlar)
  const [cuisine, setCuisine] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [dailyStock, setDailyStock] = useState("10");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [pickupEnabled, setPickupEnabled] = useState(true);
  const [deliveryEnabled, setDeliveryEnabled] = useState(true);
  const [deliveryFee, setDeliveryFee] = useState("");

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

  function resetForm() {
    setEditingFood(null);
    setName("");
    setPrice("");
    setCardSummary("");
    setDescription("");
    setRecipe("");
    setIngredients("");
    setAllergens("");
    setImageUrls([""]);
    setPrepTime("");
    setCuisine("");
    setCategoryId("");
    setDailyStock("10");
    setStartDate("");
    setEndDate("");
    setPickupEnabled(true);
    setDeliveryEnabled(true);
    setDeliveryFee("");
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
    setImageUrls([food.imageUrl ?? ""]);
    setPrepTime(food.preparationTimeMinutes ? String(food.preparationTimeMinutes) : "");
  }

  const canShowDeliveryFee = deliveryEnabled;

  function setImageAt(index: number, value: string) {
    setImageUrls((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  async function pickImageFromAlbum(index: number) {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("İzin Gerekli", "Albümden fotoğraf seçmek için galeri izni vermelisin.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        quality: 0.75,
        base64: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      if (!asset.base64) {
        Alert.alert("Hata", "Fotoğraf verisi alınamadı.");
        return;
      }
      const mimeType = asset.mimeType ?? "image/jpeg";
      const dataUrl = `data:${mimeType};base64,${asset.base64}`;
      setImageAt(index, dataUrl);
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Fotoğraf seçilemedi.");
    }
  }

  function addPhotoField() {
    setImageUrls((prev) => (prev.length >= 5 ? prev : [...prev, ""]));
  }

  function removePhotoField(index: number) {
    setImageUrls((prev) => {
      if (prev.length <= 1) return [""];
      const next = prev.filter((_, i) => i !== index);
      return next.length > 0 ? next : [""];
    });
  }

  async function saveFood(options?: { publishAfterSave?: boolean }) {
    try {
      if (!pickupEnabled && !deliveryEnabled) {
        Alert.alert("Hata", "En az bir teslimat seçeneği seçmelisin (Gel Al veya Teslimat).");
        return;
      }

      const parsedPrice = Number(price);
      if (!name.trim() || !Number.isFinite(parsedPrice) || parsedPrice <= 0) {
        Alert.alert("Hata", "Yemek adı ve fiyat zorunlu.");
        return;
      }

      setSaving(true);

      const primaryImageUrl = imageUrls.map((x) => x.trim()).find(Boolean) || undefined;
      const payload: Record<string, unknown> = {
        name: name.trim(),
        price: parsedPrice,
        cardSummary: cardSummary.trim() || undefined,
        description: description.trim() || undefined,
        recipe: recipe.trim() || undefined,
        imageUrl: primaryImageUrl,
        ingredients: ingredients.split(",").map((x) => x.trim()).filter(Boolean),
        allergens: allergens.split(",").map((x) => x.trim()).filter(Boolean),
        preparationTimeMinutes: prepTime.trim() ? Number(prepTime) : undefined,
      };

      if (isUuid(categoryId)) {
        payload.categoryId = categoryId.trim();
      }

      const path = editingFood ? `/v1/seller/foods/${editingFood.id}` : "/v1/seller/foods";
      const method = editingFood ? "PATCH" : "POST";
      const res = await authedFetch(path, { method, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Kaydedilemedi");

      const foodId = editingFood?.id ?? json?.data?.foodId;
      if (foodId && primaryImageUrl) {
        const imageRes = await authedFetch(`/v1/seller/foods/${foodId}/image`, {
          method: "POST",
          body: JSON.stringify({ imageUrl: primaryImageUrl }),
        });
        if (!imageRes.ok) {
          const imageJson = await imageRes.json();
          throw new Error(imageJson?.error?.message ?? "Görsel kaydedilemedi");
        }
      }

      await loadFoods();
      resetForm();
      if (options?.publishAfterSave) {
        Alert.alert("Başarılı", "Yemek yayınlandı.", [{ text: "Tamam", onPress: onBack }]);
      } else {
        Alert.alert("Başarılı", "Yemek kaydedildi.");
      }
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Yemek kaydedilemedi");
    } finally {
      setSaving(false);
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

  const deliveryTypeHint = useMemo(() => {
    if (pickupEnabled && deliveryEnabled) return "Gel Al ve Teslimat birlikte açık";
    if (pickupEnabled) return "Sadece Gel Al açık";
    if (deliveryEnabled) return "Sadece Teslimat açık";
    return "";
  }, [pickupEnabled, deliveryEnabled]);

  const previewImage = imageUrls.map((x) => x.trim()).find(Boolean) || "";
  const previewTitle = name.trim() || "Yemek Adı";
  const previewSummary = cardSummary.trim() || description.trim() || "Yemeğiniz burada müşteri kartında görünecek.";
  const previewPrice = Number.isFinite(Number(price)) && Number(price) > 0 ? `${Number(price).toFixed(2)} ₺` : "-- ₺";

  return (
    <View style={styles.container}>
      <ScreenHeader title="Yemek Ekle" onBack={onBack} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.sectionTitle}>Yemek Fotoğrafları</Text>
          {imageUrls.map((url, index) => (
            <View key={`photo-${index}`} style={styles.photoRow}>
              <TouchableOpacity style={styles.photoPreviewBtn} onPress={() => void pickImageFromAlbum(index)}>
                {url.trim() ? (
                  <Image source={{ uri: url }} style={styles.photoPreviewImage} />
                ) : (
                  <View style={styles.photoPreviewPlaceholder}>
                    <Text style={styles.photoPreviewIcon}>📸</Text>
                    <Text style={styles.photoPreviewText}>Resim Ekle</Text>
                    <Text style={styles.photoPreviewSub}>(Tak/Çek/Kamera)</Text>
                  </View>
                )}
              </TouchableOpacity>
              <TextInput
                style={[styles.input, styles.photoInput]}
                value={url}
                onChangeText={(value) => setImageAt(index, value)}
                placeholder={`Fotoğraf ${index + 1} URL`}
              />
              {imageUrls.length > 1 ? (
                <TouchableOpacity style={styles.photoRemoveBtn} onPress={() => removePhotoField(index)}>
                  <Text style={styles.photoRemoveText}>Sil</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ))}
          {imageUrls.length < 5 ? (
            <TouchableOpacity style={styles.photoAddBtn} onPress={addPhotoField}>
              <Text style={styles.photoAddText}>+ Fotoğraf Ekle ({imageUrls.length}/5)</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.subHint}>En fazla 5 fotoğraf ekleyebilirsin.</Text>
          )}
          <Text style={styles.subHint}>Fotoğraf kutusuna dokunup albümden seçebilirsin.</Text>

          <Text style={styles.sectionTitle}>Hangi Ülke/Şehir Mutfağı *</Text>
          <TextInput style={styles.input} value={cuisine} onChangeText={setCuisine} placeholder="Örn: Türkiye, Hatay, İtalyan" />

          <Text style={styles.sectionTitle}>Kategori Seç</Text>
          <TextInput style={styles.input} value={categoryId} onChangeText={setCategoryId} placeholder="Kategori UUID (opsiyonel)" />

          <Text style={styles.sectionTitle}>Yemek Adı *</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Örn: Ev Yapımı Mantı" />

          <Text style={styles.sectionTitle}>Kart Sloganı (Kısa)</Text>
          <TextInput style={styles.input} value={cardSummary} onChangeText={setCardSummary} placeholder="Örn: Günlük taze, ev yapımı" />

          <Text style={styles.sectionTitle}>Malzemeler / Baharatlar *</Text>
          <TextInput style={[styles.input, styles.textArea]} value={description} onChangeText={setDescription} placeholder="Yemeğinizin özelliklerini açıklayın" multiline />

          <Text style={styles.sectionTitle}>Tarif</Text>
          <TextInput style={[styles.input, styles.textArea]} value={recipe} onChangeText={setRecipe} placeholder="Yemeğin hazırlanışını yazın" multiline />

          <Text style={styles.sectionTitle}>İçerikler</Text>
          <TextInput style={styles.input} value={ingredients} onChangeText={setIngredients} placeholder="Örn: Un, süt, yumurta" />

          <Text style={styles.sectionTitle}>Alerjenler</Text>
          <TextInput style={styles.input} value={allergens} onChangeText={setAllergens} placeholder="Örn: Gluten, süt" />

          <Text style={styles.sectionTitle}>Fiyat (₺) *</Text>
          <TextInput style={styles.input} value={price} onChangeText={setPrice} placeholder="25" keyboardType="decimal-pad" />

          <Text style={styles.sectionTitle}>Günlük Stok *</Text>
          <TextInput style={styles.input} value={dailyStock} onChangeText={setDailyStock} placeholder="10" keyboardType="number-pad" />

          <View style={styles.row2}>
            <View style={styles.rowItem}>
              <Text style={styles.sectionTitle}>Başlangıç Tarihi</Text>
              <TextInput style={styles.input} value={startDate} onChangeText={setStartDate} placeholder="DD/MM/YYYY" />
            </View>
            <View style={styles.rowItem}>
              <Text style={styles.sectionTitle}>Bitiş Tarihi</Text>
              <TextInput style={styles.input} value={endDate} onChangeText={setEndDate} placeholder="DD/MM/YYYY" />
            </View>
          </View>

          <Text style={styles.sectionTitle}>Teslimat Seçenekleri</Text>
          <View style={styles.row2}>
            <TouchableOpacity
              style={[styles.deliveryToggle, pickupEnabled && styles.deliveryToggleActive]}
              onPress={() => setPickupEnabled((prev) => !prev)}
            >
              <Text style={[styles.deliveryToggleText, pickupEnabled && styles.deliveryToggleTextActive]}>Gel Al</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.deliveryToggle, deliveryEnabled && styles.deliveryToggleActive]}
              onPress={() => {
                setDeliveryEnabled((prev) => {
                  const next = !prev;
                  if (!next) setDeliveryFee("");
                  return next;
                });
              }}
            >
              <Text style={[styles.deliveryToggleText, deliveryEnabled && styles.deliveryToggleTextActive]}>Teslimat</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.optionHint}>{deliveryTypeHint}</Text>

          {canShowDeliveryFee ? (
            <>
              <Text style={styles.sectionTitle}>Teslimat Ücreti (₺)</Text>
              <TextInput
                style={styles.input}
                value={deliveryFee}
                onChangeText={setDeliveryFee}
                placeholder="Örn: 10"
                keyboardType="decimal-pad"
              />
              <Text style={styles.subHint}>Müşterilerden alacağınız teslimat ücreti</Text>
            </>
          ) : null}

          <Text style={styles.sectionTitle}>Hazırlık Süresi (dk)</Text>
          <TextInput style={styles.input} value={prepTime} onChangeText={setPrepTime} placeholder="Örn: 45" keyboardType="number-pad" />

          <TouchableOpacity style={styles.previewBtn} onPress={() => setPreviewVisible(true)}>
            <Text style={styles.previewBtnText}>👁️ Önizleme (Müşteri Görünümü)</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.btnDisabled]}
            onPress={() => void saveFood({ publishAfterSave: true })}
            disabled={saving}
          >
            <Text style={styles.saveText}>{saving ? "Yayınlanıyor..." : "Yemeği Yayınla"}</Text>
          </TouchableOpacity>

          {editingFood ? (
            <TouchableOpacity style={styles.cancelBtn} onPress={resetForm}>
              <Text style={styles.cancelText}>Düzenlemeyi Temizle</Text>
            </TouchableOpacity>
          ) : null}

          <View style={styles.listHeaderRow}>
            <Text style={styles.listHeader}>Mevcut Yemekler</Text>
            <TouchableOpacity onPress={resetForm}><Text style={styles.newFoodLink}>+ Yeni Form</Text></TouchableOpacity>
          </View>

          {loading ? (
            <ActivityIndicator size="large" color={theme.primary} style={{ marginVertical: 16 }} />
          ) : foods.length === 0 ? (
            <Text style={styles.emptyText}>Henüz yemek eklenmedi.</Text>
          ) : (
            foods.map((item) => (
              <View style={styles.card} key={item.id}>
                <Text style={styles.foodName}>{item.name}</Text>
                <Text style={styles.meta}>{item.price.toFixed(2)} TL · Stok: {item.stock}</Text>
                <Text style={styles.meta}>{item.isActive ? "Aktif" : "Pasif"}</Text>
                <View style={styles.actionsRow}>
                  <TouchableOpacity style={styles.ghostBtn} onPress={() => openEdit(item)}><Text>Düzenle</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.ghostBtn} onPress={() => void toggleStatus(item)}><Text>{item.isActive ? "Pasifleştir" : "Aktifleştir"}</Text></TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={previewVisible} transparent animationType="fade" onRequestClose={() => setPreviewVisible(false)}>
        <View style={styles.previewOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={() => setPreviewVisible(false)} />
          <View style={styles.previewCard}>
            <Text style={styles.previewTitle}>Müşteri Görünümü</Text>
            <View style={styles.previewFoodCard}>
              {previewImage ? (
                <Image source={{ uri: previewImage }} style={styles.previewImage} />
              ) : (
                <View style={styles.previewImagePlaceholder}>
                  <Text style={styles.previewImagePlaceholderText}>Fotoğraf Önizleme</Text>
                </View>
              )}
              <View style={styles.previewBody}>
                <Text style={styles.previewFoodTitle}>{previewTitle}</Text>
                <Text style={styles.previewFoodSummary} numberOfLines={2}>{previewSummary}</Text>
                <View style={styles.previewFooter}>
                  <Text style={styles.previewPrice}>{previewPrice}</Text>
                  <Text style={styles.previewSeller}>Ev Şefi</Text>
                </View>
              </View>
            </View>
            <TouchableOpacity style={styles.previewCloseBtn} onPress={() => setPreviewVisible(false)}>
              <Text style={styles.previewCloseBtnText}>Düzenlemeye Devam Et</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: "#F7F4EF" },
  page: { flex: 1 },
  content: { padding: 14, paddingBottom: 42 },
  sectionTitle: { color: "#2E241C", fontWeight: "700", marginBottom: 6, marginTop: 10 },
  input: {
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E5DDCF",
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: "#2E241C",
  },
  textArea: {
    minHeight: 120,
    textAlignVertical: "top",
    paddingTop: 10,
  },
  row2: { flexDirection: "row", gap: 10 },
  rowItem: { flex: 1 },
  photoRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  photoPreviewBtn: {
    width: 92,
    height: 92,
    borderWidth: 1,
    borderColor: "#E5DDCF",
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#F4EEE4",
    alignItems: "center",
    justifyContent: "center",
  },
  photoPreviewImage: { width: "100%", height: "100%" },
  photoPreviewPlaceholder: { alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  photoPreviewIcon: { fontSize: 16 },
  photoPreviewText: { fontSize: 11, color: "#4B4137", fontWeight: "700", marginTop: 2, textAlign: "center" },
  photoPreviewSub: { fontSize: 9, color: "#8A7A6A", marginTop: 2, textAlign: "center" },
  photoInput: { flex: 1 },
  photoAddBtn: {
    marginTop: 4,
    marginBottom: 2,
    borderWidth: 1,
    borderColor: "#D8CCBA",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  photoAddText: { color: "#3F855C", fontWeight: "700" },
  photoRemoveBtn: {
    borderWidth: 1,
    borderColor: "#E4D7C5",
    backgroundColor: "#F7EFE2",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  photoRemoveText: { color: "#7A4A2A", fontWeight: "700" },
  deliveryToggle: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#DCD2C2",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  deliveryToggleActive: {
    backgroundColor: "#8FA58F",
    borderColor: "#8FA58F",
  },
  deliveryToggleText: { color: "#473C31", fontWeight: "700" },
  deliveryToggleTextActive: { color: "#fff" },
  optionHint: { color: "#75685C", fontSize: 12, marginTop: 6 },
  subHint: { color: "#75685C", fontSize: 12, marginTop: 6 },
  previewBtn: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: "#D6CCBD",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  previewBtnText: { color: "#46392D", fontWeight: "700" },
  saveBtn: {
    marginTop: 10,
    backgroundColor: "#3F855C",
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
  },
  saveText: { color: "#fff", fontWeight: "800" },
  btnDisabled: { opacity: 0.7 },
  cancelBtn: {
    marginTop: 8,
    backgroundColor: "#EFE7DA",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  cancelText: { color: "#4A3D31", fontWeight: "700" },
  listHeaderRow: { marginTop: 18, marginBottom: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  listHeader: { color: "#2E241C", fontWeight: "800", fontSize: 16 },
  newFoodLink: { color: "#3F855C", fontWeight: "700" },
  emptyText: { color: "#75685C", paddingVertical: 8 },
  card: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5DDCF", padding: 12, marginBottom: 10 },
  foodName: { color: "#2E241C", fontWeight: "800", fontSize: 16 },
  meta: { color: "#6F6358", marginTop: 4 },
  actionsRow: { marginTop: 10, flexDirection: "row", gap: 8 },
  ghostBtn: { backgroundColor: "#F4EEE4", paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8 },
  previewOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.42)",
    justifyContent: "center",
    padding: 16,
  },
  previewCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E5DDCF",
  },
  previewTitle: { color: "#2E241C", fontWeight: "800", fontSize: 16, marginBottom: 10 },
  previewFoodCard: {
    borderWidth: 1,
    borderColor: "#E5DDCF",
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#FDFBF8",
  },
  previewImage: { width: "100%", height: 160, backgroundColor: "#EDE5D8" },
  previewImagePlaceholder: {
    width: "100%",
    height: 160,
    backgroundColor: "#EFE7DA",
    alignItems: "center",
    justifyContent: "center",
  },
  previewImagePlaceholderText: { color: "#77695B", fontWeight: "600" },
  previewBody: { padding: 12 },
  previewFoodTitle: { color: "#2E241C", fontWeight: "800", fontSize: 16 },
  previewFoodSummary: { color: "#6F6358", marginTop: 4 },
  previewFooter: { marginTop: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  previewPrice: { color: "#2E6B44", fontWeight: "800", fontSize: 15 },
  previewSeller: { color: "#8A7A6A", fontWeight: "600" },
  previewCloseBtn: {
    marginTop: 12,
    backgroundColor: "#3F855C",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  previewCloseBtnText: { color: "#fff", fontWeight: "700" },
});
