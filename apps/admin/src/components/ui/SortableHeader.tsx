import type { SortDir } from "../../lib/sort";

export function SortableHeader({
  label,
  active,
  dir,
  onClick,
  ariaLabel,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  ariaLabel?: string;
}) {
  return (
    <button type="button" className={`table-sort-btn ${active ? "is-active" : ""}`} aria-label={ariaLabel ?? label} onClick={onClick}>
      <span className="table-sort-arrows" aria-hidden="true">
        <span className={`sort-up ${active && dir === "asc" ? "is-active" : ""}`}>▲</span>
        <span className={`sort-down ${active && dir === "desc" ? "is-active" : ""}`}>▼</span>
      </span>
      <span>{label}</span>
    </button>
  );
}
