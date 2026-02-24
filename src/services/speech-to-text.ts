import { env } from "../config/env.js";

type TranscribeInput = {
  audioBase64: string;
  mimeType?: string;
  language?: string;
  prompt?: string;
  temperature?: number;
};

type TranscribeOutput = {
  text: string;
  raw: unknown;
};

function decodeAudio(base64: string) {
  try {
    return Buffer.from(base64, "base64");
  } catch {
    throw new Error("STT_INVALID_BASE64");
  }
}

export async function transcribeAudio(input: TranscribeInput): Promise<TranscribeOutput> {
  if (!env.SPEECH_TO_TEXT_BASE_URL) {
    throw new Error("SPEECH_TO_TEXT_NOT_CONFIGURED");
  }

  const audio = decodeAudio(input.audioBase64);
  if (audio.length === 0) {
    throw new Error("STT_EMPTY_AUDIO");
  }

  const endpoint = new URL(env.SPEECH_TO_TEXT_TRANSCRIBE_PATH, env.SPEECH_TO_TEXT_BASE_URL).toString();
  const form = new FormData();
  const mimeType = input.mimeType ?? "audio/webm";
  form.set("file", new Blob([audio], { type: mimeType }), "recording.webm");
  form.set("model", env.SPEECH_TO_TEXT_MODEL);
  if (input.language) form.set("language", input.language);
  if (input.prompt) form.set("prompt", input.prompt);
  if (typeof input.temperature === "number") form.set("temperature", String(input.temperature));

  const headers = new Headers();
  if (env.SPEECH_TO_TEXT_API_KEY) {
    headers.set("authorization", `Bearer ${env.SPEECH_TO_TEXT_API_KEY}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.SPEECH_TO_TEXT_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: form,
      signal: controller.signal,
    });

    const rawText = await response.text();
    let raw: unknown = rawText;
    try {
      raw = rawText.length > 0 ? JSON.parse(rawText) : null;
    } catch {
      raw = rawText;
    }

    if (!response.ok) {
      throw new Error(`STT_HTTP_${response.status}: ${rawText.slice(0, 300)}`);
    }

    const text =
      typeof raw === "object" && raw !== null && "text" in raw && typeof (raw as { text?: unknown }).text === "string"
        ? ((raw as { text: string }).text ?? "").trim()
        : "";

    if (!text) {
      throw new Error("STT_EMPTY_TRANSCRIPT");
    }

    return { text, raw };
  } finally {
    clearTimeout(timeout);
  }
}
