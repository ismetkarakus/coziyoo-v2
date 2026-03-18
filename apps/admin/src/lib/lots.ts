import { request, parseJson } from "./api";
import type { AdminLotRow, AdminLotLifecycleStatus, FoodLotDiff } from "../types/lots";
import type { ApiError, Language } from "../types/core";

export function toReadableText(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return "-";
    if (text.startsWith("{") || text.startsWith("[")) {
      try { return toReadableText(JSON.parse(text)); } catch { return text; }
    }
    return text;
  }
  if (Array.isArray(value)) {
    const parts = value.map((item) => toReadableText(item)).map((item) => item.trim()).filter((item) => item && item !== "-");
    return parts.length > 0 ? parts.join(", ") : "-";
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => { const n = toReadableText(item); return n && n !== "-" ? `${key}: ${n}` : ""; })
      .filter(Boolean);
    return entries.length > 0 ? entries.join(", ") : "-";
  }
  return String(value);
}

function normalizeText(value: unknown): string {
  return String(value ?? "").toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function toDiffItems(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return [];
    if (text.startsWith("{") || text.startsWith("[")) {
      try { return toDiffItems(JSON.parse(text)); } catch { return text.split(/[,\n]+/g).map((i) => i.trim()).filter(Boolean); }
    }
    return text.split(/[,\n]+/g).map((i) => i.trim()).filter(Boolean);
  }
  if (Array.isArray(value)) return value.flatMap((item) => toDiffItems(item));
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
      if (typeof item === "boolean") return item ? [key] : [];
      const text = toReadableText(item).trim();
      return text && text !== "-" ? [`${key}: ${text}`] : [];
    });
  }
  return [String(value)];
}

export function computeAddedItems(baseValue: unknown, lotValue: unknown): string[] {
  const baseMap = new Map<string, string>();
  const lotMap = new Map<string, string>();
  for (const item of toDiffItems(baseValue)) {
    const n = normalizeText(item);
    if (n && !baseMap.has(n)) baseMap.set(n, item);
  }
  for (const item of toDiffItems(lotValue)) {
    const n = normalizeText(item);
    if (n && !lotMap.has(n)) lotMap.set(n, item);
  }
  const added: string[] = [];
  for (const [key, value] of lotMap.entries()) {
    if (!baseMap.has(key)) added.push(value);
  }
  return added;
}

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
