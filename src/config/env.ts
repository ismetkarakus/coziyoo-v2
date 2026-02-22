import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: ".env.local" });
dotenv.config();

const boolFromEnv = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === "boolean") return value;
    const normalized = value.toLowerCase().trim();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  });

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  APP_JWT_SECRET: z.string().min(32),
  ADMIN_JWT_SECRET: z.string().min(32),
  PAYMENT_WEBHOOK_SECRET: z.string().min(16),
  PAYMENT_PROVIDER_NAME: z.string().default("mockpay"),
  PAYMENT_CHECKOUT_BASE_URL: z.string().url().default("https://checkout.coziyoo.local/session"),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  DOCS_ENABLED: boolFromEnv.optional(),
  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().min(1).default("ministral-3:8b"),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const docsEnabledDefault = parsed.data.NODE_ENV !== "production";

export const env = {
  ...parsed.data,
  DOCS_ENABLED: parsed.data.DOCS_ENABLED ?? docsEnabledDefault,
};
