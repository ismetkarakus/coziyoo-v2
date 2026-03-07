import { Fragment, useEffect, useState } from "react";
import { request, parseJson } from "../lib/api";
import { DICTIONARIES } from "../lib/i18n";
import { fmt, toDisplayId, formatCurrency, formatUiDate } from "../lib/format";
import { fetchAllAdminLots, computeFoodLotDiff, lotLifecycleClass, lotLifecycleLabel } from "../lib/lots";
import type { Language, ApiError } from "../types/core";
import type { AdminLotRow, AdminLotOrderRow } from "../types/lots";

export default function FoodsLotsPage({ language }: { language: Language }) {
  const dict = DICTIONARIES[language];
  const [rows, setRows] = useState<
    Array<{
      id: string;
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
  const [selectedFood, setSelectedFood] = useState<{
    id: string;
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
  ): Array<{ key: string; label: string; status: "contains" | "may" | "free" | "mentioned" | "unknown"; note: string }> => {
    const statusScore: Record<string, number> = { unknown: 0, mentioned: 1, free: 2, may: 3, contains: 4 };
    const bag = new Map<string, { status: "contains" | "may" | "free" | "mentioned" | "unknown"; note: string }>();
    const setStatus = (key: string, status: "contains" | "may" | "free" | "mentioned" | "unknown", note: string) => {
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
        if (allergenText.includes("icermez") || allergenText.includes("contains no") || allergenText.includes("free from") || allergenText.includes("yok")) {
          setStatus(allergen.key, "free", language === "tr" ? `${label} bulunmuyor.` : `${label} not present.`);
        } else if (allergenText.includes("may contain") || allergenText.includes("eser") || allergenText.includes("iz") || allergenText.includes("olabilir")) {
          setStatus(allergen.key, "may", language === "tr" ? `${label} izi olabilir.` : `${label} traces possible.`);
        } else {
          setStatus(allergen.key, "contains", language === "tr" ? `${label} içeriyor.` : `Contains ${label}.`);
        }
      } else if (inDescData) {
        setStatus(allergen.key, "mentioned", language === "tr" ? `Açıklamada ${label} ifadesi geçiyor.` : `${label} mentioned in description.`);
      } else {
        setStatus(allergen.key, "unknown", language === "tr" ? "Net bilgi yok." : "No clear data.");
      }
    }

    return allergenCatalog.map((allergen) => ({
      key: allergen.key,
      label: language === "tr" ? allergen.labelTr : allergen.labelEn,
      ...(bag.get(allergen.key) ?? { status: "unknown", note: language === "tr" ? "Net bilgi yok." : "No clear data." }),
    }));
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

  return (
    <div className="app">
      <header className="topbar topbar-with-centered-search">
        <div>
          <p className="eyebrow">{dict.menu.foods}</p>
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
        </div>
      </header>

      <section className="panel">
        {error ? <div className="alert">{error}</div> : null}
        <div className="table-wrap">
          <table className="foods-lots-main-table">
            <thead>
              <tr>
                <th>{language === "tr" ? "Display ID" : "Display ID"}</th>
                <th>{dict.detail.foodName}</th>
                <th>{dict.detail.foodSeller}</th>
                <th>{dict.detail.foodStatus}</th>
                <th>{dict.detail.foodPrice}</th>
                <th>{dict.detail.updatedAtLabel}</th>
                <th>{dict.detail.lotSummary}</th>
                <th>{dict.detail.lotActions}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8}>{dict.common.loading}</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8}>{dict.common.noRecords}</td>
                </tr>
              ) : (
                rows.map((food) => {
                  const lots = lotsByFoodId[food.id] ?? [];
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
                        <td>
                          <button
                            className="ghost"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              const next = !foodExpanded;
                              setExpandedFoodIds((prev) => ({ ...prev, [food.id]: next }));
                              if (next && !lotsByFoodId[food.id] && !lotsLoadingByFoodId[food.id]) {
                                void loadFoodLots(food.id);
                              }
                            }}
                          >
                            {foodExpanded ? dict.detail.hideLots : dict.detail.showLots}
                          </button>
                        </td>
                      </tr>
                      {foodExpanded ? (
                        <tr className="foods-lots-expanded-row">
                          <td colSpan={8}>
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
          <div className="buyer-ops-modal foods-detail-modal" onClick={(event) => event.stopPropagation()}>
            <h3>{language === "tr" ? "Yemek Detayı" : "Food Details"}</h3>
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
              <h4>{language === "tr" ? "Yemek Açıklaması" : "Food Description"}</h4>
              <pre>{toPrettyJson(selectedFood.description)}</pre>
            </div>
            <div className="foods-detail-text-block">
              <h4>{language === "tr" ? "Tarif" : "Recipe"}</h4>
              <pre>{toPrettyJson(selectedFood.recipe)}</pre>
            </div>
            <div className="foods-detail-text-block">
              <h4>{language === "tr" ? "İçerikler" : "Ingredients"}</h4>
              <pre>{toPrettyJson(selectedFood.ingredientsJson)}</pre>
            </div>
            <div className="foods-detail-text-block">
              <h4>{language === "tr" ? "Alerjen Durumu" : "Allergen Status"}</h4>
              <div className="foods-allergen-status-list">
                {selectedFoodAllergenSummary.map((row) => {
                  const tone =
                    row.status === "contains"
                      ? "is-danger"
                      : row.status === "may"
                        ? "is-warning"
                        : row.status === "free"
                          ? "is-success"
                          : "is-neutral";
                  const statusText =
                    row.status === "contains"
                      ? language === "tr"
                        ? "İçerir"
                        : "Contains"
                      : row.status === "may"
                        ? language === "tr"
                          ? "İçerebilir"
                          : "May contain"
                        : row.status === "free"
                          ? language === "tr"
                            ? "İçermez"
                            : "Free from"
                          : row.status === "mentioned"
                            ? language === "tr"
                              ? "Bahsedildi"
                              : "Mentioned"
                            : language === "tr"
                              ? "Belirsiz"
                              : "Unknown";
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
            </div>
            <div className="foods-detail-text-block">
              <h4>{language === "tr" ? "Ham Alerjen Verisi" : "Raw Allergen Data"}</h4>
              <pre>{toPrettyJson(selectedFood.allergensJson)}</pre>
            </div>
            <div className="foods-detail-text-block">
              <h4>{language === "tr" ? "Lot Özeti" : "Lots Summary"}</h4>
              {(lotsByFoodId[selectedFood.id] ?? []).length === 0 ? (
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
                      {(lotsByFoodId[selectedFood.id] ?? []).map((lot) => (
                        <tr key={`modal-lot-${lot.id}`}>
                          <td>{lot.lot_number}</td>
                          <td>{lotLifecycleLabel(lot.lifecycle_status, language)}</td>
                          <td>{`${lot.quantity_available}/${lot.quantity_produced}`}</td>
                          <td>{formatUiDate(lot.produced_at, language)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="buyer-ops-modal-actions">
              <button className="primary" type="button" onClick={() => setSelectedFood(null)}>
                {language === "tr" ? "Kapat" : "Close"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
