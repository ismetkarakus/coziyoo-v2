import { API_BASE_URL } from "../config/env";
import type { BuyerAssistantRequest, BuyerAssistantResponse } from "../types/assistant";

export async function chatWithBuyerAssistant(payload: BuyerAssistantRequest): Promise<BuyerAssistantResponse> {
  const response = await fetch(`${API_BASE_URL}/v1/buyer-assistant/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = (await response.json()) as { data?: BuyerAssistantResponse; error?: { message?: string } };

  if (!response.ok || !body.data) {
    throw new Error(body.error?.message ?? "Asistan servisine ulasilamadi.");
  }

  return body.data;
}
