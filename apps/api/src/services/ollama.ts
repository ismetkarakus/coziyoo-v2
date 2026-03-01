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

type OllamaTagsResponse = {
  models?: Array<{
    name?: string;
    model?: string;
  }>;
};

export async function askOllamaChat(userText: string, options?: { model?: string }) {
  const endpoint = new URL("/api/chat", env.OLLAMA_BASE_URL).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.OLLAMA_TIMEOUT_MS);
  const selectedModel = options?.model?.trim() || env.OLLAMA_CHAT_MODEL;

  const messages: OllamaMessage[] = [
    { role: "system", content: env.OLLAMA_SYSTEM_PROMPT },
    { role: "user", content: userText },
  ];

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: selectedModel,
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
      model: selectedModel,
      endpoint,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function listOllamaModels() {
  const endpoint = new URL("/api/tags", env.OLLAMA_BASE_URL).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.OLLAMA_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "GET",
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`OLLAMA_TAGS_HTTP_${response.status}: ${raw.slice(0, 300)}`);
    }
    const parsed = raw ? (JSON.parse(raw) as OllamaTagsResponse) : null;
    const models = (parsed?.models ?? [])
      .map((item) => (typeof item.name === "string" ? item.name : typeof item.model === "string" ? item.model : ""))
      .filter((item) => item.length > 0);
    return {
      endpoint,
      models: Array.from(new Set(models)),
    };
  } finally {
    clearTimeout(timeout);
  }
}
