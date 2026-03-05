export function renderCell(value: unknown, columnName?: string): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    const raw = value.trim();
    const normalizedColumn = String(columnName ?? "").trim().toLowerCase();
    const imageColumn = normalizedColumn === "image_url" || normalizedColumn === "imageurl";
    const imageUrlPattern = /^(https?:\/\/\S+|\/\S+)\.(?:png|jpe?g|gif|webp|svg)(?:\?\S*)?$/i;
    if (imageColumn || imageUrlPattern.test(raw)) {
      return raw;
    }
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
