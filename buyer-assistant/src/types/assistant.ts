export type AssistantRecommendation = {
  id?: string;
  title?: string;
  name?: string;
  cuisine?: string;
  rating?: number;
  popularitySignal?: string;
  distanceKm?: number;
  reason?: string;
};

export type BuyerAssistantResponse = {
  replyText: string;
  followUpQuestion?: string;
  recommendations?: AssistantRecommendation[];
  meta?: {
    model?: string;
    latencyMs?: number;
  };
};

export type BuyerAssistantRequest = {
  message: string;
  model?: string;
  context?: {
    lat?: number;
    lng?: number;
    radiusKm?: number;
  };
  client?: {
    channel: "voice" | "text";
  };
};

export type FoodsTestItem = {
  id: string;
  name: string;
  category: string | null;
  price: number;
  rating: number;
  reviewCount: number;
  favoriteCount: number;
  stock: number;
  countryCode: string | null;
  summary: string | null;
};

export type AssistantModelsResponse = {
  models: string[];
  defaultModel: string;
};
