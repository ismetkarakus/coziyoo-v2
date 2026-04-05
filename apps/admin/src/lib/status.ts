export function paymentBadge(status: string): { text: string; cls: string } {
  const normalized = status.toLowerCase();
  if (normalized.includes("fail") || normalized.includes("cancel") || normalized.includes("declin")) {
    return { text: "Başarısız", cls: "is-failed" };
  }
  if (normalized.includes("pending") || normalized.includes("wait")) {
    return { text: "Bekliyor", cls: "is-pending" };
  }
  if (normalized.includes("confirm") || normalized.includes("capture") || normalized.includes("success") || normalized.includes("paid")) {
    return { text: "Ödeme Alındı", cls: "is-success" };
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

export function deliveryTypeLabel(value: unknown): "Getir" | "Gel Al" | "-" {
  const normalized = normalizeDeliveryType(value);
  if (normalized === "delivery") return "Getir";
  if (normalized === "pickup") return "Gel Al";
  return "-";
}

export function orderStatusLabel(status: string, deliveryType?: string | null): string {
  const normalized = status.toLowerCase();
  const delivery = normalizeDeliveryType(deliveryType);
  if (normalized === "pending_seller_approval") return "Satıcı Onayı Bekliyor";
  if (normalized === "seller_approved") return "Sipariş Onaylandı";
  if (normalized === "awaiting_payment") return "Ödeme Bekleniyor";
  if (normalized === "paid") return "Ödeme Alındı";
  if (normalized === "preparing") return "Hazırlanıyor";
  if (delivery === "pickup" && normalized === "ready") return "Hazırlandı, seni bekliyor";
  if (delivery === "pickup" && normalized === "in_delivery") return "Yola Çıktı";
  if (delivery === "pickup" && normalized === "approaching") return "Geliyorum";
  if (delivery === "pickup" && normalized === "at_door") return "Kapıdayım";
  if (normalized === "rejected" || normalized.includes("cancel")) return "İptal";
  if (normalized === "at_door") return "Kapıda";
  if (normalized.includes("deliver")) return "Teslim Edildi";
  if (normalized.includes("done")) return "Tamamlandı";
  if (normalized.includes("approve")) return "Onaylandı";
  if (normalized.includes("pending")) return "Bekliyor";
  return status;
}

export function sellerDecisionStateLabel(value: string | null | undefined): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "pending") return "Karar Bekliyor";
  if (normalized === "revised") return "Plan Güncellendi";
  if (normalized === "approved") return "Onaylandı";
  if (normalized === "rejected") return "İptal";
  return normalized ? normalized.replace(/_/g, " ") : "-";
}

export function trendMeta(current: number, previous: number): { arrow: string; className: "is-up" | "is-down" | "is-flat" } {
  if (current > previous) return { arrow: "▲", className: "is-up" };
  if (current < previous) return { arrow: "▼", className: "is-down" };
  return { arrow: "→", className: "is-flat" };
}
