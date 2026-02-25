export const TTS_ENGINES = ["f5-tts", "xtts", "chatterbox"] as const;

export type TtsEngine = (typeof TTS_ENGINES)[number];

export const DEFAULT_TTS_ENGINE: TtsEngine = "f5-tts";

export function normalizeTtsEngine(input: unknown): TtsEngine {
  if (typeof input !== "string") {
    return DEFAULT_TTS_ENGINE;
  }
  return (TTS_ENGINES as readonly string[]).includes(input) ? (input as TtsEngine) : DEFAULT_TTS_ENGINE;
}
