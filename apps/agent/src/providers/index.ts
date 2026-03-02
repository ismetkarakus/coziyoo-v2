import type { AgentSettings } from "../types";
import { resolveLlmProvider } from "./llm";
import { resolveSttProvider } from "./stt";
import { resolveTtsProvider } from "./tts";

export function resolveVoiceProviders(settings: AgentSettings) {
  return {
    stt: resolveSttProvider({
      provider: "remote-speech-server",
      baseUrl: settings.sttBaseUrl,
      transcribePath: settings.sttTranscribePath,
      model: settings.sttModel,
    }),
    tts: resolveTtsProvider({
      provider: settings.ttsEngine,
    }),
    llm: resolveLlmProvider({
      provider: "ollama",
      baseUrl: settings.ollamaBaseUrl,
      model: settings.ollamaModel,
    }),
  };
}
