export type TtsProviderId = "f5-tts" | "xtts" | "chatterbox";

export type TtsProviderConfig = {
  provider: TtsProviderId;
};

export function resolveTtsProvider(input: Partial<TtsProviderConfig> | undefined): TtsProviderConfig {
  const value = String(input?.provider ?? "f5-tts").trim();
  if (value === "xtts" || value === "chatterbox") {
    return { provider: value };
  }
  return { provider: "f5-tts" };
}
