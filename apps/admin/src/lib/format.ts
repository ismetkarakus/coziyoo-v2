import type { Dictionary, Language } from "../types/core";

export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ""));
}

export function formatTableDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${d}/${m}/${y} ${h}:${min}`;
}

export function formatTableHeader(column: string): string {
  if (column.toLowerCase() === "image_url") return "image";
  return column.replace(/_/g, " ");
}

export function toDisplayId(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (!text) return "-";
  return text;
}

export function adminRoleLabel(dict: Dictionary, value: "admin" | "super_admin"): string {
  return value === "admin" ? dict.users.roleAdmin : dict.users.roleSuperAdmin;
}

export function maskEmail(value: string | null | undefined): string {
  const email = String(value ?? "").trim();
  const [local, domain] = email.split("@");
  if (!local || !domain) return email || "-";
  const head = local.slice(0, Math.min(3, local.length));
  return `${head}***@${domain}`;
}

export function maskPhone(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "-";
  if (digits.length < 10) return "***";
  const base = digits.startsWith("90") ? digits.slice(2) : digits;
  const normalized = base.padEnd(10, "x").slice(0, 10);
  return `+90 ${normalized.slice(0, 3)} ${normalized.slice(3, 6)} ${normalized.slice(6, 8)} ${normalized.slice(8, 10)}`.replace(
    /\d/g,
    (char, index) => {
      if (index < 8) return char;
      return "x";
    }
  );
}

export function addTwoYears(value: string | null | undefined): string | null {
  const date = Date.parse(String(value ?? ""));
  if (Number.isNaN(date)) return null;
  const next = new Date(date);
  next.setFullYear(next.getFullYear() + 2);
  return next.toISOString();
}

export function formatUiDate(value: string | null | undefined, language: Language): string {
  if (!value) return "-";
  const date = Date.parse(value);
  if (Number.isNaN(date)) return "-";
  return new Date(date).toLocaleDateString(language === "tr" ? "tr-TR" : "en-US");
}

export function foodDateKey(value: string | null | undefined): string | null {
  const date = Date.parse(String(value ?? ""));
  if (Number.isNaN(date)) return null;
  const normalized = new Date(date);
  const year = normalized.getFullYear();
  const month = String(normalized.getMonth() + 1).padStart(2, "0");
  const day = String(normalized.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatCurrency(value: number, language: Language): string {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat(language === "tr" ? "tr-TR" : "en-US", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 2,
  }).format(safe);
}

export function normalizeImageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function sanitizeSeedText(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const cleaned = raw
    .replace(/^LIVE-TR-SEED:\s*/i, "")
    .replace(/^TR-SEED:\s*/i, "")
    .replace(/canli\s*tr\s*menu/gi, "")
    .replace(/otomatik\s*eklenen\s*menu/gi, "")
    .replace(/standart\s*tarif/gi, "")
    .trim();
  return cleaned || null;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("tr-TR");
}

export function formatNoteStamp(value: string | null | undefined, language: Language = "tr"): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(language === "tr" ? "tr-TR" : "en-US", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function toRelativeTimeTR(value: string): string {
  const diff = Date.now() - new Date(value).getTime();
  const hours = Math.max(0, Math.floor(diff / (1000 * 60 * 60)));
  if (hours < 1) return "Şimdi";
  if (hours < 24) return `${hours} saat önce`;
  const days = Math.floor(hours / 24);
  return `${days} gün önce`;
}

export function toRelativeDaysTR(iso: string | null | undefined, missingText: string): string {
  if (!iso) return missingText;
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
  if (days === 0) return "Bugün";
  if (days === 1) return "1 gün önce";
  return `${days} gün önce`;
}

export function toLocalDateKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatCustomDateInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  const day = digits.slice(0, 2);
  const month = digits.slice(2, 4);
  const year = digits.slice(4, 8);
  if (digits.length <= 2) return day;
  if (digits.length <= 4) return `${day}/${month}`;
  return `${day}/${month}/${year}`;
}

export function parseCustomDateToKey(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 8) return "";
  const day = Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  const year = Number(digits.slice(4, 8));
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900) return "";
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function formatLoginRelativeDayMonth(value: string | null | undefined, language: Language): string {
  if (!value) return "-";
  const date = Date.parse(value);
  if (Number.isNaN(date)) return "-";
  const diffMs = Math.max(0, Date.now() - date);
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days < 30) {
    if (language === "tr") return `${days} gun`;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  const months = Math.max(1, Math.floor(days / 30));
  if (language === "tr") return `${months} ay`;
  return `${months} month${months === 1 ? "" : "s"}`;
}
