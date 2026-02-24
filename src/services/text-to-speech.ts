import { env } from "../config/env.js";

type SynthesizeInput = {
  text: string;
  language?: string;
};

type SynthesizeOutput = {
  audio: Buffer;
  contentType: string;
};

export async function synthesizeSpeech(input: SynthesizeInput): Promise<SynthesizeOutput> {
  if (!env.TTS_BASE_URL) {
    throw new Error("TTS_NOT_CONFIGURED");
  }

  const endpoint = new URL(env.TTS_SYNTH_PATH, env.TTS_BASE_URL).toString();
  const form = new FormData();
  form.set("text", input.text);
  form.set("language", input.language ?? env.TTS_LANGUAGE_DEFAULT);
  if (env.TTS_SPEAKER_WAV_URL) {
    try {
      const speakerResponse = await fetch(env.TTS_SPEAKER_WAV_URL, {
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

  const headers = new Headers();
  if (env.TTS_API_KEY) {
    headers.set("authorization", `Bearer ${env.TTS_API_KEY}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.TTS_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: form,
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
    };
  } finally {
    clearTimeout(timeout);
  }
}
