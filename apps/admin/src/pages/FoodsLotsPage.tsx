import { Fragment, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { request, parseJson } from "../lib/api";
import { DICTIONARIES } from "../lib/i18n";
import { ExcelExportButton, PrintButton } from "../components/ui";
import { fmt, toDisplayId, formatCurrency, formatUiDate } from "../lib/format";
import { fetchAllAdminLots, computeFoodLotDiff, lotLifecycleClass, lotLifecycleLabel } from "../lib/lots";
import { printModalContent } from "../lib/print";
import type { Language, ApiError } from "../types/core";
import type { AdminLotRow, AdminLotOrderRow } from "../types/lots";

export default function FoodsLotsPage({ language }: { language: Language }) {
  const navigate = useNavigate();
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
  const [expandedLotIds, setExpandedLotIds] = useState<Record<string, boolean>>({});
  const [lotOrdersByLotId, setLotOrdersByLotId] = useState<Record<string, AdminLotOrderRow[]>>({});
  const [lotOrdersLoadingByLotId, setLotOrdersLoadingByLotId] = useState<Record<string, boolean>>({});
  const [lotOrdersErrorByLotId, setLotOrdersErrorByLotId] = useState<Record<string, string | null>>({});
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

  async function loadLotOrders(lotId: string) {
    if (lotOrdersByLotId[lotId]) return;
    setLotOrdersLoadingByLotId((prev) => ({ ...prev, [lotId]: true }));
    setLotOrdersErrorByLotId((prev) => ({ ...prev, [lotId]: null }));
    try {
      const response = await request(`/v1/admin/lots/${lotId}/orders`);
      if (response.status !== 200) {
        const body = await parseJson<ApiError>(response);
        setLotOrdersErrorByLotId((prev) => ({ ...prev, [lotId]: body.error?.message ?? dict.detail.requestFailed }));
        return;
      }
      const body = await parseJson<{ data: AdminLotOrderRow[] }>(response);
      setLotOrdersByLotId((prev) => ({ ...prev, [lotId]: body.data ?? [] }));
    } catch {
      setLotOrdersErrorByLotId((prev) => ({ ...prev, [lotId]: dict.detail.requestFailed }));
    } finally {
      setLotOrdersLoadingByLotId((prev) => ({ ...prev, [lotId]: false }));
    }
  }

  const selectedFoodAllergenSummary = selectedFood ? explainAllergens(selectedFood) : [];
  const selectedFoodLots = selectedFood ? (lotsByFoodId[selectedFood.id] ?? []) : [];
  const selectedFoods = Object.values(selectedFoodMap);
  const allFoodsSelected =
    rows.length > 0 &&
    rows.every((row) => {
      const id = String(row.id ?? "").trim();
      return id.length > 0 && Boolean(selectedFoodMap[id]);
    });

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

  function openSellerFoodDetail(food: { sellerId: string; id: string }, focusLotId?: string) {
    const sellerId = String(food.sellerId ?? "").trim();
    const foodId = String(food.id ?? "").trim();
    if (!sellerId || !foodId) return;
    const query = new URLSearchParams({ tab: "foods", focusFoodId: foodId });
    if (focusLotId) query.set("focusLotId", focusLotId);
    navigate(`/app/sellers/${sellerId}?${query.toString()}`);
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
      lines.push([dict.detail.lotNumber, dict.detail.lotLifecycle, dict.detail.lotQuantity, dict.detail.lotProducedAt].map(escapeCsv).join(","));
      for (const lot of selectedFoodLots) {
        lines.push(
          [
            lot.lot_number,
            lotLifecycleLabel(lot.lifecycle_status, language),
            `${lot.quantity_available}/${lot.quantity_produced}`,
            formatUiDate(lot.produced_at, language),
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
                <th>{language === "tr" ? "Display ID" : "Display ID"}</th>
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
                rows.map((food) => {
                  const lots = lotsByFoodId[food.id] ?? [];
                  const resolvedFoodCode = food.code || `F-${String(food.id).slice(0, 8)}`;
                  const activeLots = lots.filter((lot) => lot.lifecycle_status === "on_sale").length;
                  const recalledLots = lots.filter((lot) => lot.lifecycle_status === "recalled").length;
                  const foodExpanded = Boolean(expandedFoodIds[food.id]);
                  return (
                    <Fragment key={food.id}>
                      <tr
                        className="foods-main-row"
                        onClick={() => {
                          setSelectedFood(food);
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
                        <td>{toDisplayId(food.id)}</td>
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
                            <div className="seller-food-codes-card">
                              <strong>{language === "tr" ? "Kodlar & Yemek ID" : "Codes & Food ID"}</strong>
                              <div className="seller-food-codes-list">
                                <button className="seller-food-code-chip is-id is-link" type="button" onClick={() => openSellerFoodDetail(food)}>
                                  {`ID: ${food.id}`}
                                </button>
                                <button className="seller-food-code-chip is-food is-link" type="button" onClick={() => openSellerFoodDetail(food)}>
                                  {`${language === "tr" ? "Yemek Kodu" : "Food Code"}: ${resolvedFoodCode}`}
                                </button>
                                {lots.map((lot) => (
                                  <button
                                    key={`code-${food.id}-${lot.id}`}
                                    className="seller-food-code-chip is-lot is-link"
                                    type="button"
                                    onClick={() => openSellerFoodDetail(food, lot.id)}
                                  >
                                    {`${language === "tr" ? "Lot" : "Lot"}: ${lot.lot_number}`}
                                  </button>
                                ))}
                              </div>
                            </div>
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
                                      <th>{dict.detail.lotSnapshot}</th>
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
                                      const lotExpanded = Boolean(expandedLotIds[lot.id]);
                                      const lotOrders = lotOrdersByLotId[lot.id] ?? [];
                                      return (
                                        <Fragment key={lot.id}>
                                          <tr>
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
                                              <div className="lot-diff-badges">
                                                {diff.hasMissingSnapshot ? <span className="status-pill is-danger">{dict.detail.lotSnapshotMissing}</span> : null}
                                                {diff.recipeChanged ? <span className="status-pill is-warning">{dict.detail.lotDiffRecipe}</span> : null}
                                                {diff.ingredientsChanged ? <span className="status-pill is-warning">{dict.detail.lotDiffIngredients}</span> : null}
                                                {diff.allergensChanged ? <span className="status-pill is-danger">{dict.detail.lotDiffAllergens}</span> : null}
                                                {!diff.hasMissingSnapshot && !diff.recipeChanged && !diff.ingredientsChanged && !diff.allergensChanged ? (
                                                  <span className="status-pill is-success">{dict.detail.lotSnapshotOk}</span>
                                                ) : null}
                                              </div>
                                            </td>
                                            <td>
                                              <button
                                                className="ghost"
                                                type="button"
                                                onClick={() => {
                                                  const next = !lotExpanded;
                                                  setExpandedLotIds((prev) => ({ ...prev, [lot.id]: next }));
                                                  if (next) {
                                                    void loadLotOrders(lot.id);
                                                  }
                                                }}
                                              >
                                                {lotExpanded ? dict.detail.hideLotOrders : dict.detail.showLotOrders}
                                              </button>
                                            </td>
                                          </tr>
                                          {lotExpanded ? (
                                            <tr className="lot-orders-row">
                                              <td colSpan={7}>
                                                {lotOrdersLoadingByLotId[lot.id] ? (
                                                  <p className="panel-meta">{dict.common.loading}</p>
                                                ) : lotOrdersErrorByLotId[lot.id] ? (
                                                  <div className="alert">{lotOrdersErrorByLotId[lot.id]}</div>
                                                ) : lotOrders.length === 0 ? (
                                                  <p className="panel-meta">{dict.detail.noOrdersForLot}</p>
                                                ) : (
                                                  <div className="seller-food-lot-orders-wrap">
                                                    <table className="seller-food-lot-orders-table">
                                                      <thead>
                                                        <tr>
                                                          <th>{language === "tr" ? "Sipariş" : "Order"}</th>
                                                          <th>{language === "tr" ? "Durum" : "Status"}</th>
                                                          <th>{language === "tr" ? "Alıcı" : "Buyer"}</th>
                                                          <th>{language === "tr" ? "Adet" : "Quantity"}</th>
                                                          <th>{language === "tr" ? "Tarih" : "Created"}</th>
                                                        </tr>
                                                      </thead>
                                                      <tbody>
                                                        {lotOrders.map((order) => (
                                                          <tr key={`${lot.id}-${order.order_id}`}>
                                                            <td>{`#${order.order_id.slice(0, 10).toUpperCase()}`}</td>
                                                            <td>{order.status}</td>
                                                            <td>{order.buyer_id}</td>
                                                            <td>{order.quantity_allocated}</td>
                                                            <td>{formatUiDate(order.created_at, language)}</td>
                                                          </tr>
                                                        ))}
                                                      </tbody>
                                                    </table>
                                                  </div>
                                                )}
                                              </td>
                                            </tr>
                                          ) : null}
                                        </Fragment>
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
        <div className="pager">
          <span className="panel-meta">
            {fmt(dict.common.paginationSummary, {
              total: pagination?.total ?? 0,
              page,
              totalPages: Math.max(pagination?.totalPages ?? 1, 1),
            })}
          </span>
          <div className="topbar-actions">
            <button className="ghost" disabled={page <= 1} onClick={() => setPage((prev) => prev - 1)} type="button">
              {dict.actions.prev}
            </button>
            <button
              className="ghost"
              disabled={page >= Math.max(pagination?.totalPages ?? 1, 1)}
              onClick={() => setPage((prev) => prev + 1)}
              type="button"
            >
              {dict.actions.next}
            </button>
          </div>
        </div>
      </section>
      {selectedFood ? (
        <div className="buyer-ops-modal-backdrop" onClick={() => setSelectedFood(null)}>
          <div ref={foodModalPrintRef} className="buyer-ops-modal foods-detail-modal print-target-modal" onClick={(event) => event.stopPropagation()}>
            <h3>Yemek Detayı</h3>
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
                <strong>{formatCurrency(selectedFood.price, "tr")}</strong>
              </div>
              <div>
                <span className="panel-meta">{dict.detail.updatedAtLabel}</span>
                <strong>{formatUiDate(selectedFood.updatedAt, "tr")}</strong>
              </div>
            </div>
            <div className="foods-detail-text-block">
              <h4>İçerikler</h4>
              <p className="foods-detail-paragraph">{toReadableText(selectedFood.ingredientsJson)}</p>
            </div>
            <div className="foods-detail-text-block">
              <h4>Alerjen Durumu</h4>
              {selectedFoodAllergenSummary.length === 0 ? (
                <p className="panel-meta">
                  Alerjen yok.
                </p>
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
            <div className="foods-detail-text-block">
              {selectedFoodLots.length === 0 ? (
                <p className="panel-meta">{dict.detail.noLotsForFood}</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{dict.detail.lotNumber}</th>
                        <th>{dict.detail.lotLifecycle}</th>
                        <th>{dict.detail.lotQuantity}</th>
                        <th>{dict.detail.lotProducedAt}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedFoodLots.map((lot) => (
                        <tr key={`modal-lot-${lot.id}`}>
                          <td>{lot.lot_number}</td>
                          <td>{lotLifecycleLabel(lot.lifecycle_status, "tr")}</td>
                          <td>{`${lot.quantity_available}/${lot.quantity_produced}`}</td>
                          <td>{formatUiDate(lot.produced_at, "tr")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="buyer-ops-modal-actions">
              <ExcelExportButton className="ghost" type="button" onClick={downloadSelectedFoodDetailAsExcel} language="tr" />
              <PrintButton className="ghost" type="button" onClick={printSelectedFoodDetail} language="tr" />
              <button className="primary" type="button" onClick={() => setSelectedFood(null)}>
                Kapat
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
