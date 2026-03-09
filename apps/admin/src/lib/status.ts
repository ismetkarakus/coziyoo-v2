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

export function orderStatusLabel(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized.includes("cancel")) return "İptal";
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
