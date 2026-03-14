import type { SellerSmartFilterKey } from "../types/seller";

export const SELLER_SMART_FILTER_ITEMS: Array<{ key: SellerSmartFilterKey; label: string; icon: string }> = [
  { key: "login_anomaly", label: "Tüm Kayıtlar", icon: "☰" },
  { key: "pending_approvals", label: "Onay Bekleyenler", icon: "☑" },
  { key: "missing_documents", label: "Eksik Belgesi Olanlar", icon: "⚠" },
  { key: "suspicious_logins", label: "Şüpheli Girişler", icon: "◉" },
  { key: "complaining_sellers", label: "En Çok Şikayet Eden Satıcılar", icon: "✎" },
  { key: "complainer_sellers", label: "En Çok Şikayet Alan Satıcılar", icon: "✉" },
  { key: "top_selling_foods", label: "En Çok Satan Yemekler", icon: "🍽" },
  { key: "top_revenue", label: "En Çok Ciro Yapan", icon: "₺" },
  { key: "performance_drop", label: "Düşen Performans", icon: "◔" },
  { key: "urgent_action", label: "Acil Müdahale", icon: "⚑" },
];
