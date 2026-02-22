import { API_BASE_URL } from "../config/env";
import type { AssistantModelsResponse, BuyerAssistantRequest, BuyerAssistantResponse, FoodsTestItem } from "../types/assistant";

type ApiResult = { data?: BuyerAssistantResponse; error?: { message?: string; code?: string } };

export async function chatWithBuyerAssistant(payload: BuyerAssistantRequest): Promise<BuyerAssistantResponse> {
  const response = await fetch(`${API_BASE_URL}/v1/buyer-assistant/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = (await response.json()) as ApiResult;

  if (!response.ok || !body.data) {
    throw new Error(body.error?.message ?? "Asistan servisine ulasilamadi.");
  }

  return body.data;
}

export async function chatWithBuyerAssistantDemo(payload: BuyerAssistantRequest): Promise<BuyerAssistantResponse> {
  const response = await fetch(`${API_BASE_URL}/v1/buyer-assistant/chat-demo`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = (await response.json()) as ApiResult;

  if (!response.ok || !body.data) {
    throw new Error(body.error?.message ?? "Demo asistan servisine ulasilamadi.");
  }

  return body.data;
}

export async function chatWithBuyerAssistantAuto(payload: BuyerAssistantRequest): Promise<BuyerAssistantResponse> {
  const response = await fetch(`${API_BASE_URL}/v1/buyer-assistant/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = (await response.json()) as ApiResult;
  if (response.ok && body.data) {
    return body.data;
  }

  const message = String(body.error?.message ?? "").toLowerCase();
  const isAuthError = response.status === 401 || response.status === 403 || message.includes("missing bearer token");
  if (!isAuthError) {
    throw new Error(body.error?.message ?? "Asistan servisine ulasilamadi.");
  }

  return chatWithBuyerAssistantDemo(payload);
}

export async function fetchFoodsTest(search = "", limit = 5): Promise<FoodsTestItem[]> {
  const query = new URLSearchParams({
    ...(search ? { search } : {}),
    limit: String(limit),
  });
  const response = await fetch(`${API_BASE_URL}/v1/buyer-assistant/foods-test?${query.toString()}`);
  const body = (await response.json()) as { data?: FoodsTestItem[]; error?: { message?: string } };
  if (!response.ok || !body.data) {
    throw new Error(body.error?.message ?? "Foods test baglantisi kurulamadi.");
  }
  return body.data;
}

export async function fetchAssistantModels(): Promise<AssistantModelsResponse> {
  const response = await fetch(`${API_BASE_URL}/v1/buyer-assistant/models`);
  const body = (await response.json()) as { data?: AssistantModelsResponse; error?: { message?: string } };
  if (!response.ok || !body.data) {
    throw new Error(body.error?.message ?? "Model listesi alinamadi.");
  }
  return body.data;
}
