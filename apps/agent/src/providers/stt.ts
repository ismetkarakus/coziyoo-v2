export type SttProviderId = "remote-speech-server";

export type SttProviderConfig = {
  provider: SttProviderId;
  baseUrl: string;
  transcribePath: string;
  model: string;
};

export function resolveSttProvider(input: Partial<SttProviderConfig> | undefined): SttProviderConfig {
  return {
    provider: "remote-speech-server",
    baseUrl: String(input?.baseUrl ?? "").trim(),
    transcribePath: String(input?.transcribePath ?? "/v1/audio/transcriptions").trim(),
    model: String(input?.model ?? "whisper-1").trim(),
  };
}
