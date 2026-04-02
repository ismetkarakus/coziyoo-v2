export type CanonicalDeliveryType = "pickup" | "delivery";

export function normalizeDeliveryType(value: unknown): CanonicalDeliveryType | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const normalized = raw
    .toLocaleLowerCase("tr-TR")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return null;

  if (normalized.includes("pickup") || normalized.includes("gel al")) return "pickup";
  if (normalized.includes("delivery") || normalized.includes("teslimat")) return "delivery";

  const hasRestaurantToken = normalized.includes("restaurant") || normalized.includes("restoran") || normalized.includes("restorandan");
  if (hasRestaurantToken) {
    if (normalized.includes("teslim")) return "delivery";
    return "pickup";
  }

  return null;
}
