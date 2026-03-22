import { z } from "zod";

const openAiCompatibleSchema = z.object({
  base_url: z.string().url("Must be a valid URL").or(z.literal("")).default(""),
  api_key: z.string().default(""),
  model: z.string().default(""),
  endpoint_path: z.string().default(""),
  custom_headers: z.record(z.string(), z.string()).default({}),
  custom_body_params: z.record(z.string(), z.string()).default({}),
});

export const profileFormSchema = z.object({
  name: z.string().min(1, "Profile name is required").max(128),
  speaks_first: z.boolean().default(false),
  system_prompt: z.string().max(4000).default(""),
  greeting_enabled: z.boolean().default(true),
  greeting_instruction: z.string().max(2000).default(""),
  voice_language: z.string().default("tr"),
  llm_config: openAiCompatibleSchema.extend({
    endpoint_path: z.string().default("/v1/chat/completions"),
  }),
  tts_config: openAiCompatibleSchema.extend({
    endpoint_path: z.string().default("/v1/audio/speech"),
    voice_id: z.string().default(""),
    text_field_name: z.string().default("input"),
  }),
  stt_config: openAiCompatibleSchema.extend({
    endpoint_path: z.string().default("/v1/audio/transcriptions"),
    language: z.string().default(""),
    custom_query_params: z.record(z.string(), z.string()).default({}),
  }),
  n8n_config: z.object({
    base_url: z.string().url("Must be a valid URL").or(z.literal("")).default(""),
    webhook_path: z.string().default(""),
    mcp_webhook_path: z.string().default(""),
  }),
});

export type ProfileFormValues = z.infer<typeof profileFormSchema>;
