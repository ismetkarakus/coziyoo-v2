export type AdminUser = {
  id: string;
  email: string;
  role: "admin" | "super_admin";
  is_active?: boolean;
  last_login_at?: string | null;
};

export type Tokens = {
  accessToken: string;
  refreshToken: string;
};

export type ApiError = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

export type Language = "tr" | "en";

import type en from "../i18n/en.json";
export type Dictionary = typeof en;

export type GlobalSearchResultKind = "seller" | "buyer" | "food" | "order" | "lot" | "complaint";
export type GlobalSearchResultItem = {
  kind: GlobalSearchResultKind;
  id: string;
  primaryText: string;
  secondaryText: string;
  targetPath: string;
};
