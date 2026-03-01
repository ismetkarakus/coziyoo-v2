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
  PAYMENT_CHECKOUT_BASE_URL: z.string().url().default("https://checkout.example.com/session"),
  LIVEKIT_URL: z.string().url().optional(),
  LIVEKIT_API_KEY: z.string().min(3).optional(),
  LIVEKIT_API_SECRET: z.string().min(8).optional(),
  LIVEKIT_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().max(86_400).default(3600),
  LIVEKIT_AGENT_IDENTITY: z.string().min(3).max(128).default("coziyoo-ai-agent"),
  AI_SERVER_SHARED_SECRET: z.string().min(16).optional(),
  AI_SERVER_URL: z.string().url().optional(),
  AI_SERVER_LIVEKIT_JOIN_PATH: z.string().default("/livekit/agent-session"),
  AI_SERVER_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(10_000),
  OLLAMA_BASE_URL: z.string().url().default("http://127.0.0.1:11434"),
  OLLAMA_CHAT_MODEL: z.string().min(1).default("llama3.1"),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(30_000),
  OLLAMA_SYSTEM_PROMPT: z.string().default("You are Coziyoo AI assistant. Be concise and helpful."),
  SPEECH_TO_TEXT_BASE_URL: z.string().url().optional(),
  STT_BASE_URL: z.string().url().optional(),
  SPEECH_TO_TEXT_TRANSCRIBE_PATH: z.string().default("/v1/audio/transcriptions"),
  SPEECH_TO_TEXT_MODEL: z.string().default("whisper-1"),
  SPEECH_TO_TEXT_API_KEY: z.string().optional(),
  SPEECH_TO_TEXT_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(60_000),
  SPEECH_TO_TEXT_MAX_AUDIO_BYTES: z.coerce.number().int().positive().max(25_000_000).default(8_000_000),
  TTS_BASE_URL: z.string().url().optional(),
  TTS_F5_BASE_URL: z.string().url().optional(),
  TTS_XTTS_BASE_URL: z.string().url().optional(),
  TTS_CHATTERBOX_BASE_URL: z.string().url().optional(),
  TTS_F5_SYNTH_PATH: z.string().default("/api/tts"),
  TTS_XTTS_SYNTH_PATH: z.string().default("/tts"),
  TTS_CHATTERBOX_SYNTH_PATH: z.string().default("/tts"),
  TTS_LANGUAGE_DEFAULT: z.string().min(2).max(16).default("tr"),
  TTS_SPEAKER_ID: z.string().min(1).default("default"),
  TTS_CHATTERBOX_VOICE_MODE: z.enum(["predefined", "clone"]).default("predefined"),
  TTS_CHATTERBOX_PREDEFINED_VOICE_ID: z.string().optional(),
  TTS_CHATTERBOX_REFERENCE_AUDIO_FILENAME: z.string().optional(),
  TTS_CHATTERBOX_OUTPUT_FORMAT: z.enum(["wav", "opus"]).default("wav"),
  TTS_CHATTERBOX_SPLIT_TEXT: boolFromEnv.default(true),
  TTS_CHATTERBOX_CHUNK_SIZE: z.coerce.number().int().min(50).max(500).default(120),
  TTS_CHATTERBOX_TEMPERATURE: z.coerce.number().min(0.1).max(1.5).optional(),
  TTS_CHATTERBOX_EXAGGERATION: z.coerce.number().optional(),
  TTS_CHATTERBOX_CFG_WEIGHT: z.coerce.number().optional(),
  TTS_CHATTERBOX_SEED: z.coerce.number().int().optional(),
  TTS_CHATTERBOX_SPEED_FACTOR: z.coerce.number().positive().optional(),
  TTS_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(30_000),
  TTS_API_KEY: z.string().optional(),
  TTS_SPEAKER_WAV_PATH: z.string().optional(),
  TTS_XTTS_SPEAKER_WAV_URL: z.string().url().optional(),
  TOOLS_REGISTRY_URL: z.string().url().default("https://registry.caal.io/index.json"),
  N8N_BASE_URL: z.string().url().optional(),
  N8N_API_KEY: z.string().min(1).optional(),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  DOCS_ENABLED: boolFromEnv.optional(),
  JSON_BODY_LIMIT: z.string().default("15mb"),
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
const speechToTextBaseUrl = parsed.data.SPEECH_TO_TEXT_BASE_URL ?? parsed.data.STT_BASE_URL;

export const env = {
  ...parsed.data,
  DATABASE_URL: databaseUrl,
  SPEECH_TO_TEXT_BASE_URL: speechToTextBaseUrl,
  DOCS_ENABLED: parsed.data.DOCS_ENABLED ?? docsEnabledDefault,
};
