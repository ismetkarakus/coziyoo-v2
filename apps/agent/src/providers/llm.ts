export type LlmProviderId = "ollama";

export type LlmProviderConfig = {
  provider: LlmProviderId;
  baseUrl: string;
  model: string;
};

export function resolveLlmProvider(input: Partial<LlmProviderConfig> | undefined): LlmProviderConfig {
  return {
    provider: "ollama",
    baseUrl: String(input?.baseUrl ?? "").trim(),
    model: String(input?.model ?? "llama3.1").trim(),
  };
}
