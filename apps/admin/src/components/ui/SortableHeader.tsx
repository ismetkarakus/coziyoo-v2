import type { SortDir } from "../../lib/sort";

export function SortableHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`table-sort-btn ${active ? "is-active" : ""}`} aria-label={`${label} sırala`} onClick={onClick}>
      <span>{label}</span>
      <span className="table-sort-arrows" aria-hidden="true">
        <span className={`sort-up ${active && dir === "asc" ? "is-active" : ""}`}>▲</span>
        <span className={`sort-down ${active && dir === "desc" ? "is-active" : ""}`}>▼</span>
      </span>
    </button>
  );
}
