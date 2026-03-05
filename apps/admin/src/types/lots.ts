export type AdminLotLifecycleStatus = "on_sale" | "planned" | "expired" | "depleted" | "recalled" | "discarded" | "open";
export type AdminLotStatus = "open" | "locked" | "depleted" | "recalled" | "discarded" | "expired";

export type AdminLotRow = {
  id: string;
  seller_id: string;
  food_id: string;
  lot_number: string;
  produced_at: string;
  sale_starts_at: string;
  sale_ends_at: string;
  use_by: string | null;
  best_before: string | null;
  recipe_snapshot: string | null;
  ingredients_snapshot_json: unknown;
  allergens_snapshot_json: unknown;
  quantity_produced: number;
  quantity_available: number;
  status: AdminLotStatus;
  lifecycle_status: AdminLotLifecycleStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminLotOrderRow = {
  order_id: string;
  status: string;
  created_at: string;
  buyer_id: string;
  seller_id: string;
  quantity_allocated: number;
};

export type FoodLotDiff = {
  recipeChanged: boolean;
  ingredientsChanged: boolean;
  allergensChanged: boolean;
  hasMissingSnapshot: boolean;
};
