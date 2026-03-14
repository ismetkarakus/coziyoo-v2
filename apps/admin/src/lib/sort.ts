export type SortDir = "asc" | "desc";

export type TableSortState<K extends string> = {
  key: K | null;
  dir: SortDir;
};

export function toggleSort<K extends string>(prev: TableSortState<K>, key: K): TableSortState<K> {
  return {
    key,
    dir: prev.key === key && prev.dir === "asc" ? "desc" : "asc",
  };
}

export function compareSortValues(left: string | number, right: string | number): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), "tr", { sensitivity: "base" });
}

export function compareWithDir(left: string | number, right: string | number, dir: SortDir): number {
  const result = compareSortValues(left, right);
  return dir === "asc" ? result : -result;
}
