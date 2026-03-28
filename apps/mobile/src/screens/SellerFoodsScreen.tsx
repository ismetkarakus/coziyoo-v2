import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import type { AuthSession } from "../utils/auth";
import { refreshAuthSession } from "../utils/auth";
import { actorRoleHeader } from "../utils/actorRole";
import { loadSettings } from "../utils/settings";
import { theme } from "../theme/colors";
import ScreenHeader from "../components/ScreenHeader";
import { HOME_FOOD_CATEGORIES } from "../constants/foodCategories";

type Props = {
  auth: AuthSession;
  onBack: () => void;
  initialEditFoodId?: string | null;
  onAuthRefresh?: (session: AuthSession) => void;
};

type SellerFood = {
  id: string;
  categoryId: string | null;
  categoryName: string | null;
  name: string;
  cardSummary: string | null;
  description: string | null;
  recipe: string | null;
  cuisine: string | null;
  menuItems?: Array<{
    name: string;
    categoryId?: string;
    categoryName?: string | null;
    kind?: "sauce" | "extra" | "appetizer";
    pricing?: "free" | "paid";
    price?: number;
  }>;
  secondaryCategories?: Array<{ id: string; name: string }>;
  price: number;
  deliveryFee: number;
  deliveryOptions: { pickup: boolean; delivery: boolean } | null;
  imageUrl: string | null;
  imageUrls: string[];
  ingredients: string[];
  allergens: string[];
  preparationTimeMinutes: number | null;
  isActive: boolean;
  stock: number;
};

type FoodCategoryOption = {
  id: string;
  name: string;
};

type AddonKind = "sauce" | "extra" | "appetizer";
type AddonPricing = "free" | "paid";
type SellerMenuAddon = {
  name: string;
  kind: AddonKind;
  pricing: AddonPricing;
  price?: number;
};

const ADDON_KIND_OPTIONS: Array<{ value: AddonKind; label: string }> = [
  { value: "sauce", label: "Soslar" },
  { value: "extra", label: "Ek Gıdalar" },
  { value: "appetizer", label: "Aparatifler" },
];

function fallbackHomeCategoryOptions(): FoodCategoryOption[] {
  return HOME_FOOD_CATEGORIES.map((name) => ({
    id: `home:${name.toLocaleLowerCase("tr-TR").replace(/\s+/g, "-")}`,
    name,
  }));
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function parseDisplayDateToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  const day = Number(dd);
  const month = Number(mm);
  const year = Number(yyyy);
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date.toISOString();
}

function normalizeIngredientTyping(prev: string, next: string): string {
  if (
    next.length > prev.length &&
    next.endsWith(" ") &&
    !next.endsWith(", ")
  ) {
    const trimmed = next.trimEnd();
    if (!trimmed) return "";
    if (trimmed.endsWith(",")) return `${trimmed} `;
    return `${trimmed}, `;
  }
  return next;
}

function parseLocalizedDecimal(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return Number.NaN;
  const noCurrency = trimmed.replace(/[₺\s]/g, "");
  const normalizedComma = noCurrency.replace(/,/g, ".");
  const safe = normalizedComma.replace(/[^0-9.]/g, "");
  if (!safe) return Number.NaN;
  const parts = safe.split(".");
  const normalized =
    parts.length <= 1 ? safe : `${parts.shift()}.${parts.join("")}`;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export default function SellerFoodsScreen({ auth, onBack, initialEditFoodId, onAuthRefresh }: Props) {
  const PLACEHOLDER_COLOR = "#8A7A6A";
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [categoryModalVisible, setCategoryModalVisible] = useState(false);
  const [foods, setFoods] = useState<SellerFood[]>([]);
  const [categories, setCategories] = useState<FoodCategoryOption[]>([]);
  const [editingFood, setEditingFood] = useState<SellerFood | null>(null);

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [cardSummary, setCardSummary] = useState("");
  const [description, setDescription] = useState("");
  const [recipe, setRecipe] = useState("");
  const [ingredients, setIngredients] = useState("");
  const [allergens, setAllergens] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>(["", "", "", "", ""]);
  const [movingImageIndex, setMovingImageIndex] = useState<number | null>(null);
  const longPressConsumedIndexRef = useRef<number | null>(null);
  const imagePickerOpeningRef = useRef(false);
  const [prepTime, setPrepTime] = useState("");

  // UI parity fields (opsiyonlar)
  const [cuisine, setCuisine] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [dailyStock, setDailyStock] = useState("10");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [datePickerVisible, setDatePickerVisible] = useState<null | "start" | "end">(null);
  const [pickerMonth, setPickerMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [pickupEnabled, setPickupEnabled] = useState(true);
  const [deliveryEnabled, setDeliveryEnabled] = useState(true);
  const [deliveryFee, setDeliveryFee] = useState("");
  const [deliveryDistanceKm, setDeliveryDistanceKm] = useState("");
  const [menuItems, setMenuItems] = useState<SellerMenuAddon[]>([]);
  const [freeAddonNameInput, setFreeAddonNameInput] = useState("");
  const [freeAddonKindInput, setFreeAddonKindInput] = useState<AddonKind>("extra");
  const [paidAddonNameInput, setPaidAddonNameInput] = useState("");
  const [paidAddonKindInput, setPaidAddonKindInput] = useState<AddonKind>("extra");
  const [paidAddonPriceInput, setPaidAddonPriceInput] = useState("");
  const [addonLibraryVisible, setAddonLibraryVisible] = useState(false);
  const [addonLibraryKind, setAddonLibraryKind] = useState<AddonKind>("extra");
  const [addonLibraryPricing, setAddonLibraryPricing] = useState<AddonPricing>("free");
  const [pendingInitialEditId, setPendingInitialEditId] = useState<string | null>(initialEditFoodId ?? null);

  useEffect(() => setCurrentAuth(auth), [auth]);
  useEffect(() => {
    setPendingInitialEditId(initialEditFoodId ?? null);
  }, [initialEditFoodId]);

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
      void loadCategories(baseUrl);
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Yemekler yüklenemedi");
    } finally {
      setLoading(false);
    }
  }

  async function loadCategories(baseUrl = apiUrl) {
    try {
      setLoadingCategories(true);
      const res = await authedFetch("/v1/seller/categories", undefined, baseUrl);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Kategoriler yüklenemedi");
      const items: unknown[] = Array.isArray(json?.data) ? json.data : [];
      const mapped =
        items
          .map((item) => {
            const row = item as { id?: unknown; nameTr?: unknown; name?: unknown };
            const id = typeof row.id === "string" ? row.id : "";
            const nameTr = typeof row.nameTr === "string" ? row.nameTr.trim() : "";
            const fallbackName = typeof row.name === "string" ? row.name.trim() : "";
            return {
              id,
              name: nameTr || fallbackName,
            };
          })
          .filter((item) => item.id && item.name);

      setCategories(mapped.length > 0 ? mapped : fallbackHomeCategoryOptions());
    } catch (e) {
      console.warn("[seller-foods] categories load failed:", e);
      setCategories(fallbackHomeCategoryOptions());
    } finally {
      setLoadingCategories(false);
    }
  }

  useEffect(() => {
    void loadFoods();
  }, []);

  useEffect(() => {
    if (!pendingInitialEditId) return;
    const target = foods.find((item) => String((item as { id?: unknown }).id ?? "") === pendingInitialEditId);
    if (!target) return;
    openEdit(target);
    setPendingInitialEditId(null);
  }, [pendingInitialEditId, foods]);

  function resetForm() {
    setEditingFood(null);
    setName("");
    setPrice("");
    setCardSummary("");
    setDescription("");
    setRecipe("");
    setIngredients("");
    setAllergens("");
    setImageUrls(["", "", "", "", ""]);
    setMovingImageIndex(null);
    setPrepTime("");
    setCuisine("");
    setCategoryId("");
    setDailyStock("10");
    setStartDate("");
    setEndDate("");
    setPickupEnabled(true);
    setDeliveryEnabled(true);
    setDeliveryFee("");
    setDeliveryDistanceKm("");
    setMenuItems([]);
    setFreeAddonNameInput("");
    setFreeAddonKindInput("extra");
    setPaidAddonNameInput("");
    setPaidAddonKindInput("extra");
    setPaidAddonPriceInput("");
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
    const seededImageUrls = (food.imageUrls?.length ? food.imageUrls : [food.imageUrl ?? ""]).slice(0, 5);
    while (seededImageUrls.length < 5) seededImageUrls.push("");
    setImageUrls(seededImageUrls);
    setMovingImageIndex(null);
    setPrepTime(food.preparationTimeMinutes ? String(food.preparationTimeMinutes) : "");
    setCuisine(food.cuisine ?? "");
    setCategoryId(food.categoryId ?? "");
    setDeliveryFee(food.deliveryFee ? String(food.deliveryFee) : "");
    setPickupEnabled(food.deliveryOptions?.pickup ?? true);
    setDeliveryEnabled(food.deliveryOptions?.delivery ?? true);
    setDeliveryDistanceKm("");
    const normalizedMenuItems = Array.isArray(food.menuItems)
      ? food.menuItems
        .map((item) => ({
          name: String(item?.name ?? "").trim(),
          kind: (item?.kind === "sauce" || item?.kind === "appetizer" ? item.kind : "extra") as AddonKind,
          pricing: (item?.pricing === "paid" ? "paid" : "free") as AddonPricing,
          price: typeof item?.price === "number" && Number.isFinite(item.price) ? Number(item.price) : undefined,
        }))
        .filter((item) => item.name)
        .map((item) => (
          item.pricing === "paid" && Number.isFinite(item.price)
            ? { ...item, price: Number(item.price) }
            : { name: item.name, kind: item.kind, pricing: "free" as const }
        ))
      : [];
    setMenuItems(
      normalizedMenuItems.length > 0
        ? normalizedMenuItems
        : [{ name: food.name, kind: "extra", pricing: "free" }],
    );
    setFreeAddonNameInput("");
    setFreeAddonKindInput("extra");
    setPaidAddonNameInput("");
    setPaidAddonKindInput("extra");
    setPaidAddonPriceInput("");
  }

  const canShowDeliveryFee = deliveryEnabled;

  function setImageAt(index: number, value: string) {
    setImageUrls((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  function moveImage(from: number, to: number) {
    if (from === to) {
      setMovingImageIndex(null);
      return;
    }
    setImageUrls((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setMovingImageIndex(null);
  }

  async function pickImageFromAlbum(index: number) {
    if (imagePickerOpeningRef.current) return;
    try {
      imagePickerOpeningRef.current = true;
      let permission = await ImagePicker.getMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      }
      if (!permission.granted) {
        Alert.alert("İzin Gerekli", "Albümden fotoğraf seçmek için galeri izni vermelisin.");
        return;
      }

      setMovingImageIndex(null);
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
    } finally {
      imagePickerOpeningRef.current = false;
    }
  }

  async function saveFood(options?: { publishAfterSave?: boolean }) {
    try {
      if (!pickupEnabled && !deliveryEnabled) {
        Alert.alert("Hata", "En az bir teslimat seçeneği seçmelisin (Gel Al veya Teslimat).");
        return;
      }

      const parsedPrice = parseLocalizedDecimal(price);
      if (!name.trim() || !Number.isFinite(parsedPrice) || parsedPrice <= 0) {
        Alert.alert("Hata", "Yemek adı ve fiyat zorunlu.");
        return;
      }
      if (menuItems.length < 1) {
        Alert.alert("Hata", "Ekler bölümünde en az 1 kalem olmalı.");
        return;
      }
      if (options?.publishAfterSave && !recipe.trim()) {
        Alert.alert("Hata", "Yemeği yayınlamak için tarif alanını doldurmalısın.");
        return;
      }

      setSaving(true);

      const primaryImageUrl = imageUrls.map((x) => x.trim()).find(Boolean) || undefined;
      const parsedDeliveryFee = deliveryFee.trim() ? parseLocalizedDecimal(deliveryFee) : 0;
      const parsedDeliveryDistance = deliveryDistanceKm.trim() ? parseLocalizedDecimal(deliveryDistanceKm) : Number.NaN;
      const ingredientItemsFromDescription = description
        .split(/[,;\n]/g)
        .map((x) => x.trim())
        .filter(Boolean);
      const ingredientItemsFromInput = ingredients
        .split(/[,;\n]/g)
        .map((x) => x.trim())
        .filter(Boolean);
      const normalizedIngredients = ingredientItemsFromInput.length > 0
        ? ingredientItemsFromInput
        : ingredientItemsFromDescription;
      const normalizedAddons = menuItems.map((item) => ({
        name: item.name.trim(),
        kind: item.kind,
        pricing: item.pricing,
        ...(item.pricing === "paid" && Number.isFinite(item.price) ? { price: Number(item.price) } : {}),
      }));
      const invalidPaidAddon = normalizedAddons.find(
        (item) => item.pricing === "paid" && (!("price" in item) || Number(item.price) <= 0),
      );
      if (invalidPaidAddon) {
        Alert.alert("Hata", "Ücretli eklerde fiyat 0'dan büyük olmalı.");
        return;
      }
      const payload: Record<string, unknown> = {
        name: name.trim(),
        price: parsedPrice,
        cardSummary: cardSummary.trim() || undefined,
        description: description.trim() || undefined,
        recipe: recipe.trim() || undefined,
        imageUrl: primaryImageUrl,
        imageUrls: imageUrls.map((x) => x.trim()).filter(Boolean).slice(0, 5),
        cuisine: cuisine.trim() || undefined,
        deliveryFee: Number.isFinite(parsedDeliveryFee) ? parsedDeliveryFee : 0,
        deliveryOptions: { pickup: pickupEnabled, delivery: deliveryEnabled },
        ingredients: normalizedIngredients,
        allergens: allergens.split(",").map((x) => x.trim()).filter(Boolean),
        preparationTimeMinutes: prepTime.trim() ? Number(prepTime) : undefined,
        deliveryDistanceKm: Number.isFinite(parsedDeliveryDistance) ? parsedDeliveryDistance : undefined,
        menuItems: normalizedAddons,
        secondaryCategoryIds: [],
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

      if (options?.publishAfterSave && foodId) {
        const startIso = parseDisplayDateToIso(startDate);
        const endIso = parseDisplayDateToIso(endDate);
        const nowTs = Date.now();
        let saleStartsAt = startIso ?? new Date(nowTs).toISOString();
        let saleEndsAt = endIso;
        let hadInvalidDateWindow = false;
        if (!saleEndsAt) {
          const fallback = new Date(saleStartsAt);
          fallback.setUTCDate(fallback.getUTCDate() + 30);
          saleEndsAt = fallback.toISOString();
        }
        if (new Date(saleEndsAt).getTime() <= nowTs) {
          hadInvalidDateWindow = true;
          // Prevent creating immediately expired lots; keep publish visible on home feed.
          if (new Date(saleStartsAt).getTime() < nowTs) {
            saleStartsAt = new Date(nowTs).toISOString();
          }
          const fallback = new Date(saleStartsAt);
          fallback.setUTCDate(fallback.getUTCDate() + 30);
          saleEndsAt = fallback.toISOString();
        }
        if (new Date(saleEndsAt).getTime() <= new Date(saleStartsAt).getTime()) {
          hadInvalidDateWindow = true;
          const fallback = new Date(saleStartsAt);
          fallback.setUTCDate(fallback.getUTCDate() + 1);
          saleEndsAt = fallback.toISOString();
        }
        if (hadInvalidDateWindow) {
          Alert.alert(
            "Yanlış tarihtesin",
            "Geçmiş veya hatalı tarih girdin. Sistem satış tarihini otomatik düzeltti.",
          );
        }

        const producedAt = saleStartsAt;
        const quantityProduced = Math.max(1, Number.parseInt(dailyStock.trim() || "0", 10) || 1);

        const lotRes = await authedFetch("/v1/seller/lots", {
          method: "POST",
          body: JSON.stringify({
            foodId,
            producedAt,
            saleStartsAt,
            saleEndsAt,
            quantityProduced,
            quantityAvailable: quantityProduced,
            notes: "mobile_publish",
          }),
        });
        const lotJson = await lotRes.json();
        if (!lotRes.ok) {
          throw new Error(lotJson?.error?.message ?? "Lot oluşturulamadı");
        }

        const statusRes = await authedFetch(`/v1/seller/foods/${foodId}/status`, {
          method: "PATCH",
          body: JSON.stringify({ isActive: true }),
        });
        if (!statusRes.ok) {
          const statusJson = await statusRes.json();
          throw new Error(statusJson?.error?.message ?? "Yemek durumu güncellenemedi");
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

  function addAddon(pricing: AddonPricing) {
    const rawName = (pricing === "free" ? freeAddonNameInput : paidAddonNameInput).trim().replace(/\s+/g, " ");
    if (!rawName) {
      Alert.alert("Hata", "Ek adı zorunlu.");
      return;
    }
    const kind = pricing === "free" ? freeAddonKindInput : paidAddonKindInput;
    const normalizedKey = `${rawName.toLocaleLowerCase("tr-TR")}|${kind}|${pricing}`;
    if (
      menuItems.some(
        (item) => `${item.name.trim().toLocaleLowerCase("tr-TR")}|${item.kind}|${item.pricing}` === normalizedKey,
      )
    ) {
      Alert.alert("Hata", "Aynı ek tekrar eklenemez.");
      return;
    }
    const next: SellerMenuAddon = {
      name: rawName,
      kind,
      pricing,
    };
    if (pricing === "paid") {
      const parsed = parseLocalizedDecimal(paidAddonPriceInput);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        Alert.alert("Hata", "Ücretli ek için fiyat zorunlu.");
        return;
      }
      next.price = Number(parsed.toFixed(2));
    }
    setMenuItems((prev) => [...prev, next]);
    if (pricing === "free") {
      setFreeAddonNameInput("");
    } else {
      setPaidAddonNameInput("");
      setPaidAddonPriceInput("");
    }
  }

  function removeMenuItem(index: number) {
    setMenuItems((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  }

function openAddonLibrary(pricing: AddonPricing, kind: AddonKind) {
    if (pricing === "free") setFreeAddonKindInput("extra");
    else setPaidAddonKindInput(kind);
    setAddonLibraryPricing(pricing);
    setAddonLibraryKind(pricing === "free" ? "extra" : kind);
    setAddonLibraryVisible(true);
  }

  function addAddonFromLibrary(item: SellerMenuAddon) {
    const normalizedKey = `${item.name.toLocaleLowerCase("tr-TR")}|${item.kind}|${item.pricing}|${Number(item.price ?? 0)}`;
    const exists = menuItems.some(
      (entry) => `${entry.name.toLocaleLowerCase("tr-TR")}|${entry.kind}|${entry.pricing}|${Number(entry.price ?? 0)}` === normalizedKey,
    );
    if (exists) {
      Alert.alert("Bilgi", "Bu ek zaten seçili.");
      return;
    }
    setMenuItems((prev) => [...prev, item]);
    setAddonLibraryVisible(false);
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

  function toDisplayDate(date: Date): string {
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yyyy = String(date.getFullYear());
    return `${dd}/${mm}/${yyyy}`;
  }

  const pickerMonthLabel = useMemo(() => {
    const months = [
      "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
      "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
    ];
    return `${months[pickerMonth.getMonth()]} ${pickerMonth.getFullYear()}`;
  }, [pickerMonth]);

  const pickerDays = useMemo(() => {
    const year = pickerMonth.getFullYear();
    const month = pickerMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const mondayBasedOffset = (firstDay.getDay() + 6) % 7;
    const cells: Array<{ key: string; value?: number }> = [];
    for (let i = 0; i < mondayBasedOffset; i += 1) {
      cells.push({ key: `empty-${i}` });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push({ key: `day-${day}`, value: day });
    }
    return cells;
  }, [pickerMonth]);

  function openDatePicker(target: "start" | "end") {
    setDatePickerVisible(target);
  }

  function selectDate(day: number) {
    const selected = new Date(pickerMonth.getFullYear(), pickerMonth.getMonth(), day);
    const value = toDisplayDate(selected);
    if (datePickerVisible === "start") setStartDate(value);
    if (datePickerVisible === "end") setEndDate(value);
    setDatePickerVisible(null);
  }

  const previewImage = imageUrls.map((x) => x.trim()).find(Boolean) || "";
  const selectedCategoryName = categories.find((item) => item.id === categoryId)?.name ?? "";
  const previewTitle = name.trim() || "Yemek Adı";
  const previewStockLine = (() => {
    const stock = Number.parseInt(dailyStock.trim() || "0", 10);
    if (Number.isFinite(stock) && stock > 0) return `${stock} porsiyon kaldı`;
    return "Stok girilmedi";
  })();
  const parsedPreviewPrice = parseLocalizedDecimal(price);
  const previewPrice = Number.isFinite(parsedPreviewPrice) && parsedPreviewPrice > 0 ? `${parsedPreviewPrice.toFixed(2)} ₺` : "-- ₺";
  const previewSellerHandle = useMemo(() => {
    const emailLocal = String(currentAuth.email ?? "").split("@")[0]?.trim();
    const normalized = (emailLocal || "ev.usta")
      .toLocaleLowerCase("tr-TR")
      .replace(/\s+/g, ".")
      .replace(/[^a-z0-9._]/g, "");
    return normalized.startsWith("@") ? normalized : `@${normalized}`;
  }, [currentAuth.email]);
  const previewCuisine = cuisine.trim()
    ? (/(mutfağı|mutfagi)$/i.test(cuisine.trim()) ? cuisine.trim() : `${cuisine.trim()} Mutfağı`)
    : "Ev Mutfağı";
  const previewMeta = prepTime.trim() ? `${prepTime.trim()} dk` : "40 dk";
  const previewDistance = deliveryEnabled
    ? `${deliveryDistanceKm.trim() || "14.76"} km`
    : "Gel Al";
  const previewAllergens = allergens
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(", ");
  const freeMenuItems = menuItems.filter((item) => item.pricing === "free");
  const paidMenuItems = menuItems.filter((item) => item.pricing === "paid");
  const addonLibraryItems = useMemo(() => {
    const merged: SellerMenuAddon[] = [];
    const pushItem = (raw: SellerMenuAddon) => {
      const key = `${raw.name.toLocaleLowerCase("tr-TR")}|${raw.kind}|${raw.pricing}|${Number(raw.price ?? 0)}`;
      const exists = merged.some(
        (item) => `${item.name.toLocaleLowerCase("tr-TR")}|${item.kind}|${item.pricing}|${Number(item.price ?? 0)}` === key,
      );
      if (!exists) merged.push(raw);
    };
    for (const food of foods) {
      for (const raw of food.menuItems ?? []) {
        const name = String(raw?.name ?? "").trim();
        if (!name) continue;
        const kind: AddonKind = raw?.kind === "sauce" || raw?.kind === "appetizer" ? raw.kind : "extra";
        const pricing: AddonPricing = raw?.pricing === "paid" ? "paid" : "free";
        const price = Number(raw?.price);
        if (pricing === "paid") {
          if (!Number.isFinite(price) || price <= 0) continue;
          pushItem({ name, kind, pricing, price: Number(price.toFixed(2)) });
        } else {
          pushItem({ name, kind, pricing: "free" });
        }
      }
    }
    return merged
      .filter((item) => item.pricing === addonLibraryPricing && (addonLibraryPricing === "free" || item.kind === addonLibraryKind))
      .sort((a, b) => a.name.localeCompare(b.name, "tr"));
  }, [foods, addonLibraryKind, addonLibraryPricing]);
  const screenTitle = editingFood ? "Yemek Düzenle" : "Yemek Ekle";

  return (
    <View style={styles.container}>
      <ScreenHeader title={screenTitle} onBack={onBack} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="always">
          <Text style={styles.sectionTitle}>Yemek Fotoğrafları</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoStrip}>
            {imageUrls.map((url, index) => (
              <View key={`photo-${index}`} style={styles.photoTileWrap}>
                <TouchableOpacity
                  style={[
                    styles.photoPreviewBtn,
                    movingImageIndex === index && styles.photoPreviewBtnMoving,
                  ]}
                  onLongPress={() => {
                    if (!url.trim()) return;
                    // Prevent the trailing onPress from cancelling move mode on the same tile.
                    longPressConsumedIndexRef.current = index;
                    setMovingImageIndex(index);
                  }}
                  delayLongPress={600}
                  onPress={() => {
                    if (longPressConsumedIndexRef.current === index) {
                      longPressConsumedIndexRef.current = null;
                      return;
                    }
                    if (movingImageIndex !== null) {
                      const targetHasImage = Boolean(imageUrls[index]?.trim());
                      if (movingImageIndex !== index && targetHasImage) {
                        moveImage(movingImageIndex, index);
                        return;
                      }
                      setMovingImageIndex(null);
                    }
                    void pickImageFromAlbum(index);
                  }}
                >
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
              </View>
            ))}
          </ScrollView>
          <Text style={styles.subHint}>{`Seçilen fotoğraf: ${imageUrls.filter((x) => x.trim()).length}/5`}</Text>
          <Text style={styles.subHint}>
            {movingImageIndex === null
              ? "Sıralamayı değiştirmek için resme uzun bas."
              : "Şimdi hedef kutuya dokun, sırası değişsin."}
          </Text>

          <Text style={styles.sectionTitle}>Hangi Ülke/Şehir Mutfağı *</Text>
          <TextInput
            style={styles.input}
            value={cuisine}
            onChangeText={setCuisine}
            placeholder="Örn: Türkiye, Hatay, Japonya, İtalya..."
            placeholderTextColor={PLACEHOLDER_COLOR}
          />

          <Text style={styles.sectionTitle}>Kategori Seç</Text>
          <TouchableOpacity
            style={[styles.input, styles.dropdownInput]}
            onPress={() => {
              if (!loadingCategories && categories.length === 0) {
                void loadCategories();
              }
              setCategoryModalVisible(true);
            }}
            activeOpacity={0.85}
          >
            <Text style={selectedCategoryName ? styles.dropdownValue : styles.dropdownPlaceholder}>
              {selectedCategoryName || "Kategori seçin"}
            </Text>
            <Ionicons name="chevron-down-outline" size={18} color="#7A6B5D" />
          </TouchableOpacity>

          <Text style={styles.sectionTitle}>Yemek Adı *</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Örn: Ev Yapımı Mantı"
            placeholderTextColor={PLACEHOLDER_COLOR}
          />

          <Text style={styles.sectionTitle}>Malzemeler / Baharatlar *</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={description}
            onChangeText={(value) => setDescription((prev) => normalizeIngredientTyping(prev, value))}
            placeholder="Kullanılan malzemeler ve baharatları açıklayın..."
            placeholderTextColor={PLACEHOLDER_COLOR}
            multiline
          />

          <Text style={styles.sectionTitle}>Ücretsiz Ekler *</Text>
          <TouchableOpacity style={styles.addMenuItemBtn} onPress={() => openAddonLibrary("free", "extra")} activeOpacity={0.85}>
            <Text style={styles.addMenuItemBtnText}>+ Hazır ücretsiz eklerden seç</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            value={freeAddonNameInput}
            onChangeText={setFreeAddonNameInput}
            placeholder="Örn: Acı sos"
            placeholderTextColor={PLACEHOLDER_COLOR}
          />
          <TouchableOpacity style={styles.addMenuItemBtn} onPress={() => addAddon("free")} activeOpacity={0.85}>
            <Text style={styles.addMenuItemBtnText}>+ Ücretsiz ek ekle</Text>
          </TouchableOpacity>
          <View style={styles.menuItemsWrap}>
            {freeMenuItems.map((item, index) => {
              const absoluteIndex = menuItems.findIndex(
                (entry) => entry.name === item.name && entry.kind === item.kind && entry.pricing === item.pricing,
              );
              return (
                <View key={`free-${item.name}-${index}`} style={styles.menuItemChip}>
                  <Text style={styles.menuItemChipText}>{item.name}</Text>
                  <TouchableOpacity onPress={() => removeMenuItem(absoluteIndex)} hitSlop={8}>
                    <Ionicons name="close" size={16} color="#2F241C" />
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>

          <Text style={styles.sectionTitle}>Ücretli Ekler</Text>
          <View style={styles.kindRow}>
            {ADDON_KIND_OPTIONS.map((option) => (
              <TouchableOpacity
                key={`paid-kind-${option.value}`}
                style={[styles.kindChip, paidAddonKindInput === option.value && styles.kindChipActive]}
                onPress={() => openAddonLibrary("paid", option.value)}
                activeOpacity={0.85}
              >
                <Text style={[styles.kindChipText, paidAddonKindInput === option.value && styles.kindChipTextActive]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.row2}>
            <TextInput
              style={[styles.input, styles.rowItem]}
              value={paidAddonNameInput}
              onChangeText={setPaidAddonNameInput}
              placeholder="Örn: Özel sos"
              placeholderTextColor={PLACEHOLDER_COLOR}
            />
            <TextInput
              style={[styles.input, styles.rowItem]}
              value={paidAddonPriceInput}
              onChangeText={setPaidAddonPriceInput}
              placeholder="Ücret (₺)"
              placeholderTextColor={PLACEHOLDER_COLOR}
              keyboardType="decimal-pad"
            />
          </View>
          <TouchableOpacity style={styles.addMenuItemBtn} onPress={() => addAddon("paid")} activeOpacity={0.85}>
            <Text style={styles.addMenuItemBtnText}>+ Ücretli ek ekle</Text>
          </TouchableOpacity>
          <View style={styles.menuItemsWrap}>
            {paidMenuItems.map((item, index) => {
              const absoluteIndex = menuItems.findIndex(
                (entry) => entry.name === item.name && entry.kind === item.kind && entry.pricing === item.pricing && entry.price === item.price,
              );
              return (
                <View key={`paid-${item.name}-${index}`} style={styles.menuItemChip}>
                  <Text style={styles.menuItemChipText}>
                    {item.name} · {ADDON_KIND_OPTIONS.find((x) => x.value === item.kind)?.label} · {Number(item.price ?? 0).toFixed(2)} ₺
                  </Text>
                  <TouchableOpacity onPress={() => removeMenuItem(absoluteIndex)} hitSlop={8}>
                    <Ionicons name="close" size={16} color="#2F241C" />
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>

          <Text style={styles.sectionTitle}>Tarif</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={recipe}
            onChangeText={setRecipe}
            placeholder="Yemeğin hazırlanış tarifini buraya yazın..."
            placeholderTextColor={PLACEHOLDER_COLOR}
            multiline
          />

          <Text style={styles.sectionTitle}>Alerjenler</Text>
          <TextInput
            style={styles.input}
            value={allergens}
            onChangeText={setAllergens}
            placeholder="Örn: Gluten, süt"
            placeholderTextColor={PLACEHOLDER_COLOR}
          />

          <Text style={styles.sectionTitle}>Fiyat (₺) *</Text>
          <TextInput
            style={styles.input}
            value={price}
            onChangeText={setPrice}
            placeholder="25"
            placeholderTextColor={PLACEHOLDER_COLOR}
            keyboardType="decimal-pad"
          />

          <Text style={styles.sectionTitle}>Günlük Stok *</Text>
          <TextInput
            style={styles.input}
            value={dailyStock}
            onChangeText={setDailyStock}
            placeholder="10"
            placeholderTextColor={PLACEHOLDER_COLOR}
            keyboardType="number-pad"
          />

          <Text style={styles.sectionTitle}>Hazırlık Süresi (dk)</Text>
          <TextInput
            style={styles.input}
            value={prepTime}
            onChangeText={setPrepTime}
            placeholder="Örn: 45"
            placeholderTextColor={PLACEHOLDER_COLOR}
            keyboardType="number-pad"
          />

          <Text style={styles.sectionTitle}>Teslimat Mesafesi (km)</Text>
          <TextInput
            style={styles.input}
            value={deliveryDistanceKm}
            onChangeText={setDeliveryDistanceKm}
            placeholder="Örn: 8 (kaç km uzağa götüreceğini yaz)"
            placeholderTextColor={PLACEHOLDER_COLOR}
            keyboardType="decimal-pad"
          />

          <View style={styles.row2}>
            <View style={styles.rowItem}>
              <Text style={styles.sectionTitle}>Başlangıç Tarihi</Text>
              <View style={styles.dateInputWrap}>
                <TextInput
                  style={[styles.input, styles.dateInput]}
                  value={startDate}
                  placeholder="DD/MM/YYYY"
                  placeholderTextColor={PLACEHOLDER_COLOR}
                  editable={false}
                />
                <TouchableOpacity style={styles.dateIconBtn} onPress={() => openDatePicker("start")}>
                  <Ionicons name="calendar-outline" size={18} color="#7A6B5D" />
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.rowItem}>
              <Text style={styles.sectionTitle}>Bitiş Tarihi</Text>
              <View style={styles.dateInputWrap}>
                <TextInput
                  style={[styles.input, styles.dateInput]}
                  value={endDate}
                  placeholder="DD/MM/YYYY"
                  placeholderTextColor={PLACEHOLDER_COLOR}
                  editable={false}
                />
                <TouchableOpacity style={styles.dateIconBtn} onPress={() => openDatePicker("end")}>
                  <Ionicons name="calendar-outline" size={18} color="#7A6B5D" />
                </TouchableOpacity>
              </View>
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
                placeholder="Örn: 10 ₺"
                placeholderTextColor={PLACEHOLDER_COLOR}
                keyboardType="decimal-pad"
              />
              <Text style={styles.subHint}>Müşterilerden alacağınız teslimat ücreti</Text>
            </>
          ) : null}

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
              <TouchableOpacity style={styles.previewLikeBtn} activeOpacity={0.9}>
                <Ionicons name="heart-outline" size={16} color="#2E241C" />
              </TouchableOpacity>
              <View style={styles.previewPriceChip}>
                <Text style={styles.previewPriceChipText}>{previewPrice}</Text>
              </View>
              <View style={styles.previewRatingChip}>
                <Text style={styles.previewRatingChipText}>⭐ 5.0</Text>
              </View>
              <View style={styles.previewBody}>
                <View style={styles.previewTopRow}>
                  <View style={styles.previewTopRowLeft}>
                    <Text style={styles.previewFoodTitle} numberOfLines={1}>{previewTitle}</Text>
                    <Text style={styles.previewFoodSummary} numberOfLines={1}>{previewStockLine}</Text>
                  </View>
                  <View style={styles.previewTopRowRight}>
                    <Text style={styles.previewSeller}>{previewSellerHandle} ›</Text>
                    <Text style={styles.previewCuisine}>{previewCuisine}</Text>
                  </View>
                </View>
                <View style={styles.previewMidRow}>
                  <Ionicons name="time-outline" size={13} color="#8A7A6A" />
                  <Text style={styles.previewMetaText}>{`${previewMeta} · ${previewDistance}`}</Text>
                </View>
                <View style={styles.previewFooter}>
                  <Text style={styles.previewFooterPlaceholder} />
                  {previewAllergens ? <Text style={styles.previewAllergen}>{`Alerjen: ${previewAllergens}`}</Text> : null}
                </View>
              </View>
            </View>
            <TouchableOpacity style={styles.previewCloseBtn} onPress={() => setPreviewVisible(false)}>
              <Text style={styles.previewCloseBtnText}>Düzenlemeye Devam Et</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(datePickerVisible)} transparent animationType="fade" onRequestClose={() => setDatePickerVisible(null)}>
        <View style={styles.previewOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={() => setDatePickerVisible(null)} />
          <View style={styles.datePickerCard}>
            <View style={styles.datePickerHead}>
              <TouchableOpacity onPress={() => setPickerMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}>
                <Ionicons name="chevron-back" size={20} color="#2E241C" />
              </TouchableOpacity>
              <Text style={styles.datePickerTitle}>{pickerMonthLabel}</Text>
              <TouchableOpacity onPress={() => setPickerMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}>
                <Ionicons name="chevron-forward" size={20} color="#2E241C" />
              </TouchableOpacity>
            </View>
            <View style={styles.dateWeekRow}>
              {["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"].map((label) => (
                <Text key={label} style={styles.dateWeekLabel}>{label}</Text>
              ))}
            </View>
            <View style={styles.dateGrid}>
              {pickerDays.map((cell) => (
                <TouchableOpacity
                  key={cell.key}
                  style={[styles.dateCell, !cell.value && styles.dateCellEmpty]}
                  disabled={!cell.value}
                  onPress={() => cell.value && selectDate(cell.value)}
                >
                  <Text style={[styles.dateCellText, !cell.value && styles.dateCellTextEmpty]}>
                    {cell.value ?? ""}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={addonLibraryVisible} transparent animationType="fade" onRequestClose={() => setAddonLibraryVisible(false)}>
        <View style={styles.previewOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={() => setAddonLibraryVisible(false)} />
          <View style={styles.categoryModalCard}>
            <Text style={styles.categoryModalTitle}>
              {addonLibraryPricing === "free"
                ? "Ücretsiz Ekler"
                : `Ücretli ${ADDON_KIND_OPTIONS.find((item) => item.value === addonLibraryKind)?.label ?? "Ekler"}`}
            </Text>
            {addonLibraryItems.length === 0 ? (
              <View style={styles.categoryEmptyWrap}>
                <Text style={styles.categoryEmptyText}>Bu grupta kayıtlı ek yok.</Text>
                <TouchableOpacity
                  style={styles.categoryRetryBtn}
                  onPress={() => {
                    setAddonLibraryVisible(false);
                    if (addonLibraryPricing === "free") {
                      setFreeAddonKindInput(addonLibraryKind);
                    } else {
                      setPaidAddonKindInput(addonLibraryKind);
                    }
                  }}
                >
                  <Text style={styles.categoryRetryBtnText}>Yeni ek ekle</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView style={styles.categoryList} contentContainerStyle={styles.categoryListContent}>
                {addonLibraryItems.map((item, index) => (
                  <TouchableOpacity
                    key={`${item.name}-${index}`}
                    style={styles.categoryOption}
                    onPress={() => addAddonFromLibrary(item)}
                  >
                    <Text style={styles.categoryOptionText}>
                      {item.name}
                      {item.pricing === "paid" ? ` · ${Number(item.price ?? 0).toFixed(2)} ₺` : ""}
                    </Text>
                    <Ionicons name="add-circle-outline" size={18} color="#2E6B44" />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={categoryModalVisible} transparent animationType="fade" onRequestClose={() => setCategoryModalVisible(false)}>
        <View style={styles.previewOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={() => setCategoryModalVisible(false)} />
          <View style={styles.categoryModalCard}>
            <Text style={styles.categoryModalTitle}>Kategori Seç</Text>
            {loadingCategories ? (
              <ActivityIndicator size="small" color={theme.primary} style={{ marginVertical: 12 }} />
            ) : categories.length === 0 ? (
              <View style={styles.categoryEmptyWrap}>
                <Text style={styles.categoryEmptyText}>Kategori bulunamadı. Yeniden dene.</Text>
                <TouchableOpacity
                  style={styles.categoryRetryBtn}
                  onPress={() => void loadCategories()}
                >
                  <Text style={styles.categoryRetryBtnText}>Yenile</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView style={styles.categoryList} contentContainerStyle={styles.categoryListContent}>
                {categories.map((item) => {
                  const selectedCategoryForTarget = categoryId;
                  const isSelected = selectedCategoryForTarget === item.id;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[styles.categoryOption, isSelected && styles.categoryOptionActive]}
                      onPress={() => {
                        setCategoryId(item.id);
                        setCategoryModalVisible(false);
                      }}
                    >
                      <Text style={[styles.categoryOptionText, isSelected && styles.categoryOptionTextActive]}>
                        {item.name}
                      </Text>
                      {isSelected ? <Ionicons name="checkmark-circle" size={18} color="#2E6B44" /> : null}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
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
  dropdownInput: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dropdownPlaceholder: { color: "#8A7A6A" },
  dropdownValue: { color: "#2E241C", fontWeight: "600" },
  kindRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  kindChip: {
    borderWidth: 1,
    borderColor: "#DCD2C2",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: "#fff",
  },
  kindChipActive: {
    borderColor: "#3F855C",
    backgroundColor: "#EAF4EC",
  },
  kindChipText: { color: "#5C4D3F", fontSize: 12, fontWeight: "700" },
  kindChipTextActive: { color: "#2E6B44" },
  addMenuItemBtn: {
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#D6CCBD",
    backgroundColor: "#F7EFE2",
    alignItems: "center",
    paddingVertical: 10,
  },
  addMenuItemBtnText: { color: "#3F855C", fontWeight: "800" },
  menuItemsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  menuItemChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "#E5DDCF",
    borderRadius: 999,
    backgroundColor: "#fff",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  menuItemChipText: { color: "#2F241C", fontSize: 12, fontWeight: "600" },
  textArea: {
    minHeight: 120,
    textAlignVertical: "top",
    paddingTop: 10,
  },
  row2: { flexDirection: "row", gap: 10 },
  rowItem: { flex: 1 },
  dateInputWrap: { position: "relative" },
  dateInput: { paddingRight: 38 },
  dateIconBtn: {
    position: "absolute",
    right: 10,
    top: 10,
  },
  photoStrip: { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 2 },
  photoTileWrap: { alignItems: "center", gap: 6 },
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
  photoPreviewBtnMoving: {
    borderColor: "#3F855C",
    borderWidth: 2,
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
    position: "relative",
  },
  previewImage: { width: "100%", height: 170, backgroundColor: "#EDE5D8" },
  previewImagePlaceholder: {
    width: "100%",
    height: 170,
    backgroundColor: "#EFE7DA",
    alignItems: "center",
    justifyContent: "center",
  },
  previewLikeBtn: {
    position: "absolute",
    left: 10,
    top: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  previewPriceChip: {
    position: "absolute",
    right: 10,
    top: 10,
    borderRadius: 999,
    backgroundColor: "rgba(35,28,22,0.82)",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  previewPriceChipText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  previewRatingChip: {
    position: "absolute",
    right: 10,
    top: 42,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.92)",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  previewRatingChipText: { color: "#4A3D31", fontSize: 12, fontWeight: "800" },
  previewImagePlaceholderText: { color: "#77695B", fontWeight: "600" },
  previewBody: { padding: 12 },
  previewTopRow: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  previewTopRowLeft: { flex: 1, minWidth: 0 },
  previewTopRowRight: { alignItems: "flex-end", maxWidth: "50%" },
  previewFoodTitle: { color: "#2E241C", fontWeight: "800", fontSize: 18 },
  previewFoodSummary: { color: "#6F6358", marginTop: 2, fontSize: 14, fontWeight: "600" },
  previewSeller: { color: "#5A4B3F", fontWeight: "700", fontSize: 16 },
  previewCuisine: { color: "#7D6D60", fontWeight: "700", fontSize: 14, marginTop: 2 },
  previewMidRow: { marginTop: 8, flexDirection: "row", alignItems: "center", gap: 5 },
  previewMetaText: { color: "#7D6D60", fontWeight: "600", fontSize: 13 },
  previewFooter: { marginTop: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  previewFooterPlaceholder: { color: "transparent" },
  previewAllergen: { color: "#B73D35", fontWeight: "700", fontSize: 13, flex: 1, textAlign: "right" },
  previewCloseBtn: {
    marginTop: 12,
    backgroundColor: "#3F855C",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  previewCloseBtnText: { color: "#fff", fontWeight: "700" },
  datePickerCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E5DDCF",
  },
  categoryModalCard: {
    maxHeight: "70%",
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E5DDCF",
  },
  categoryModalTitle: { color: "#2E241C", fontWeight: "800", fontSize: 16, marginBottom: 10 },
  categoryEmptyWrap: { alignItems: "center", paddingVertical: 18, gap: 10 },
  categoryEmptyText: { color: "#6F6358", fontSize: 13 },
  categoryRetryBtn: {
    backgroundColor: "#3F855C",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  categoryRetryBtnText: { color: "#fff", fontWeight: "700" },
  categoryList: { maxHeight: 360 },
  categoryListContent: { paddingBottom: 6 },
  categoryOption: {
    borderWidth: 1,
    borderColor: "#E5DDCF",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
  },
  categoryOptionActive: {
    borderColor: "#8FA58F",
    backgroundColor: "#ECF4EE",
  },
  categoryOptionText: { color: "#2E241C" },
  categoryOptionTextActive: { color: "#2E6B44", fontWeight: "700" },
  datePickerHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  datePickerTitle: { color: "#2E241C", fontWeight: "800", fontSize: 16 },
  dateWeekRow: { flexDirection: "row", marginBottom: 6 },
  dateWeekLabel: { flex: 1, textAlign: "center", color: "#7A6B5D", fontSize: 12, fontWeight: "700" },
  dateGrid: { flexDirection: "row", flexWrap: "wrap" },
  dateCell: {
    width: "14.285%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  dateCellEmpty: { opacity: 0 },
  dateCellText: { color: "#2E241C", fontWeight: "600" },
  dateCellTextEmpty: { color: "transparent" },
});
