import type { Dictionary, Language } from "../types/core";

export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ""));
}

export function formatTableHeader(column: string): string {
  if (column.toLowerCase() === "image_url") return "image";
  return column.replace(/_/g, " ");
}

export function toDisplayId(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (!text) return "-";
  return text.length > 10 ? `${text.slice(0, 10)}…` : text;
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
