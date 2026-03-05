export type UserKind = "app" | "buyers" | "sellers" | "admin";

export type ColumnMeta = {
  name: string;
  displayable: boolean;
  sensitivity: "public" | "internal" | "secret";
};

export type DensityMode = "compact" | "normal" | "comfortable";

export type BuyerDetailTab = "orders" | "payments" | "complaints" | "reviews" | "activity" | "notes" | "raw";

export type BuyerSmartFilterKey =
  | "daily_buyer"
  | "top_revenue"
  | "suspicious_login"
  | "same_ip_multi_account"
  | "risky_seller_complaints"
  | "complainers";
