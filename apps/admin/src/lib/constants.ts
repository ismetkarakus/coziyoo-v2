import type { BuyerSmartFilterKey } from "../types/users";
import type { SellerSmartFilterKey } from "../types/seller";

export const BUYER_SMART_FILTER_ITEMS: Array<{ key: BuyerSmartFilterKey; label: string; icon: string }> = [
  { key: "daily_buyer", label: "Gunun Alicisi", icon: "☀" },
  { key: "top_revenue", label: "En Fazla Ciro", icon: "₺" },
  { key: "suspicious_login", label: "Supheli Giris", icon: "◉" },
  { key: "same_ip_multi_account", label: "Ayni IP'de Iki Giris", icon: "⌁" },
  { key: "complainers", label: "En Cok Sikayet Eden Alicilar", icon: "✉" },
];

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
