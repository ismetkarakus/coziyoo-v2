import { env } from "../config/env.js";
import { DEFAULT_TTS_ENGINE, type TtsEngine } from "./tts-engines.js";

type SynthesizeInput = {
  text: string;
  language?: string;
  engine?: TtsEngine;
};

type SynthesizeOutput = {
  audio: Buffer;
  contentType: string;
  provider: string;
  engine: TtsEngine;
};

export async function synthesizeSpeech(input: SynthesizeInput): Promise<SynthesizeOutput> {
  const engine = input.engine ?? DEFAULT_TTS_ENGINE;
  const baseUrl = resolveEngineBaseUrl(engine);
  if (!baseUrl) {
    throw new Error("TTS_NOT_CONFIGURED");
  }

  const endpoint = new URL(resolveEnginePath(engine), baseUrl).toString();
  const { body, headers } = await buildEngineRequest(engine, input);

  if (env.TTS_API_KEY) {
    headers.set("authorization", `Bearer ${env.TTS_API_KEY}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.TTS_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });

    const audio = Buffer.from(await response.arrayBuffer());
    if (!response.ok) {
      const errorText = audio.toString("utf8").slice(0, 300);
      throw new Error(`TTS_HTTP_${response.status}: ${errorText}`);
    }
    if (audio.length === 0) {
      throw new Error("TTS_EMPTY_AUDIO");
    }

    return {
      audio,
      contentType: response.headers.get("content-type") ?? "audio/wav",
      provider: baseUrl,
      engine,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function resolveEngineBaseUrl(engine: TtsEngine): string | undefined {
  if (engine === "f5-tts") {
    return env.TTS_F5_BASE_URL ?? env.TTS_BASE_URL;
  }
  if (engine === "chatterbox") {
    return env.TTS_CHATTERBOX_BASE_URL ?? env.TTS_BASE_URL;
  }
  return env.TTS_XTTS_BASE_URL ?? env.TTS_BASE_URL;
}

function resolveEnginePath(engine: TtsEngine): string {
  if (engine === "f5-tts") {
    return env.TTS_F5_SYNTH_PATH;
  }
  if (engine === "chatterbox") {
    return env.TTS_CHATTERBOX_SYNTH_PATH;
  }
  return env.TTS_XTTS_SYNTH_PATH;
}

async function buildEngineRequest(engine: TtsEngine, input: SynthesizeInput): Promise<{ body: BodyInit; headers: Headers }> {
  if (engine === "f5-tts") {
    const headers = new Headers();
    headers.set("content-type", "application/json");
    const payload: Record<string, string> = {
      text: input.text,
      "language-id": input.language ?? env.TTS_LANGUAGE_DEFAULT,
      "speaker-id": env.TTS_SPEAKER_ID,
    };
    if (env.TTS_SPEAKER_WAV_PATH) {
      payload["speaker-wav"] = env.TTS_SPEAKER_WAV_PATH;
    }
    return {
      body: JSON.stringify(payload),
      headers,
    };
  }

  if (engine === "chatterbox") {
    const headers = new Headers();
    headers.set("content-type", "application/json");

    const payload: Record<string, string | number | boolean> = {
      text: input.text,
      voice_mode: env.TTS_CHATTERBOX_VOICE_MODE,
      output_format: env.TTS_CHATTERBOX_OUTPUT_FORMAT,
      split_text: env.TTS_CHATTERBOX_SPLIT_TEXT,
      chunk_size: env.TTS_CHATTERBOX_CHUNK_SIZE,
    };

    if (env.TTS_CHATTERBOX_VOICE_MODE === "predefined") {
      if (!env.TTS_CHATTERBOX_PREDEFINED_VOICE_ID) {
        throw new Error("TTS_CHATTERBOX_PREDEFINED_VOICE_ID_REQUIRED");
      }
      payload.predefined_voice_id = env.TTS_CHATTERBOX_PREDEFINED_VOICE_ID;
    } else {
      if (!env.TTS_CHATTERBOX_REFERENCE_AUDIO_FILENAME) {
        throw new Error("TTS_CHATTERBOX_REFERENCE_AUDIO_FILENAME_REQUIRED");
      }
      payload.reference_audio_filename = env.TTS_CHATTERBOX_REFERENCE_AUDIO_FILENAME;
    }

    if (env.TTS_CHATTERBOX_TEMPERATURE !== undefined) payload.temperature = env.TTS_CHATTERBOX_TEMPERATURE;
    if (env.TTS_CHATTERBOX_EXAGGERATION !== undefined) payload.exaggeration = env.TTS_CHATTERBOX_EXAGGERATION;
    if (env.TTS_CHATTERBOX_CFG_WEIGHT !== undefined) payload.cfg_weight = env.TTS_CHATTERBOX_CFG_WEIGHT;
    if (env.TTS_CHATTERBOX_SEED !== undefined) payload.seed = env.TTS_CHATTERBOX_SEED;
    if (env.TTS_CHATTERBOX_SPEED_FACTOR !== undefined) payload.speed_factor = env.TTS_CHATTERBOX_SPEED_FACTOR;
    if (input.language) payload.language = input.language;

    return {
      body: JSON.stringify(payload),
      headers,
    };
  }

  const headers = new Headers();
  const form = new FormData();
  form.set("text", input.text);
  form.set("language", input.language ?? env.TTS_LANGUAGE_DEFAULT);
  if (env.TTS_XTTS_SPEAKER_WAV_URL) {
    try {
      const speakerResponse = await fetch(env.TTS_XTTS_SPEAKER_WAV_URL, {
        method: "GET",
      });
      if (!speakerResponse.ok) {
        throw new Error(`TTS_SPEAKER_WAV_HTTP_${speakerResponse.status}`);
      }
      const speakerBuffer = Buffer.from(await speakerResponse.arrayBuffer());
      form.set("speaker_wav", new Blob([speakerBuffer], { type: "audio/wav" }), "speaker.wav");
    } catch (error) {
      throw new Error(
        `TTS_SPEAKER_WAV_FETCH_FAILED: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
  return {
    body: form,
    headers,
  };
}
