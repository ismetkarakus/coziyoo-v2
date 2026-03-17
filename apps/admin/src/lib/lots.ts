import { request, parseJson } from "./api";
import type { AdminLotRow, AdminLotLifecycleStatus, FoodLotDiff } from "../types/lots";
import type { ApiError, Language } from "../types/core";

export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim().toLowerCase();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((key) => `${key}:${stableStringify(obj[key])}`).join(",")}}`;
  }
  return String(value);
}

export function lotSnapshotMissing(lot: AdminLotRow): boolean {
  return !lot.recipe_snapshot || lot.ingredients_snapshot_json == null || lot.allergens_snapshot_json == null;
}

export function computeFoodLotDiff(params: {
  foodRecipe: string | null | undefined;
  foodIngredients: unknown;
  foodAllergens: unknown;
  lot: AdminLotRow;
}): FoodLotDiff {
  const recipeChanged =
    stableStringify(params.foodRecipe) !== stableStringify(params.lot.recipe_snapshot);
  const ingredientsChanged = params.foodIngredients === undefined
    ? false
    : stableStringify(params.foodIngredients) !== stableStringify(params.lot.ingredients_snapshot_json);
  const allergensChanged = params.foodAllergens === undefined
    ? false
    : stableStringify(params.foodAllergens) !== stableStringify(params.lot.allergens_snapshot_json);
  return {
    recipeChanged,
    ingredientsChanged,
    allergensChanged,
    hasMissingSnapshot: lotSnapshotMissing(params.lot),
  };
}

export function lotLifecycleLabel(status: AdminLotLifecycleStatus, language: Language): string {
  if (language === "tr") {
    if (status === "on_sale") return "Satışta";
    if (status === "expired") return "Süresi Geçti";
    if (status === "depleted") return "Tükendi";
    if (status === "recalled") return "Geri Çağrıldı";
    if (status === "discarded") return "İmha Edildi";
    return "Satışta";
  }
  if (status === "on_sale") return "On Sale";
  if (status === "expired") return "Expired";
  if (status === "depleted") return "Depleted";
  if (status === "recalled") return "Recalled";
  if (status === "discarded") return "Discarded";
  return "On Sale";
}

export function lotLifecycleClass(status: AdminLotLifecycleStatus): string {
  if (status === "on_sale") return "is-success";
  if (status === "expired" || status === "depleted") return "is-disabled";
  if (status === "recalled" || status === "discarded") return "is-danger";
  return "is-neutral";
}

export async function fetchAllAdminLots(filters: { sellerId?: string; foodId?: string }): Promise<AdminLotRow[]> {
  const rows: AdminLotRow[] = [];
  let page = 1;
  while (true) {
    const query = new URLSearchParams({
      page: String(page),
      pageSize: "100",
      ...(filters.sellerId ? { sellerId: filters.sellerId } : {}),
      ...(filters.foodId ? { foodId: filters.foodId } : {}),
    });
    const response = await request(`/v1/admin/lots?${query.toString()}`);
    if (response.status !== 200) {
      const body = await parseJson<ApiError>(response);
      throw new Error(body.error?.message ?? "LOTS_FETCH_FAILED");
    }
    const body = await parseJson<{
      data: AdminLotRow[];
      pagination?: { totalPages?: number };
    }>(response);
    rows.push(...(body.data ?? []));
    const totalPages = Number(body.pagination?.totalPages ?? 1);
    if (page >= totalPages) break;
    page += 1;
  }
  return rows;
}
