export function normalizeDisplayName(value: string): string {
  return value.trim().toLowerCase();
}

const TURKISH_CHAR_MAP: Record<string, string> = {
  "ç": "c",
  "ğ": "g",
  "ı": "i",
  "ö": "o",
  "ş": "s",
  "ü": "u",
};

function toAsciiLower(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[çğıöşü]/g, (ch) => TURKISH_CHAR_MAP[ch] ?? ch);
}

export function normalizeUsername(value: string): string {
  const ascii = toAsciiLower(value);
  const compact = ascii
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9._]/g, "")
    .replace(/[._]{2,}/g, ".")
    .replace(/^[._]+|[._]+$/g, "");
  return compact.slice(0, 30);
}
