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
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default("http://localhost:8081,http://localhost:5173,http://localhost:19006"),
  DATABASE_URL: z.string().url().optional(),
  PGHOST: z.string().min(1).optional(),
  PGPORT: z.coerce.number().int().positive().optional(),
  PGUSER: z.string().min(1).optional(),
  PGPASSWORD: z.string().optional(),
  PGDATABASE: z.string().min(1).optional(),
  DATABASE_SSL_MODE: z.enum(["auto", "disable", "require", "no-verify"]).default("auto"),
  APP_JWT_SECRET: z.string().min(32),
  ADMIN_JWT_SECRET: z.string().min(32),
  PAYMENT_WEBHOOK_SECRET: z.string().min(16),
  PAYMENT_PROVIDER_NAME: z.string().default("mockpay"),
  PAYMENT_CHECKOUT_BASE_URL: z.string().url().default("https://checkout.coziyoo.local/session"),
  LIVEKIT_URL: z.string().url().optional(),
  LIVEKIT_API_KEY: z.string().min(3).optional(),
  LIVEKIT_API_SECRET: z.string().min(8).optional(),
  LIVEKIT_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().max(86_400).default(3600),
  LIVEKIT_AGENT_IDENTITY: z.string().min(3).max(128).default("coziyoo-ai-agent"),
  AI_SERVER_SHARED_SECRET: z.string().min(16).optional(),
  AI_SERVER_URL: z.string().url().optional(),
  AI_SERVER_LIVEKIT_JOIN_PATH: z.string().default("/livekit/agent-session"),
  AI_SERVER_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(10_000),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  DOCS_ENABLED: boolFromEnv.optional(),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

function resolveDatabaseUrl(data: z.infer<typeof EnvSchema>): string {
  if (data.DATABASE_URL) {
    return data.DATABASE_URL;
  }

  const missing = ["PGHOST", "PGUSER", "PGDATABASE"].filter((key) => !data[key as keyof typeof data]);
  if (missing.length > 0) {
    console.error("Invalid environment variables", {
      DATABASE_URL: ["Provide DATABASE_URL or all of PGHOST, PGUSER, PGDATABASE (PGPORT optional, defaults to 5432)."],
      missing,
    });
    process.exit(1);
  }

  const connection = new URL("postgresql://localhost");
  connection.hostname = data.PGHOST as string;
  connection.port = String(data.PGPORT ?? 5432);
  connection.username = data.PGUSER as string;
  connection.password = data.PGPASSWORD ?? "";
  connection.pathname = `/${data.PGDATABASE as string}`;
  return connection.toString();
}

const docsEnabledDefault = parsed.data.NODE_ENV !== "production";
const databaseUrl = resolveDatabaseUrl(parsed.data);

export const env = {
  ...parsed.data,
  DATABASE_URL: databaseUrl,
  DOCS_ENABLED: parsed.data.DOCS_ENABLED ?? docsEnabledDefault,
};
