import type { SellerDetailTab } from "../types/seller";
import type { BuyerDetailTab } from "../types/users";

export function resolveSellerDetailTab(value: string | null | undefined): SellerDetailTab {
  if (value === "general") return "general";
  if (value === "foods") return "foods";
  if (value === "orders") return "orders";
  if (value === "wallet") return "wallet";
  if (value === "legal") return "legal";
  if (value === "retention") return "retention";
  if (value === "security") return "security";
  if (value === "raw") return "raw";
  return "identity";
}

export function resolveBuyerDetailTab(value: string | null | undefined): BuyerDetailTab {
  if (value === "payments") return "payments";
  if (value === "complaints") return "complaints";
  if (value === "reviews") return "reviews";
  if (value === "activity") return "activity";
  if (value === "notes") return "notes";
  if (value === "raw") return "raw";
  return "orders";
}

function restoreRedirectPathFromQuery() {
  const url = new URL(window.location.href);
  const redirectedPath = url.searchParams.get("__redirect");
  if (!redirectedPath) return;

  url.searchParams.delete("__redirect");
  const cleanedQuery = url.searchParams.toString();
  const cleanedPath = decodeURIComponent(redirectedPath);
  const nextUrl = `${cleanedPath}${cleanedQuery ? `?${cleanedQuery}` : ""}`;
  window.history.replaceState(null, "", nextUrl);
}

restoreRedirectPathFromQuery();
