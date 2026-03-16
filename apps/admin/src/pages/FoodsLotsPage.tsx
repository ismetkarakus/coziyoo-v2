import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { request, parseJson } from "../lib/api";
import { DICTIONARIES } from "../lib/i18n";
import { ExcelExportButton, Pager, PrintButton } from "../components/ui";
import { fmt, toDisplayId, formatCurrency, formatUiDate } from "../lib/format";
import { fetchAllAdminLots, lotLifecycleLabel, lotLifecycleClass, computeFoodLotDiff } from "../lib/lots";
import { printModalContent } from "../lib/print";
import type { Language, ApiError } from "../types/core";
import type { AdminLotRow } from "../types/lots";

export default function FoodsLotsPage({ language }: { language: Language }) {
  const location = useLocation();
  const dict = DICTIONARIES[language];
  const [rows, setRows] = useState<
    Array<{
      id: string;
      code: string;
      name: string;
      sellerId: string;
      isActive: boolean;
      price: number;
      updatedAt: string;
      recipe: string | null;
      description: string | null;
      ingredientsJson: unknown;
      allergensJson: unknown;
    }>
  >([]);
  const [sellerNameById, setSellerNameById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<{ total: number; totalPages: number } | null>(null);
  const [expandedFoodIds, setExpandedFoodIds] = useState<Record<string, boolean>>({});
  const [lotsByFoodId, setLotsByFoodId] = useState<Record<string, AdminLotRow[]>>({});
  const [lotsLoadingByFoodId, setLotsLoadingByFoodId] = useState<Record<string, boolean>>({});
  const [lotsErrorByFoodId, setLotsErrorByFoodId] = useState<Record<string, string | null>>({});
  const [filterVariationsOnly, setFilterVariationsOnly] = useState(false);
  const foodModalPrintRef = useRef<HTMLDivElement | null>(null);
  const [selectedFood, setSelectedFood] = useState<{
    id: string;
    code: string;
    name: string;
    sellerId: string;
    isActive: boolean;
    price: number;
    updatedAt: string;
    recipe: string | null;
    description: string | null;
    ingredientsJson: unknown;
    allergensJson: unknown;
  } | null>(null);
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null);
  const [selectedFoodMap, setSelectedFoodMap] = useState<Record<string, {
    id: string;
    code: string;
    name: string;
    sellerId: string;
    isActive: boolean;
    price: number;
    updatedAt: string;
    recipe: string | null;
    description: string | null;
    ingredientsJson: unknown;
    allergensJson: unknown;
  }>>({});
  const initialSearch = useMemo(() => {
    const value = new URLSearchParams(location.search).get("search");
    return value ? value.trim() : "";
  }, [location.search]);
  const focusFoodId = useMemo(() => {
    const value = new URLSearchParams(location.search).get("foodId");
    return value ? value.trim() : "";
  }, [location.search]);
  const focusLotId = useMemo(() => {
    const value = new URLSearchParams(location.search).get("lotId");
    return value ? value.trim() : "";
  }, [location.search]);
  const pageSize = 20;

  const toPrettyJson = (value: unknown) => {
    if (value === null || value === undefined) return "-";
    if (typeof value === "string") {
      const text = value.trim();
      if (!text) return "-";
      if (text.startsWith("{") || text.startsWith("[")) {
        try {
          return JSON.stringify(JSON.parse(text), null, 2);
        } catch {
          return text;
        }
      }
      return text;
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  const toReadableText = (value: unknown): string => {
    if (value === null || value === undefined) return "-";
    if (typeof value === "string") {
      const text = value.trim();
      if (!text) return "-";
      if (text.startsWith("{") || text.startsWith("[")) {
        try {
          return toReadableText(JSON.parse(text));
        } catch {
          return text;
        }
      }
      return text;
    }
    if (Array.isArray(value)) {
      const parts = value
        .map((item) => toReadableText(item))
        .map((item) => item.trim())
        .filter((item) => item && item !== "-");
      return parts.length > 0 ? parts.join(", ") : "-";
    }
    if (typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => {
          const normalized = toReadableText(item);
          if (!normalized || normalized === "-") return "";
          return `${key}: ${normalized}`;
        })
        .filter(Boolean);
      return entries.length > 0 ? entries.join(", ") : "-";
    }
    return String(value);
  };

  const allergenCatalog = [
    { key: "gluten", labelTr: "Gluten", labelEn: "Gluten", hints: ["gluten", "bugday", "wheat", "arpa", "barley", "cavdar", "rye"] },
    { key: "milk", labelTr: "Süt", labelEn: "Milk", hints: ["sut", "milk", "lactose", "laktoz", "peynir", "yogurt", "cream"] },
    { key: "egg", labelTr: "Yumurta", labelEn: "Egg", hints: ["yumurta", "egg"] },
    { key: "soy", labelTr: "Soya", labelEn: "Soy", hints: ["soya", "soy"] },
    { key: "sesame", labelTr: "Susam", labelEn: "Sesame", hints: ["susam", "sesame", "tahin"] },
    { key: "fish", labelTr: "Balık", labelEn: "Fish", hints: ["balik", "fish", "somon", "ton"] },
    { key: "shellfish", labelTr: "Kabuklu", labelEn: "Shellfish", hints: ["kabuklu", "shrimp", "karides", "midye", "istakoz", "shellfish"] },
    { key: "tree_nut", labelTr: "Sert Kabuklu", labelEn: "Tree Nuts", hints: ["findik", "hazelnut", "ceviz", "walnut", "badem", "almond", "fistik"] },
    { key: "peanut", labelTr: "Yer Fıstığı", labelEn: "Peanut", hints: ["yer fistik", "peanut"] },
  ] as const;

  const normalizeText = (value: unknown): string =>
    String(value ?? "")
      .toLocaleLowerCase("tr-TR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const flattenToText = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map((item) => flattenToText(item)).join(" ");
    if (typeof value === "object") return Object.values(value as Record<string, unknown>).map((item) => flattenToText(item)).join(" ");
    return String(value);
  };

  const toDiffItems = (value: unknown): string[] => {
    if (value === null || value === undefined) return [];
    if (typeof value === "string") {
      const text = value.trim();
      if (!text) return [];
      if (text.startsWith("{") || text.startsWith("[")) {
        try {
          return toDiffItems(JSON.parse(text));
        } catch {
          return text.split(/[,\n]+/g).map((item) => item.trim()).filter(Boolean);
        }
      }
      return text.split(/[,\n]+/g).map((item) => item.trim()).filter(Boolean);
    }
    if (Array.isArray(value)) {
      return value.flatMap((item) => toDiffItems(item));
    }
    if (typeof value === "object") {
      return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
        if (typeof item === "boolean") return item ? [key] : [];
        const text = toReadableText(item).trim();
        if (!text || text === "-") return [];
        return [`${key}: ${text}`];
      });
    }
    return [String(value)];
  };

  const buildDiffList = (baseValue: unknown, lotValue: unknown): { added: string[]; removed: string[] } => {
    const baseItems = toDiffItems(baseValue);
    const lotItems = toDiffItems(lotValue);
    const baseMap = new Map<string, string>();
    const lotMap = new Map<string, string>();
    for (const item of baseItems) {
      const normalized = normalizeText(item);
      if (!normalized) continue;
      if (!baseMap.has(normalized)) baseMap.set(normalized, item);
    }
    for (const item of lotItems) {
      const normalized = normalizeText(item);
      if (!normalized) continue;
      if (!lotMap.has(normalized)) lotMap.set(normalized, item);
    }
    const added: string[] = [];
    const removed: string[] = [];
    for (const [key, value] of lotMap.entries()) {
      if (!baseMap.has(key)) added.push(value);
    }
    for (const [key, value] of baseMap.entries()) {
      if (!lotMap.has(key)) removed.push(value);
    }
    return { added, removed };
  };

  const explainAllergens = (
    food: NonNullable<typeof selectedFood>
  ): Array<{ key: string; label: string; status: "contains" | "may" | "mentioned"; note: string }> => {
    const statusScore: Record<string, number> = { mentioned: 1, may: 2, contains: 3 };
    const bag = new Map<string, { status: "contains" | "may" | "mentioned"; note: string }>();
    const setStatus = (key: string, status: "contains" | "may" | "mentioned", note: string) => {
      const prev = bag.get(key);
      if (!prev || statusScore[status] >= statusScore[prev.status]) bag.set(key, { status, note });
    };

    const allergenText = normalizeText(flattenToText(food.allergensJson));
    const descText = normalizeText(`${flattenToText(food.ingredientsJson)} ${food.recipe ?? ""} ${food.description ?? ""}`);

    for (const allergen of allergenCatalog) {
      const label = language === "tr" ? allergen.labelTr : allergen.labelEn;
      const inAllergenData = allergen.hints.some((hint) => allergenText.includes(normalizeText(hint)));
      const inDescData = allergen.hints.some((hint) => descText.includes(normalizeText(hint)));
      if (inAllergenData) {
        if (allergenText.includes("may contain") || allergenText.includes("eser") || allergenText.includes("iz") || allergenText.includes("olabilir")) {
          setStatus(allergen.key, "may", language === "tr" ? `${label} izi olabilir.` : `${label} traces possible.`);
        } else {
          setStatus(allergen.key, "contains", language === "tr" ? `${label} içeriyor.` : `Contains ${label}.`);
        }
      } else if (inDescData) {
        setStatus(allergen.key, "mentioned", language === "tr" ? `Açıklamada ${label} ifadesi geçiyor.` : `${label} mentioned in description.`);
      }
    }

    const out: Array<{ key: string; label: string; status: "contains" | "may" | "mentioned"; note: string }> = [];
    for (const allergen of allergenCatalog) {
      const info = bag.get(allergen.key);
      if (!info) continue;
      out.push({
        key: allergen.key,
        label: language === "tr" ? allergen.labelTr : allergen.labelEn,
        status: info.status,
        note: info.note,
      });
    }
    return out;
  };

  useEffect(() => {
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sortDir: "desc",
      ...(search ? { search } : {}),
    });
    request(`/v1/admin/metadata/tables/foods/records?${query.toString()}`)
      .then(async (response) => {
        if (response.status !== 200) {
          const body = await parseJson<ApiError>(response);
          setError(body.error?.message ?? dict.entities.loadRecordsFailed);
          setLoading(false);
          return;
        }
        const body = await parseJson<{
          data: {
            rows: Array<Record<string, unknown>>;
          };
          pagination: {
            total: number;
            totalPages: number;
          };
        }>(response);
        const mapped = body.data.rows
          .map((record) => ({
            id: String(record.id ?? ""),
            code: String(
              record.code ??
              record.food_code ??
              record.display_code ??
              record.display_id ??
              record.food_no ??
              record.sku ??
              record.foodCode ??
              record.displayId ??
              record.foodNo ??
              ""
            ).trim(),
            name: String(record.name ?? "-"),
            sellerId: String(record.seller_id ?? ""),
            isActive: Boolean(record.is_active),
            price: Number(record.price ?? 0),
            updatedAt: String(record.updated_at ?? ""),
            recipe: typeof record.recipe === "string" ? record.recipe : null,
            description: typeof record.description === "string" ? record.description : typeof record.card_summary === "string" ? record.card_summary : null,
            ingredientsJson: record.ingredients_json ?? null,
            allergensJson: record.allergens_json ?? null,
          }))
          .filter((row) => row.id.length > 0);
        setRows(mapped);
        setPagination({ total: body.pagination.total, totalPages: body.pagination.totalPages });
        setLoading(false);
      })
      .catch(() => {
        setError(dict.entities.recordsRequestFailed);
        setLoading(false);
      });
  }, [dict.entities.loadRecordsFailed, dict.entities.recordsRequestFailed, page, pageSize, search]);

  useEffect(() => {
    const missingSellerIds = Array.from(new Set(rows.map((row) => row.sellerId).filter((sellerId) => sellerId && !sellerNameById[sellerId])));
    if (missingSellerIds.length === 0) return;
    let active = true;
    Promise.all(
      missingSellerIds.map(async (sellerId) => {
        try {
          const response = await request(`/v1/admin/users/${sellerId}`);
          if (response.status !== 200) return [sellerId, sellerId] as const;
          const body = await parseJson<{ data?: { displayName?: string | null; email?: string | null } }>(response);
          return [sellerId, body.data?.displayName || body.data?.email || sellerId] as const;
        } catch {
          return [sellerId, sellerId] as const;
        }
      })
    ).then((entries) => {
      if (!active) return;
      setSellerNameById((prev) => {
        const next = { ...prev };
        for (const [sellerId, label] of entries) next[sellerId] = label;
        return next;
      });
    });
    return () => {
      active = false;
    };
  }, [rows, sellerNameById]);

  async function loadFoodLots(foodId: string) {
    setLotsLoadingByFoodId((prev) => ({ ...prev, [foodId]: true }));
    setLotsErrorByFoodId((prev) => ({ ...prev, [foodId]: null }));
    try {
      const lots = await fetchAllAdminLots({ foodId });
      setLotsByFoodId((prev) => ({ ...prev, [foodId]: lots }));
    } catch (fetchError) {
      setLotsErrorByFoodId((prev) => ({
        ...prev,
        [foodId]: fetchError instanceof Error ? fetchError.message : dict.detail.requestFailed,
      }));
    } finally {
      setLotsLoadingByFoodId((prev) => ({ ...prev, [foodId]: false }));
    }
  }

  const selectedFoodAllergenSummary = selectedFood ? explainAllergens(selectedFood) : [];
  const selectedFoodLots = selectedFood ? (lotsByFoodId[selectedFood.id] ?? []) : [];
  const selectedLot = selectedFoodLots.find((lot) => lot.id === selectedLotId) ?? null;
  const lotDiff = selectedLot && selectedFood ? computeFoodLotDiff({
    foodRecipe: selectedFood.recipe,
    foodIngredients: selectedFood.ingredientsJson,
    foodAllergens: selectedFood.allergensJson,
    lot: selectedLot,
  }) : null;
  const recipeDiffBaseText = selectedFood?.recipe?.trim() || "-";
  const recipeDiffLotText = selectedLot?.recipe_snapshot?.trim() || "-";
  const ingredientsDiffBaseText = selectedFood ? toReadableText(selectedFood.ingredientsJson) : "-";
  const ingredientsDiffLotText = selectedLot ? toReadableText(selectedLot.ingredients_snapshot_json) : "-";
  const allergensDiffBaseText = selectedFood ? toReadableText(selectedFood.allergensJson) : "-";
  const allergensDiffLotText = selectedLot ? toReadableText(selectedLot.allergens_snapshot_json) : "-";
  const ingredientListDiff = selectedFood && selectedLot
    ? buildDiffList(selectedFood.ingredientsJson, selectedLot.ingredients_snapshot_json)
    : { added: [], removed: [] };
  const allergenListDiff = selectedFood && selectedLot
    ? buildDiffList(selectedFood.allergensJson, selectedLot.allergens_snapshot_json)
    : { added: [], removed: [] };
  const selectedFoods = Object.values(selectedFoodMap);
  const allFoodsSelected =
    rows.length > 0 &&
    rows.every((row) => {
      const id = String(row.id ?? "").trim();
      return id.length > 0 && Boolean(selectedFoodMap[id]);
    });

  const foodIdsWithVariations = useMemo(() => {
    const set = new Set<string>();
    for (const food of rows) {
      const lots = lotsByFoodId[food.id];
      if (!lots) continue;
      for (const lot of lots) {
        const diff = computeFoodLotDiff({
          foodRecipe: food.recipe,
          foodIngredients: food.ingredientsJson,
          foodAllergens: food.allergensJson,
          lot,
        });
        if (diff.recipeChanged || diff.ingredientsChanged || diff.allergensChanged || diff.hasMissingSnapshot) {
          set.add(food.id);
          break;
        }
      }
    }
    return set;
  }, [rows, lotsByFoodId]);

  const displayRows = filterVariationsOnly
    ? rows.filter((food) => {
        const lotsLoaded = Boolean(lotsByFoodId[food.id]);
        if (!lotsLoaded) return true;
        return foodIdsWithVariations.has(food.id);
      })
    : rows;

  function toggleFoodSelection(food: {
    id: string;
    code: string;
    name: string;
    sellerId: string;
    isActive: boolean;
    price: number;
    updatedAt: string;
    recipe: string | null;
    description: string | null;
    ingredientsJson: unknown;
    allergensJson: unknown;
  }, checked: boolean) {
    const id = String(food.id ?? "").trim();
    if (!id) return;
    setSelectedFoodMap((prev) => {
      if (checked) return { ...prev, [id]: food };
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function toggleAllFoods(checked: boolean) {
    setSelectedFoodMap((prev) => {
      const next = { ...prev };
      for (const food of rows) {
        const id = String(food.id ?? "").trim();
        if (!id) continue;
        if (checked) next[id] = food;
        else delete next[id];
      }
      return next;
    });
  }

  function openFoodDetail(food: {
    id: string;
    code: string;
    name: string;
    sellerId: string;
    isActive: boolean;
    price: number;
    updatedAt: string;
    recipe: string | null;
    description: string | null;
    ingredientsJson: unknown;
    allergensJson: unknown;
  }, lotId?: string) {
    setSelectedFood(food);
    setSelectedLotId(lotId ?? null);
    if (!lotsByFoodId[food.id] && !lotsLoadingByFoodId[food.id]) {
      void loadFoodLots(food.id);
    }
  }

  function downloadSelectedFoodsAsExcel() {
    if (selectedFoods.length === 0) {
      setError(language === "tr" ? "Lütfen en az bir yemek seçin." : "Please select at least one food.");
      return;
    }
    const headers = [
      language === "tr" ? "Yemek ID" : "Food ID",
      language === "tr" ? "Yemek Adı" : "Food Name",
      language === "tr" ? "Satıcı" : "Seller",
      language === "tr" ? "Durum" : "Status",
      language === "tr" ? "Fiyat" : "Price",
      language === "tr" ? "Güncelleme" : "Updated",
    ];
    const rowsForExport = selectedFoods.map((food) => [
      food.id,
      food.name,
      sellerNameById[food.sellerId] ?? toDisplayId(food.sellerId),
      food.isActive ? dict.common.active : dict.common.disabled,
      formatCurrency(food.price, language),
      formatUiDate(food.updatedAt, language),
    ]);
    const escapeCsv = (value: string) => `"${value.replace(/"/g, "\"\"")}"`;
    const csv = [headers, ...rowsForExport].map((line) => line.map((cell) => escapeCsv(String(cell))).join(",")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `foods-selected-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadSelectedFoodDetailAsExcel() {
    if (!selectedFood) return;
    const headers = [
      language === "tr" ? "Yemek ID" : "Food ID",
      language === "tr" ? "Yemek Adı" : "Food Name",
      language === "tr" ? "Satıcı" : "Seller",
      language === "tr" ? "Durum" : "Status",
      language === "tr" ? "Fiyat" : "Price",
      language === "tr" ? "Güncelleme" : "Updated",
    ];
    const summaryRow = [
      selectedFood.id,
      selectedFood.name,
      sellerNameById[selectedFood.sellerId] ?? toDisplayId(selectedFood.sellerId),
      selectedFood.isActive ? dict.common.active : dict.common.disabled,
      formatCurrency(selectedFood.price, language),
      formatUiDate(selectedFood.updatedAt, language),
    ];
    const escapeCsv = (value: string) => `"${value.replace(/"/g, "\"\"")}"`;
    const lines: string[] = [];
    lines.push(headers.map(escapeCsv).join(","));
    lines.push(summaryRow.map(escapeCsv).join(","));
    lines.push("");
    lines.push(language === "tr" ? "Alerjen Durumu" : "Allergen Status");
    if (selectedFoodAllergenSummary.length === 0) {
      lines.push(language === "tr" ? "Alerjen yok" : "No allergens");
    } else {
      lines.push([language === "tr" ? "Alerjen" : "Allergen", language === "tr" ? "Durum" : "Status", language === "tr" ? "Not" : "Note"].map(escapeCsv).join(","));
      for (const row of selectedFoodAllergenSummary) {
        const statusText =
          row.status === "contains"
            ? language === "tr"
              ? "İçerir"
              : "Contains"
            : row.status === "may"
              ? language === "tr"
                ? "İçerebilir"
                : "May contain"
              : language === "tr"
                ? "Bahsedildi"
                : "Mentioned";
        lines.push([row.label, statusText, row.note].map(escapeCsv).join(","));
      }
    }
    lines.push("");
    lines.push(language === "tr" ? "Lot Özeti" : "Lots Summary");
    if (selectedFoodLots.length === 0) {
      lines.push(language === "tr" ? "Lot bulunamadı" : "No lots");
    } else {
      lines.push([
        dict.detail.lotNumber,
        dict.detail.lotLifecycle,
        dict.detail.lotQuantity,
        dict.detail.lotProducedAt,
        language === "tr" ? "Tarif Değişti" : "Recipe Changed",
        language === "tr" ? "İçerik Değişti" : "Ingredients Changed",
        language === "tr" ? "Alerjen Değişti" : "Allergens Changed",
        language === "tr" ? "Lot Tarif" : "Lot Recipe",
        language === "tr" ? "Lot Alerjen" : "Lot Allergens",
      ].map(escapeCsv).join(","));
      for (const lot of selectedFoodLots) {
        const diff = computeFoodLotDiff({
          foodRecipe: selectedFood.recipe,
          foodIngredients: selectedFood.ingredientsJson,
          foodAllergens: selectedFood.allergensJson,
          lot,
        });
        const yes = language === "tr" ? "Evet" : "Yes";
        const no = language === "tr" ? "Hayır" : "No";
        lines.push(
          [
            lot.lot_number,
            lotLifecycleLabel(lot.lifecycle_status, language),
            `${lot.quantity_available}/${lot.quantity_produced}`,
            formatUiDate(lot.produced_at, language),
            diff.recipeChanged ? yes : no,
            diff.ingredientsChanged ? yes : no,
            diff.allergensChanged ? yes : no,
            diff.ingredientsChanged ? toReadableText(lot.ingredients_snapshot_json) : "",
            diff.allergensChanged ? toReadableText(lot.allergens_snapshot_json) : "",
          ].map(escapeCsv).join(",")
        );
      }
    }

    const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `food-detail-${selectedFood.id.slice(0, 12)}-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function printSelectedFoodDetail() {
    if (!selectedFood) return;
    printModalContent(foodModalPrintRef.current);
  }

  useEffect(() => {
    setSearch(initialSearch);
    setPage(1);
  }, [initialSearch]);

  useEffect(() => {
    if (!focusFoodId) return;
    const food = rows.find((row) => row.id === focusFoodId);
    if (!food) return;
    openFoodDetail(food, focusLotId || undefined);
  }, [focusFoodId, focusLotId, rows]);

  return (
    <div className="app">
      <header className="topbar topbar-with-centered-search">
        <div>
          <h1>{dict.menu.foods}</h1>
          <p className="subtext">{dict.detail.foodsLotsSubtitle}</p>
        </div>
        <div className="topbar-search-center">
          <div className="users-search-wrap users-search-wrap--compact">
            <span className="users-search-icon" aria-hidden="true">
              <svg className="users-search-icon-svg" viewBox="0 0 24 24" fill="none" role="presentation">
                <circle cx="11" cy="11" r="7.2" stroke="currentColor" strokeWidth="2" />
                <path d="M16.7 16.7L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>
            <input
              className="users-search-input users-search-input--compact"
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
            />
            {search.trim().length > 0 ? (
              <button
                className="users-search-clear"
                type="button"
                aria-label={language === "tr" ? "Aramayı temizle" : "Clear search"}
                onClick={() => {
                  setPage(1);
                  setSearch("");
                }}
              >
                ×
              </button>
            ) : null}
          </div>
        </div>
        <div className="topbar-actions">
          <ExcelExportButton className="primary" type="button" onClick={downloadSelectedFoodsAsExcel} language={language}>
            {language === "tr" ? `Excel'e Aktar (${selectedFoods.length})` : `Export to Excel (${selectedFoods.length})`}
          </ExcelExportButton>
        </div>
      </header>

      <section className="panel">
        {error ? <div className="alert">{error}</div> : null}
        <div className="seller-food-filter-chips">
          <button
            className={`chip${filterVariationsOnly ? " is-active" : ""}`}
            type="button"
            onClick={() => setFilterVariationsOnly((prev) => !prev)}
          >
            {language === "tr" ? "Fark içerenler" : "Has variations"}
          </button>
        </div>
        <div className="table-wrap">
          <table className="foods-lots-main-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={allFoodsSelected}
                    aria-label={language === "tr" ? "Tümünü seç" : "Select all"}
                    onChange={(event) => toggleAllFoods(event.target.checked)}
                  />
                </th>
                <th>{dict.detail.lotActions}</th>
                <th>{dict.detail.foodName}</th>
                <th>{dict.detail.foodSeller}</th>
                <th>{dict.detail.foodStatus}</th>
                <th>{dict.detail.foodPrice}</th>
                <th>{dict.detail.updatedAtLabel}</th>
                <th>{dict.detail.lotSummary}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10}>{dict.common.loading}</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={10}>{dict.common.noRecords}</td>
                </tr>
              ) : (
                displayRows.map((food) => {
                  const lots = lotsByFoodId[food.id] ?? [];
                  const activeLots = lots.filter((lot) => lot.lifecycle_status === "on_sale").length;
                  const recalledLots = lots.filter((lot) => lot.lifecycle_status === "recalled").length;
                  const foodExpanded = Boolean(expandedFoodIds[food.id]);
                  return (
                    <Fragment key={food.id}>
                      <tr
                        className="foods-main-row"
                        onClick={() => {
                          openFoodDetail(food);
                          if (!lotsByFoodId[food.id] && !lotsLoadingByFoodId[food.id]) void loadFoodLots(food.id);
                        }}
                      >
                        <td>
                          <input
                            type="checkbox"
                            checked={Boolean(selectedFoodMap[String(food.id ?? "").trim()])}
                            aria-label={language === "tr" ? "Yemeği seç" : "Select food"}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => toggleFoodSelection(food, event.target.checked)}
                          />
                        </td>
                        <td>
                          <button
                            className="ghost foods-toggle-btn"
                            type="button"
                            aria-label={foodExpanded ? dict.detail.hideLots : dict.detail.showLots}
                            onClick={(event) => {
                              event.stopPropagation();
                              const next = !foodExpanded;
                              setExpandedFoodIds((prev) => ({ ...prev, [food.id]: next }));
                              if (next && !lotsByFoodId[food.id] && !lotsLoadingByFoodId[food.id]) {
                                void loadFoodLots(food.id);
                              }
                            }}
                          >
                            {foodExpanded ? "−" : "+"}
                          </button>
                        </td>
                        <td>
                          <strong>{food.name}</strong>
                        </td>
                        <td>{sellerNameById[food.sellerId] ?? toDisplayId(food.sellerId)}</td>
                        <td>
                          <span className={`status-pill ${food.isActive ? "is-active" : "is-disabled"}`}>
                            {food.isActive ? dict.common.active : dict.common.disabled}
                          </span>
                        </td>
                        <td>{formatCurrency(food.price, language)}</td>
                        <td>{formatUiDate(food.updatedAt, language)}</td>
                        <td>
                          <div className="lot-summary-cell">
                            <span>{`${dict.detail.lotsTitle}: ${lots.length}`}</span>
                            <span>{`${language === "tr" ? "Satışta" : "On Sale"}: ${activeLots}`}</span>
                            {recalledLots > 0 ? <span className="lot-summary-danger">{`${language === "tr" ? "Geri çağrılan" : "Recalled"}: ${recalledLots}`}</span> : null}
                          </div>
                        </td>
                      </tr>
                      {foodExpanded ? (
                        <tr className="foods-lots-expanded-row">
                          <td colSpan={10}>
                            {lotsLoadingByFoodId[food.id] ? (
                              <p className="panel-meta">{dict.common.loading}</p>
                            ) : lotsErrorByFoodId[food.id] ? (
                              <div className="alert">{lotsErrorByFoodId[food.id]}</div>
                            ) : lots.length === 0 ? (
                              <p className="panel-meta">{dict.detail.noLotsForFood}</p>
                            ) : (
                              <div className="seller-food-lots-table-wrap">
                                <table className="seller-food-lots-table">
                                  <thead>
                                    <tr>
                                      <th>{dict.detail.lotNumber}</th>
                                      <th>{dict.detail.lotLifecycle}</th>
                                      <th>{dict.detail.lotQuantity}</th>
                                      <th>{dict.detail.lotProducedAt}</th>
                                      <th>{dict.detail.lotSaleWindow}</th>
                                      <th>{language === "tr" ? "Fark" : "Diff"}</th>
                                      <th>{dict.detail.lotActions}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {lots.map((lot) => {
                                      const diff = computeFoodLotDiff({
                                        foodRecipe: food.recipe,
                                        foodIngredients: food.ingredientsJson,
                                        foodAllergens: food.allergensJson,
                                        lot,
                                      });
                                      return (
                                        <tr key={lot.id}>
                                          <td>{lot.lot_number}</td>
                                          <td>
                                            <span className={`status-pill ${lotLifecycleClass(lot.lifecycle_status)}`}>
                                              {lotLifecycleLabel(lot.lifecycle_status, language)}
                                            </span>
                                          </td>
                                          <td>{`${lot.quantity_available}/${lot.quantity_produced}`}</td>
                                          <td>{formatUiDate(lot.produced_at, language)}</td>
                                          <td>{`${formatUiDate(lot.sale_starts_at, language)} - ${formatUiDate(lot.sale_ends_at, language)}`}</td>
                                          <td>
                                            {diff.hasMissingSnapshot || diff.recipeChanged || diff.ingredientsChanged || diff.allergensChanged ? (
                                              <div className="lot-diff-badges">
                                                {diff.hasMissingSnapshot && (
                                                  <span className="status-pill is-neutral">{dict.detail.lotSnapshotMissing}</span>
                                                )}
                                                {diff.recipeChanged && (
                                                  <span className="status-pill is-warning">{dict.detail.lotDiffRecipe}</span>
                                                )}
                                                {diff.ingredientsChanged && (
                                                  <span className="status-pill is-warning">{dict.detail.lotDiffIngredients}</span>
                                                )}
                                                {diff.allergensChanged && (
                                                  <span className="status-pill is-danger">{dict.detail.lotDiffAllergens}</span>
                                                )}
                                              </div>
                                            ) : (
                                              <span className="status-pill is-success">{dict.detail.lotSnapshotOk}</span>
                                            )}
                                          </td>
                                          <td>
                                            <button className="ghost" type="button" onClick={() => openFoodDetail(food, lot.id)}>
                                              {language === "tr" ? "Detay Göster" : "Show Detail"}
                                            </button>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <Pager
          page={page}
          totalPages={pagination?.totalPages ?? 1}
          summary={fmt(dict.common.paginationSummary, {
            total: pagination?.total ?? 0,
            page,
            totalPages: Math.max(pagination?.totalPages ?? 1, 1),
          })}
          prevLabel={dict.actions.prev}
          nextLabel={dict.actions.next}
          onPageChange={setPage}
          onPrev={() => setPage((prev) => prev - 1)}
          onNext={() => setPage((prev) => prev + 1)}
        />
      </section>
      {selectedFood ? (
        <div className="buyer-ops-modal-backdrop" onClick={() => {
          setSelectedFood(null);
          setSelectedLotId(null);
        }}>
          <div ref={foodModalPrintRef} className="buyer-ops-modal foods-detail-modal print-target-modal" onClick={(event) => event.stopPropagation()}>
            <h3>{selectedLot ? (language === "tr" ? "Lot Detayı" : "Lot Detail") : "Yemek Detayı"}</h3>
            {!selectedLot ? (
              <>
                <div className="foods-detail-grid">
                  <div>
                    <span className="panel-meta">ID</span>
                    <strong>{selectedFood.id}</strong>
                  </div>
                  <div>
                    <span className="panel-meta">{dict.detail.foodName}</span>
                    <strong>{selectedFood.name}</strong>
                  </div>
                  <div>
                    <span className="panel-meta">{dict.detail.foodSeller}</span>
                    <strong>{sellerNameById[selectedFood.sellerId] ?? toDisplayId(selectedFood.sellerId)}</strong>
                  </div>
                  <div>
                    <span className="panel-meta">{dict.detail.foodStatus}</span>
                    <strong>{selectedFood.isActive ? dict.common.active : dict.common.disabled}</strong>
                  </div>
                  <div>
                    <span className="panel-meta">{dict.detail.foodPrice}</span>
                    <strong>{formatCurrency(selectedFood.price, language)}</strong>
                  </div>
                  <div>
                    <span className="panel-meta">{dict.detail.updatedAtLabel}</span>
                    <strong>{formatUiDate(selectedFood.updatedAt, language)}</strong>
                  </div>
                </div>
                <div className="foods-detail-text-block">
                  <h4>{language === "tr" ? "Açıklama" : "Description"}</h4>
                  <p className="foods-detail-paragraph">{selectedFood.description?.trim() || "-"}</p>
                </div>
                <div className="foods-detail-text-block">
                  <h4>{language === "tr" ? "Tarif" : "Recipe"}</h4>
                  <p className="foods-detail-paragraph">{selectedFood.recipe?.trim() || "-"}</p>
                </div>
                <div className="foods-detail-text-block">
                  <h4>İçerikler</h4>
                  <p className="foods-detail-paragraph">{toReadableText(selectedFood.ingredientsJson)}</p>
                </div>
                <div className="foods-detail-text-block">
                  <h4>{language === "tr" ? "Alerjen Durumu" : "Allergen Status"}</h4>
                  {selectedFoodAllergenSummary.length === 0 ? (
                    <p className="panel-meta">Alerjen yok.</p>
                  ) : (
                    <div className="foods-allergen-status-list">
                      {selectedFoodAllergenSummary.map((row) => {
                        const tone = row.status === "contains" ? "is-danger" : row.status === "may" ? "is-warning" : "is-neutral";
                        const statusText =
                          row.status === "contains"
                            ? "İçerir"
                            : row.status === "may"
                              ? "İçerebilir"
                              : "Bahsedildi";
                        return (
                          <article key={row.key} className="foods-allergen-status-item">
                            <div className="foods-allergen-status-head">
                              <strong>{row.label}</strong>
                              <span className={`status-pill ${tone}`}>{statusText}</span>
                            </div>
                            <p className="panel-meta">{row.note}</p>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            ) : null}
            {selectedLot ? (
              <div className="foods-detail-text-block foods-detail-lot-focus">
                {lotDiff && (lotDiff.recipeChanged || lotDiff.ingredientsChanged || lotDiff.allergensChanged) ? (
                  <div className="lot-diff-alert">
                    <span className="lot-diff-alert-icon">⚠</span>
                    <span>
                      {language === "tr"
                        ? `Bu lot ana yemekten farklı: ${[lotDiff.recipeChanged && "Tarif", lotDiff.ingredientsChanged && "İçerikler", lotDiff.allergensChanged && "Alerjenler"].filter(Boolean).join(", ")}`
                        : `This lot differs from the base food: ${[lotDiff.recipeChanged && "Recipe", lotDiff.ingredientsChanged && "Ingredients", lotDiff.allergensChanged && "Allergens"].filter(Boolean).join(", ")}`}
                    </span>
                  </div>
                ) : null}
                <div className="foods-detail-grid">
                  <div>
                    <span className="panel-meta">{dict.detail.lotNumber}</span>
                    <strong>{selectedLot.lot_number}</strong>
                  </div>
                  <div>
                    <span className="panel-meta">{dict.detail.lotLifecycle}</span>
                    <strong>{lotLifecycleLabel(selectedLot.lifecycle_status, language)}</strong>
                  </div>
                  <div>
                    <span className="panel-meta">{dict.detail.lotQuantity}</span>
                    <strong>{`${selectedLot.quantity_available}/${selectedLot.quantity_produced}`}</strong>
                  </div>
                  <div>
                    <span className="panel-meta">{dict.detail.lotProducedAt}</span>
                    <strong>{formatUiDate(selectedLot.produced_at, language)}</strong>
                  </div>
                  <div>
                    <span className="panel-meta">{dict.detail.lotSaleWindow}</span>
                    <strong>{`${formatUiDate(selectedLot.sale_starts_at, language)} - ${formatUiDate(selectedLot.sale_ends_at, language)}`}</strong>
                  </div>
                  <div>
                    <span className="panel-meta">{language === "tr" ? "Son Kullanma Tarihi" : "Use By Date"}</span>
                    <strong>{formatUiDate(selectedLot.use_by, language)}</strong>
                  </div>
                </div>
                <div className="foods-detail-text-block">
                  <h4>{language === "tr" ? "Ana Yemek Tarif" : "Base Food Recipe"}</h4>
                  <p className="foods-detail-paragraph">{selectedFood?.recipe?.trim() || "-"}</p>
                </div>
                <div className="foods-detail-grid">
                  {lotDiff?.recipeChanged ? (
                    <div className="foods-detail-text-block foods-detail-text-block--warn">
                      <h4>{language === "tr" ? "Tarif Değişimi" : "Recipe Change"}</h4>
                      <p className="panel-meta">{language === "tr" ? "Eski (Ana Yemek)" : "Old (Base Food)"}</p>
                      <p className="foods-detail-paragraph">{recipeDiffBaseText}</p>
                      <p className="panel-meta">{language === "tr" ? "Yeni (Lot)" : "New (Lot)"}</p>
                      <p className="foods-detail-paragraph">{recipeDiffLotText}</p>
                    </div>
                  ) : null}
                  {lotDiff?.ingredientsChanged ? (
                    <div className="foods-detail-text-block foods-detail-text-block--warn">
                      <h4>{language === "tr" ? "İçerik Değişimi" : "Ingredients Change"}</h4>
                      <p className="panel-meta">{language === "tr" ? "Eski (Ana Yemek)" : "Old (Base Food)"}</p>
                      <p className="foods-detail-paragraph">{ingredientsDiffBaseText}</p>
                      <p className="panel-meta">{language === "tr" ? "Yeni (Lot)" : "New (Lot)"}</p>
                      <p className="foods-detail-paragraph">{ingredientsDiffLotText}</p>
                      <p className="panel-meta">{language === "tr" ? "Eklenenler" : "Added"}</p>
                      <p className="foods-detail-paragraph">{ingredientListDiff.added.length > 0 ? ingredientListDiff.added.join(", ") : "-"}</p>
                      <p className="panel-meta">{language === "tr" ? "Çıkarılanlar" : "Removed"}</p>
                      <p className="foods-detail-paragraph">{ingredientListDiff.removed.length > 0 ? ingredientListDiff.removed.join(", ") : "-"}</p>
                    </div>
                  ) : null}
                  {lotDiff?.allergensChanged ? (
                    <div className="foods-detail-text-block foods-detail-text-block--warn">
                      <h4>{language === "tr" ? "Alerjen Değişimi" : "Allergens Change"}</h4>
                      <p className="panel-meta">{language === "tr" ? "Eski (Ana Yemek)" : "Old (Base Food)"}</p>
                      <p className="foods-detail-paragraph">{allergensDiffBaseText}</p>
                      <p className="panel-meta">{language === "tr" ? "Yeni (Lot)" : "New (Lot)"}</p>
                      <p className="foods-detail-paragraph">{allergensDiffLotText}</p>
                      <p className="panel-meta">{language === "tr" ? "Eklenenler" : "Added"}</p>
                      <p className="foods-detail-paragraph">{allergenListDiff.added.length > 0 ? allergenListDiff.added.join(", ") : "-"}</p>
                      <p className="panel-meta">{language === "tr" ? "Çıkarılanlar" : "Removed"}</p>
                      <p className="foods-detail-paragraph">{allergenListDiff.removed.length > 0 ? allergenListDiff.removed.join(", ") : "-"}</p>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div className="buyer-ops-modal-actions">
              <ExcelExportButton className="ghost" type="button" onClick={downloadSelectedFoodDetailAsExcel} language={language} />
              <PrintButton className="ghost" type="button" onClick={printSelectedFoodDetail} language={language} />
              <button className="primary" type="button" onClick={() => {
                setSelectedFood(null);
                setSelectedLotId(null);
              }}>
                Kapat
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
