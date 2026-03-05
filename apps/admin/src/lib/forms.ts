import { z } from "zod";

export const AppUserFormSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(3),
  userType: z.enum(["buyer", "seller", "both"]),
  fullName: z.string().optional(),
  countryCode: z.string().min(2).max(3).optional(),
  language: z.string().min(2).max(10).optional(),
});

export const AdminUserFormSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["admin", "super_admin"]),
});
