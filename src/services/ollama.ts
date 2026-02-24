import { env } from "../config/env.js";

type OllamaMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OllamaChatResponse = {
  message?: {
    content?: string;
  };
};

export async function askOllamaChat(userText: string) {
  const endpoint = new URL("/api/chat", env.OLLAMA_BASE_URL).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.OLLAMA_TIMEOUT_MS);

  const messages: OllamaMessage[] = [
    { role: "system", content: env.OLLAMA_SYSTEM_PROMPT },
    { role: "user", content: userText },
  ];

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: env.OLLAMA_CHAT_MODEL,
        stream: false,
        messages,
      }),
      signal: controller.signal,
    });

    const raw = await response.text();
    let parsed: OllamaChatResponse | null = null;
    try {
      parsed = raw ? (JSON.parse(raw) as OllamaChatResponse) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      throw new Error(`OLLAMA_HTTP_${response.status}: ${raw.slice(0, 300)}`);
    }

    const content = parsed?.message?.content?.trim();
    if (!content) {
      throw new Error("OLLAMA_EMPTY_RESPONSE");
    }

    return {
      text: content,
      model: env.OLLAMA_CHAT_MODEL,
      endpoint,
    };
  } finally {
    clearTimeout(timeout);
  }
}
