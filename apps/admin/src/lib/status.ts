export function paymentBadge(status: string): { text: string; cls: string } {
  const normalized = status.toLowerCase();
  if (normalized.includes("fail") || normalized.includes("cancel") || normalized.includes("declin")) {
    return { text: "Başarısız", cls: "is-failed" };
  }
  if (normalized.includes("pending") || normalized.includes("wait")) {
    return { text: "Bekliyor", cls: "is-pending" };
  }
  return { text: "Başarılı", cls: "is-success" };
}

export function normalizeDeliveryType(value: unknown): "pickup" | "delivery" | "" {
  const normalized = String(value ?? "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  if (!normalized) return "";
  if (normalized.includes("pickup") || normalized.includes("gel al")) return "pickup";
  if (normalized.includes("delivery") || normalized.includes("teslimat")) return "delivery";
  const hasRestaurantToken = normalized.includes("restaurant") || normalized.includes("restoran") || normalized.includes("restorandan");
  if (hasRestaurantToken) {
    if (normalized.includes("teslim")) return "delivery";
    return "pickup";
  }
  return "";
}

export function deliveryTypeLabel(value: unknown): "Teslimat" | "Gel Al" | "-" {
  const normalized = normalizeDeliveryType(value);
  if (normalized === "delivery") return "Teslimat";
  if (normalized === "pickup") return "Gel Al";
  return "-";
}

export function orderStatusLabel(status: string, deliveryType?: string | null): string {
  const normalized = status.toLowerCase();
  const delivery = normalizeDeliveryType(deliveryType);
  if (delivery === "pickup" && normalized === "ready") return "Hazırlandı, seni bekliyor";
  if (delivery === "pickup" && normalized === "in_delivery") return "Yola Çıktı";
  if (delivery === "pickup" && normalized === "approaching") return "Geliyorum";
  if (delivery === "pickup" && normalized === "at_door") return "Kapıdayım";
  if (normalized.includes("cancel")) return "İptal";
  if (normalized === "at_door") return "Kapıda";
  if (normalized.includes("deliver")) return "Teslim Edildi";
  if (normalized.includes("done")) return "Tamamlandı";
  if (normalized.includes("approve")) return "Onaylandı";
  if (normalized.includes("pending")) return "Bekliyor";
  return status;
}

export function trendMeta(current: number, previous: number): { arrow: string; className: "is-up" | "is-down" | "is-flat" } {
  if (current > previous) return { arrow: "▲", className: "is-up" };
  if (current < previous) return { arrow: "▼", className: "is-down" };
  return { arrow: "→", className: "is-flat" };
}
