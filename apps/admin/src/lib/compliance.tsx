import { type ReactNode } from "react";
import { formatUiDate, maskPhone } from "./format";
import type { Dictionary, Language } from "../types/core";
import type {
  SellerCompliancePayload,
  SellerComplianceStatus,
  SellerComplianceDocumentStatus,
  OptionalUploadStatus,
  ComplianceRowKey,
  ComplianceTone,
  ComplianceRowViewModel,
  ComplianceSource,
} from "../types/seller";

export function extractPhoneFromChecks(payload: SellerCompliancePayload | null): string | null {
  if (!payload) return null;
  for (const check of payload.checks) {
    const code = check.check_code.toLowerCase();
    if (!code.includes("phone") && !code.includes("telefon")) continue;
    const raw = check.value_json;
    if (typeof raw === "string") return raw;
    if (raw && typeof raw === "object") {
      const valueObj = raw as Record<string, unknown>;
      const candidates = [valueObj.phone, valueObj.telephone, valueObj.value, valueObj.number];
      for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) return candidate;
      }
    }
  }
  return null;
}

export function normalizeComplianceToken(value: string | null | undefined): string {
  const raw = String(value ?? "")
    .toLowerCase()
    .replace(/[ç]/g, "c")
    .replace(/[ğ]/g, "g")
    .replace(/[ı]/g, "i")
    .replace(/[ö]/g, "o")
    .replace(/[ş]/g, "s")
    .replace(/[ü]/g, "u")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return raw;
}

export function pickComplianceSourceDate(source: ComplianceSource): string | null {
  return source.reviewedAt || source.uploadedAt || source.updatedAt || null;
}

export function complianceToneFromStatus(status: string | null | undefined): ComplianceTone {
  const normalized = normalizeComplianceToken(status);
  if (!normalized) return "warning";
  if (["verified", "approved", "active", "completed", "tamamlandi"].includes(normalized)) return "success";
  if (["rejected", "declined", "failed", "expired"].includes(normalized)) return "danger";
  if (["pending", "requested", "uploaded", "submitted", "under_review", "in_progress", "not_started", "unknown"].includes(normalized)) return "warning";
  return "neutral";
}

export function complianceLabelFromTone(tone: ComplianceTone, dict: Dictionary, sourceType: "document" | "check" | "fallback"): string {
  if (tone === "success") return dict.detail.sellerStatus.verified;
  if (tone === "danger") return dict.detail.sellerStatus.rejected;
  if (tone === "warning" && sourceType === "check") return dict.detail.sellerStatus.underReview;
  return dict.detail.sellerStatus.pending;
}

export function profileBadgeFromStatus(
  status: SellerComplianceStatus | null | undefined,
  dict: Dictionary
): { label: string; tone: ComplianceTone } {
  if (!status) return { label: dict.detail.legalProfileBadge.pending, tone: "warning" };
  if (status === "approved") return { label: dict.detail.legalProfileBadge.completed, tone: "success" };
  if (status === "rejected") return { label: dict.detail.legalProfileBadge.rejected, tone: "danger" };
  if (status === "under_review") return { label: dict.detail.legalProfileBadge.inReview, tone: "warning" };
  return { label: dict.detail.legalProfileBadge.pending, tone: "warning" };
}

export function sellerDocumentStatusLabel(status: SellerComplianceDocumentStatus, dict: Dictionary): string {
  if (status === "approved") return dict.detail.sellerStatus.approved;
  if (status === "rejected") return dict.detail.sellerStatus.rejected;
  if (status === "expired") return dict.detail.sellerStatus.expired;
  if (status === "uploaded") return dict.detail.sellerStatus.uploaded;
  return dict.detail.sellerStatus.requested;
}

export function sellerDocumentStatusTone(status: SellerComplianceDocumentStatus): ComplianceTone {
  if (status === "approved") return "success";
  if (status === "rejected") return "danger";
  if (status === "expired") return "danger";
  if (status === "uploaded") return "warning";
  return "neutral";
}

export function optionalUploadStatusLabel(status: OptionalUploadStatus, dict: Dictionary): string {
  if (status === "approved") return dict.detail.sellerStatus.approved;
  if (status === "rejected") return dict.detail.sellerStatus.rejected;
  if (status === "expired") return dict.detail.sellerStatus.expired;
  if (status === "uploaded") return dict.detail.sellerStatus.uploaded;
  return dict.detail.optionalArchived;
}

export function optionalUploadStatusTone(status: OptionalUploadStatus): ComplianceTone {
  if (status === "approved") return "success";
  if (status === "rejected") return "danger";
  if (status === "expired") return "danger";
  if (status === "uploaded") return "warning";
  return "neutral";
}

export function knownDocumentCodeRank(code: string): number {
  const normalized = normalizeComplianceToken(code);
  const order = [
    "food_business",
    "tax_plate",
    "kvkk",
    "food_safety_training",
    "phone_verification",
    "workplace_insurance",
  ];
  const index = order.findIndex((item) => normalized.includes(item));
  return index >= 0 ? index : 999;
}

export function mapComplianceRows(
  payload: SellerCompliancePayload | null,
  dict: Dictionary,
  language: Language
): ComplianceRowViewModel[] {
  const docs = (payload?.documents ?? []).filter((item) => item.is_current);
  const checks = payload?.checks ?? [];

  const docByKey = new Map<ComplianceRowKey, ComplianceSource>();
  const docMetaByKey = new Map<ComplianceRowKey, { id: string; fileUrl: string | null; status: SellerComplianceDocumentStatus }>();
  const checkByKey = new Map<ComplianceRowKey, ComplianceSource>();

  const keyMatchers: Array<{ key: ComplianceRowKey; tokens: string[] }> = [
    { key: "foodBusiness", tokens: ["gida_isletme", "isletme_belgesi", "food_business", "business_license", "food_license"] },
    { key: "taxPlate", tokens: ["vergi_levhasi", "tax_plate", "tax_document", "tax", "vergi"] },
    { key: "kvkk", tokens: ["kvkk", "privacy", "kisisel_veri", "gdpr"] },
    { key: "foodSafetyTraining", tokens: ["gida_guvenligi_egitimi", "food_safety_training", "hygiene_training", "egitim"] },
    { key: "phoneVerification", tokens: ["telefon", "phone", "sms", "phone_verification", "telefon_dogrulama"] },
    { key: "workplaceInsurance", tokens: ["is_yeri_sigortasi", "workplace_insurance", "insurance", "sigorta"] },
  ];

  const resolveKey = (value: string): ComplianceRowKey | null => {
    for (const item of keyMatchers) {
      if (item.tokens.some((token) => value.includes(token))) return item.key;
    }
    return null;
  };

  const sourceSortStamp = (source: ComplianceSource | null | undefined): number => {
    const raw = source?.reviewedAt ?? source?.uploadedAt ?? source?.updatedAt ?? null;
    if (!raw) return 0;
    const time = Date.parse(raw);
    return Number.isNaN(time) ? 0 : time;
  };

  const pickNewerSource = (prev: ComplianceSource | undefined, next: ComplianceSource): ComplianceSource => {
    if (!prev) return next;
    const prevStamp = sourceSortStamp(prev);
    const nextStamp = sourceSortStamp(next);
    if (nextStamp >= prevStamp) return next;
    return prev;
  };

  for (const doc of docs) {
    const normalizedType = normalizeComplianceToken(doc.doc_type);
    const normalizedCode = normalizeComplianceToken(doc.code);
    const normalizedName = normalizeComplianceToken(doc.name);
    const rowKey = resolveKey(normalizedType) ?? resolveKey(normalizedCode) ?? resolveKey(normalizedName);
    if (!rowKey) continue;
    const nextSource: ComplianceSource = {
      status: doc.status,
      reviewedAt: doc.reviewed_at,
      uploadedAt: doc.uploaded_at,
      updatedAt: null,
    };
    const chosen = pickNewerSource(docByKey.get(rowKey), nextSource);
    docByKey.set(rowKey, chosen);
    if (chosen === nextSource) {
      docMetaByKey.set(rowKey, {
        id: doc.id,
        fileUrl: doc.file_url,
        status: doc.status,
      });
    }
  }

  for (const check of checks) {
    const normalizedCode = normalizeComplianceToken(check.check_code);
    const rowKey = resolveKey(normalizedCode);
    if (!rowKey) continue;
    let phoneValue: string | null = null;
    if (rowKey === "phoneVerification") {
      const raw = check.value_json;
      if (typeof raw === "string") phoneValue = raw;
      else if (raw && typeof raw === "object") {
        const valueObj = raw as Record<string, unknown>;
        const candidate = [valueObj.phone, valueObj.telephone, valueObj.number, valueObj.value].find(
          (entry) => typeof entry === "string" && entry.trim()
        );
        phoneValue = (candidate as string | undefined) ?? null;
      }
    }
    const nextSource: ComplianceSource = {
      status: check.status,
      reviewedAt: null,
      uploadedAt: null,
      updatedAt: check.updated_at,
      phoneValue,
    };
    checkByKey.set(rowKey, pickNewerSource(checkByKey.get(rowKey), nextSource));
  }

  const rowMeta: Array<{ key: ComplianceRowKey; label: string; optional?: boolean }> = [
    { key: "foodBusiness", label: dict.detail.complianceRows.foodBusiness },
    { key: "taxPlate", label: dict.detail.complianceRows.taxPlate },
    { key: "kvkk", label: dict.detail.complianceRows.kvkk },
    { key: "foodSafetyTraining", label: dict.detail.complianceRows.foodSafetyTraining },
    { key: "workplaceInsurance", label: dict.detail.complianceRows.workplaceInsurance, optional: true },
  ];

  return rowMeta.map((meta) => {
    const documentSource = docByKey.get(meta.key) ?? null;
    const checkSource = checkByKey.get(meta.key) ?? null;
    const source = documentSource ?? checkSource ?? null;
    const sourceType: "document" | "check" | "fallback" = documentSource ? "document" : checkSource ? "check" : "fallback";
    const isDocumentSource = sourceType === "document" && Boolean(source?.status);
    const documentStatus = (source?.status ?? "requested") as SellerComplianceDocumentStatus;
    const tone = isDocumentSource ? sellerDocumentStatusTone(documentStatus) : complianceToneFromStatus(source?.status ?? null);
    const statusLabel = isDocumentSource
      ? sellerDocumentStatusLabel(documentStatus, dict)
      : tone === "success" && sourceType === "check"
        ? dict.detail.sellerStatus.validated
        : complianceLabelFromTone(tone, dict, sourceType);
    const date = pickComplianceSourceDate(
      source ?? {
        status: null,
        reviewedAt: null,
        uploadedAt: null,
        updatedAt: null,
      }
    );
    const dateText = formatUiDate(date, language);
    const phoneText = meta.key === "phoneVerification" ? maskPhone(source?.phoneValue ?? null) : null;
    const detailText = phoneText && phoneText !== "-" ? `${statusLabel} • ${phoneText}` : dateText !== "-" ? `${statusLabel} • ${dateText}` : statusLabel;
    const docMeta = docMetaByKey.get(meta.key);
    return {
      key: meta.key,
      label: meta.label,
      statusLabel,
      tone,
      detailText,
      isOptional: meta.optional,
      sourceType,
      sourceDocumentId: docMeta?.id ?? null,
      sourceFileUrl: docMeta?.fileUrl ?? null,
      sourceDocumentStatus: docMeta?.status ?? null,
    };
  });
}

export function renderJsonLine(line: string): ReactNode {
  const match = line.match(/^(\s*)"([^"]+)":\s(.+?)(,?)$/);
  if (!match) return <code>{line}</code>;
  const [, indent, key, rawValue, comma] = match;
  const value = rawValue.trim();
  let valueClass = "json-value-plain";
  if (value.startsWith("\"")) valueClass = "json-value-string";
  else if (value === "true" || value === "false") valueClass = "json-value-bool";
  else if (value === "null") valueClass = "json-value-null";
  else if (/^-?\d/.test(value)) valueClass = "json-value-number";
  return (
    <code>
      {indent}
      <span className="json-key">"{key}"</span>
      <span className="json-sep">: </span>
      <span className={valueClass}>{value}</span>
      {comma}
    </code>
  );
}

export function initialsFromName(displayName: string | null | undefined, email: string | null | undefined): string {
  const source = String(displayName || email || "").trim();
  if (!source) return "U";
  const pieces = source.split(/\s+/).filter(Boolean);
  if (pieces.length >= 2) return `${pieces[0][0]}${pieces[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export function openQuickEmail(email: string | null | undefined, dict: Dictionary, setMessage?: (message: string | null) => void) {
  const normalizedEmail = String(email ?? "").trim();
  if (!normalizedEmail || !normalizedEmail.includes("@")) return;

  try {
    window.location.href = `mailto:${encodeURIComponent(normalizedEmail)}`;
  } catch {
    navigator.clipboard
      .writeText(normalizedEmail)
      .then(() => setMessage?.(`${dict.detail.emailOpenFailed} ${dict.detail.emailCopied}`))
      .catch(() => setMessage?.(dict.detail.emailOpenFailed));
    return;
  }

  window.setTimeout(() => {
    if (document.visibilityState !== "visible") return;
    navigator.clipboard
      .writeText(normalizedEmail)
      .then(() => setMessage?.(`${dict.detail.emailOpenFailed} ${dict.detail.emailCopied}`))
      .catch(() => setMessage?.(dict.detail.emailOpenFailed));
  }, 700);
}
