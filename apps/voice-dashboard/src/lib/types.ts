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
