import { env } from "../config/env.js";
import { DEFAULT_TTS_ENGINE, type TtsEngine } from "./tts-engines.js";

type TtsRuntimeConfig = {
  baseUrl?: string;
  path?: string;
  f5?: {
    speakerId?: string;
    speakerWavPath?: string;
  };
  xtts?: {
    speakerWavUrl?: string;
  };
  chatterbox?: {
    voiceMode?: "predefined" | "clone";
    predefinedVoiceId?: string;
    referenceAudioFilename?: string;
    outputFormat?: "wav" | "opus";
    splitText?: boolean;
    chunkSize?: number;
    temperature?: number;
    exaggeration?: number;
    cfgWeight?: number;
    seed?: number;
    speedFactor?: number;
  };
};

type SynthesizeInput = {
  text: string;
  language?: string;
  engine?: TtsEngine;
  ttsConfig?: Record<string, unknown>;
};

type SynthesizeOutput = {
  audio: Buffer;
  contentType: string;
  provider: string;
  engine: TtsEngine;
};

export async function synthesizeSpeech(input: SynthesizeInput): Promise<SynthesizeOutput> {
  const engine = input.engine ?? DEFAULT_TTS_ENGINE;
  const runtimeConfig = normalizeRuntimeConfig(input.ttsConfig);
  const baseUrl = resolveEngineBaseUrl(engine, runtimeConfig);
  if (!baseUrl) {
    throw new Error("TTS_NOT_CONFIGURED");
  }

  const endpoint = new URL(resolveEnginePath(engine, runtimeConfig), baseUrl).toString();
  const { body, headers } = await buildEngineRequest(engine, input, runtimeConfig);

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

function resolveEngineBaseUrl(engine: TtsEngine, runtimeConfig: TtsRuntimeConfig): string | undefined {
  if (runtimeConfig.baseUrl) {
    return runtimeConfig.baseUrl;
  }
  if (engine === "f5-tts") {
    return env.TTS_F5_BASE_URL ?? env.TTS_BASE_URL;
  }
  if (engine === "chatterbox") {
    return env.TTS_CHATTERBOX_BASE_URL ?? env.TTS_BASE_URL;
  }
  return env.TTS_XTTS_BASE_URL ?? env.TTS_BASE_URL;
}

function resolveEnginePath(engine: TtsEngine, runtimeConfig: TtsRuntimeConfig): string {
  if (runtimeConfig.path) {
    return runtimeConfig.path;
  }
  if (engine === "f5-tts") {
    return env.TTS_F5_SYNTH_PATH;
  }
  if (engine === "chatterbox") {
    return env.TTS_CHATTERBOX_SYNTH_PATH;
  }
  return env.TTS_XTTS_SYNTH_PATH;
}

async function buildEngineRequest(
  engine: TtsEngine,
  input: SynthesizeInput,
  runtimeConfig: TtsRuntimeConfig
): Promise<{ body: BodyInit; headers: Headers }> {
  if (engine === "f5-tts") {
    const headers = new Headers();
    headers.set("content-type", "application/json");
    const payload: Record<string, string> = {
      text: input.text,
      "language-id": input.language ?? env.TTS_LANGUAGE_DEFAULT,
      "speaker-id": runtimeConfig.f5?.speakerId ?? env.TTS_SPEAKER_ID,
    };
    const f5SpeakerWavPath = runtimeConfig.f5?.speakerWavPath ?? env.TTS_SPEAKER_WAV_PATH;
    if (f5SpeakerWavPath) {
      payload["speaker-wav"] = f5SpeakerWavPath;
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
      voice_mode: runtimeConfig.chatterbox?.voiceMode ?? env.TTS_CHATTERBOX_VOICE_MODE,
      output_format: runtimeConfig.chatterbox?.outputFormat ?? env.TTS_CHATTERBOX_OUTPUT_FORMAT,
      split_text: runtimeConfig.chatterbox?.splitText ?? env.TTS_CHATTERBOX_SPLIT_TEXT,
      chunk_size: runtimeConfig.chatterbox?.chunkSize ?? env.TTS_CHATTERBOX_CHUNK_SIZE,
    };

    if (payload.voice_mode === "predefined") {
      const predefinedVoiceId =
        runtimeConfig.chatterbox?.predefinedVoiceId ?? env.TTS_CHATTERBOX_PREDEFINED_VOICE_ID;
      if (!predefinedVoiceId) {
        throw new Error("TTS_CHATTERBOX_PREDEFINED_VOICE_ID_REQUIRED");
      }
      payload.predefined_voice_id = predefinedVoiceId;
    } else {
      const referenceAudioFilename =
        runtimeConfig.chatterbox?.referenceAudioFilename ?? env.TTS_CHATTERBOX_REFERENCE_AUDIO_FILENAME;
      if (!referenceAudioFilename) {
        throw new Error("TTS_CHATTERBOX_REFERENCE_AUDIO_FILENAME_REQUIRED");
      }
      payload.reference_audio_filename = referenceAudioFilename;
    }

    const temperature = runtimeConfig.chatterbox?.temperature ?? env.TTS_CHATTERBOX_TEMPERATURE;
    const exaggeration = runtimeConfig.chatterbox?.exaggeration ?? env.TTS_CHATTERBOX_EXAGGERATION;
    const cfgWeight = runtimeConfig.chatterbox?.cfgWeight ?? env.TTS_CHATTERBOX_CFG_WEIGHT;
    const seed = runtimeConfig.chatterbox?.seed ?? env.TTS_CHATTERBOX_SEED;
    const speedFactor = runtimeConfig.chatterbox?.speedFactor ?? env.TTS_CHATTERBOX_SPEED_FACTOR;
    if (temperature !== undefined) payload.temperature = temperature;
    if (exaggeration !== undefined) payload.exaggeration = exaggeration;
    if (cfgWeight !== undefined) payload.cfg_weight = cfgWeight;
    if (seed !== undefined) payload.seed = seed;
    if (speedFactor !== undefined) payload.speed_factor = speedFactor;
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
  const xttsSpeakerWavUrl = runtimeConfig.xtts?.speakerWavUrl ?? env.TTS_XTTS_SPEAKER_WAV_URL;
  if (xttsSpeakerWavUrl) {
    try {
      const speakerResponse = await fetch(xttsSpeakerWavUrl, {
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

function normalizeRuntimeConfig(input: Record<string, unknown> | undefined): TtsRuntimeConfig {
  if (!input || typeof input !== "object") {
    return {};
  }
  const value = input as Record<string, unknown>;
  const f5 = value.f5 && typeof value.f5 === "object" ? (value.f5 as Record<string, unknown>) : {};
  const xtts = value.xtts && typeof value.xtts === "object" ? (value.xtts as Record<string, unknown>) : {};
  const chatterbox =
    value.chatterbox && typeof value.chatterbox === "object"
      ? (value.chatterbox as Record<string, unknown>)
      : {};

  return {
    baseUrl: typeof value.baseUrl === "string" ? value.baseUrl : undefined,
    path: typeof value.path === "string" ? value.path : undefined,
    f5: {
      speakerId: typeof f5.speakerId === "string" ? f5.speakerId : undefined,
      speakerWavPath: typeof f5.speakerWavPath === "string" ? f5.speakerWavPath : undefined,
    },
    xtts: {
      speakerWavUrl: typeof xtts.speakerWavUrl === "string" ? xtts.speakerWavUrl : undefined,
    },
    chatterbox: {
      voiceMode: chatterbox.voiceMode === "clone" ? "clone" : chatterbox.voiceMode === "predefined" ? "predefined" : undefined,
      predefinedVoiceId: typeof chatterbox.predefinedVoiceId === "string" ? chatterbox.predefinedVoiceId : undefined,
      referenceAudioFilename:
        typeof chatterbox.referenceAudioFilename === "string" ? chatterbox.referenceAudioFilename : undefined,
      outputFormat: chatterbox.outputFormat === "opus" ? "opus" : chatterbox.outputFormat === "wav" ? "wav" : undefined,
      splitText: typeof chatterbox.splitText === "boolean" ? chatterbox.splitText : undefined,
      chunkSize: typeof chatterbox.chunkSize === "number" ? chatterbox.chunkSize : undefined,
      temperature: typeof chatterbox.temperature === "number" ? chatterbox.temperature : undefined,
      exaggeration: typeof chatterbox.exaggeration === "number" ? chatterbox.exaggeration : undefined,
      cfgWeight: typeof chatterbox.cfgWeight === "number" ? chatterbox.cfgWeight : undefined,
      seed: typeof chatterbox.seed === "number" ? chatterbox.seed : undefined,
      speedFactor: typeof chatterbox.speedFactor === "number" ? chatterbox.speedFactor : undefined,
    },
  };
}
