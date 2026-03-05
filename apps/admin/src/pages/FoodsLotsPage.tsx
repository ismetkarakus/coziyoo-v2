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
  const pageSize = 20;

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
              placeholder={dict.entities.searchPlaceholder}
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
                      <tr>
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
                            onClick={() => {
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
    </div>
  );
}
