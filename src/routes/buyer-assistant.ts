import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/client.js";
import { env } from "../config/env.js";

const ChatInputSchema = z.object({
  message: z.string().min(1).max(2000),
  model: z.string().min(1).max(120).optional(),
  context: z
    .object({
      lat: z.number().min(-90).max(90).optional(),
      lng: z.number().min(-180).max(180).optional(),
      radiusKm: z.number().positive().max(50).optional(),
    })
    .optional(),
  client: z
    .object({
      channel: z.enum(["voice", "text"]).default("text"),
    })
    .optional(),
});

const FoodsTestQuerySchema = z.object({
  search: z.string().min(1).max(120).optional(),
  limit: z.coerce.number().int().positive().max(20).default(6),
});

type AssistantOutput = {
  recommendedFoodIds?: string[];
  followUpQuestion?: string;
};

const FALLBACK_REPLY =
  "Su an asistana ulasamiyorum. Istersen tekrar deneyelim veya aradigin yemegi daha net yazar misin?";

export const buyerAssistantRouter = Router();

type FoodRow = {
  id: string;
  name: string;
  card_summary: string | null;
  description: string | null;
  country_code: string | null;
  rating: string;
  review_count: number;
  favorite_count: number;
  price: string;
  current_stock: number;
  category_name_tr: string | null;
};

async function fetchFoodsSnapshot(search: string | undefined, limit: number): Promise<FoodRow[]> {
  const whereSql = search ? "WHERE row_to_json(t)::text ILIKE $1" : "";
  const listParams = search ? [`%${search}%`, limit] : [limit];
  const limitIndex = search ? 2 : 1;

  const listResult = await pool.query<FoodRow>(
    `SELECT *
     FROM (
       SELECT
         f.id,
         f.name,
         f.card_summary,
         f.description,
         f.country_code,
         f.rating::text AS rating,
         f.review_count,
         f.favorite_count,
         f.price::text AS price,
         f.current_stock,
         c.name_tr AS category_name_tr
       FROM public.foods f
       LEFT JOIN public.categories c ON c.id = f.category_id
       WHERE f.is_active = TRUE
         AND f.is_available = TRUE
         AND f.current_stock > 0
     ) t
     ${whereSql}
     ORDER BY rating::numeric DESC, review_count DESC, favorite_count DESC
     LIMIT $${limitIndex}`,
    listParams
  );

  return listResult.rows;
}

type AssistantResponseData = {
  replyText: string;
  followUpQuestion?: string;
  recommendations: Array<{
    title: string;
    rating?: number;
    popularitySignal?: string;
    reason?: string;
    distanceKm?: number;
  }>;
  meta: {
    model: string;
    latencyMs: number;
  };
};

async function runAssistant(input: z.infer<typeof ChatInputSchema>): Promise<AssistantResponseData> {
  const modelToUse = input.model?.trim() || env.OLLAMA_MODEL;
  let foodsSnapshot = await fetchFoodsSnapshot(input.message, 6);
  if (foodsSnapshot.length === 0) {
    foodsSnapshot = await fetchFoodsSnapshot(undefined, 6);
  }
  const foodById = new Map(foodsSnapshot.map((row) => [row.id, row]));

  if (foodsSnapshot.length === 0) {
    return {
      replyText: "Bu arama icin veritabaninda uygun yemek bulamadim. Daha farkli bir yemek veya kategori yazar misin?",
      followUpQuestion: "Hangi mutfaktan bir sey istersin? (or: Turk, tatli, corba)",
      recommendations: [],
      meta: {
        model: modelToUse,
        latencyMs: 0,
      },
    };
  }

  const foodsForPrompt = foodsSnapshot.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category_name_tr,
    rating: Number(row.rating),
    price: Number(row.price),
    favoriteCount: row.favorite_count,
    reviewCount: row.review_count,
    stock: row.current_stock,
    summary: row.card_summary ?? row.description,
  }));

  const systemPrompt = [
    "Sen Coziyoo Buyer Voice Assistant'sin.",
    "Kurallar:",
    "- Sadece read-only yardim sagla; siparis/odeme/durum degisikligi yapma.",
    "- Bilinmeyen bilgiyi kesinmis gibi yazma.",
    "- Turkce, net ve kisa cevap ver.",
    "- Ilk oneri cevabinda en fazla 3 secenek sec.",
    "- Yemek onerisi icin SADECE verilen foods listesindeki id degerlerini kullan.",
    "- Cevabi yalnizca gecerli JSON olarak don.",
    "JSON semasi:",
    '{"recommendedFoodIds":["uuid-1","uuid-2"],"followUpQuestion":"string"}',
  ].join("\n");

  const userPrompt = JSON.stringify(
    {
      channel: input.client?.channel ?? "text",
      message: input.message,
      context: {
        lat: input.context?.lat,
        lng: input.context?.lng,
        radiusKm: input.context?.radiusKm,
      },
      foods: foodsForPrompt,
    },
    null,
    2
  );

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.OLLAMA_TIMEOUT_MS);

  try {
    const response = await fetch(`${env.OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: modelToUse,
        prompt: `${systemPrompt}\n\nKullanici girdisi:\n${userPrompt}`,
        stream: false,
        format: "json",
      }),
    });

    if (!response.ok) {
      throw new Error(`ASSISTANT_UPSTREAM_ERROR:${response.status}`);
    }

    const ollamaBody = (await response.json()) as { response?: string };
    const raw = String(ollamaBody.response ?? "").trim();

    let parsedOutput: AssistantOutput | null = null;
    if (raw) {
      try {
        parsedOutput = JSON.parse(raw) as AssistantOutput;
      } catch {
        parsedOutput = null;
      }
    }

    const fallbackFoods = foodsSnapshot.slice(0, 3);
    const selectedFoods: FoodRow[] = [];
    const pickedIds = new Set<string>();

    for (const id of parsedOutput?.recommendedFoodIds ?? []) {
      if (pickedIds.has(id)) continue;
      const food = foodById.get(id);
      if (!food) continue;
      pickedIds.add(id);
      selectedFoods.push(food);
      if (selectedFoods.length >= 3) break;
    }

    const finalFoods = selectedFoods.length > 0 ? selectedFoods : fallbackFoods;
    const recommendations = finalFoods.map((food) => ({
      title: food.name,
      rating: Number(food.rating),
      popularitySignal: `${food.favorite_count} favori • ${food.review_count} yorum`,
      reason: food.card_summary ?? food.description ?? "Stokta mevcut populer urun.",
    }));
    const replyLines = recommendations.map((item, index) => `${index + 1}) ${item.title} - ${item.reason}`);

    return {
      replyText: `Veritabaninda bulunan uygun yemekler:\n${replyLines.join("\n")}`,
      followUpQuestion:
        parsedOutput?.followUpQuestion?.trim() || "Istersen bunlardan birini fiyat veya puanina gore daha detayli karsilastirayim.",
      recommendations,
      meta: {
        model: modelToUse,
        latencyMs: Date.now() - startedAt,
      },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    throw new Error(`ASSISTANT_UNAVAILABLE:${reason}`);
  } finally {
    clearTimeout(timeout);
  }
}

buyerAssistantRouter.get("/foods-test", async (req, res) => {
  const parsed = FoodsTestQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const rows = await fetchFoodsSnapshot(parsed.data.search, parsed.data.limit);
  return res.json({
    data: rows.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category_name_tr,
      price: Number(row.price),
      rating: Number(row.rating),
      reviewCount: row.review_count,
      favoriteCount: row.favorite_count,
      stock: row.current_stock,
      countryCode: row.country_code,
      summary: row.card_summary ?? row.description,
    })),
    meta: {
      source: "foods",
      count: rows.length,
    },
  });
});

buyerAssistantRouter.get("/models", async (_req, res) => {
  try {
    const response = await fetch(`${env.OLLAMA_BASE_URL}/api/tags`);
    if (!response.ok) {
      return res.status(502).json({ error: { code: "ASSISTANT_UPSTREAM_ERROR", message: "Ollama model listesi alinamadi" } });
    }
    const body = (await response.json()) as { models?: Array<{ name?: string }> };
    const models = (body.models ?? [])
      .map((item) => String(item.name ?? "").trim())
      .filter((item) => item.length > 0);
    return res.json({
      data: {
        models,
        defaultModel: env.OLLAMA_MODEL,
      },
    });
  } catch {
    return res.status(503).json({
      error: {
        code: "ASSISTANT_UNAVAILABLE",
        message: "Model listesi alinamadi",
      },
    });
  }
});

buyerAssistantRouter.post("/chat", async (req, res) => {
  const parsed = ChatInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  try {
    const data = await runAssistant(parsed.data);
    return res.json({ data });
  } catch (error) {
    const message = (error as Error).message ?? "unknown";
    if (message.startsWith("ASSISTANT_UPSTREAM_ERROR")) {
      return res.status(502).json({
        error: { code: "ASSISTANT_UPSTREAM_ERROR", message: "Ollama endpoint hatasi" },
      });
    }
    if (env.NODE_ENV !== "production") {
      return res.status(503).json({
        error: {
          code: "ASSISTANT_UNAVAILABLE",
          message: `${FALLBACK_REPLY} [debug: ${message}; base=${env.OLLAMA_BASE_URL}]`,
        },
      });
    }
    return res.status(503).json({
      error: {
        code: "ASSISTANT_UNAVAILABLE",
        message: FALLBACK_REPLY,
      },
    });
  }
});

buyerAssistantRouter.post("/chat-demo", async (req, res) => {
  if (env.NODE_ENV === "production") {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "chat-demo is disabled in production" } });
  }

  const parsed = ChatInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  try {
    const data = await runAssistant(parsed.data);
    return res.json({ data });
  } catch (error) {
    const message = (error as Error).message ?? "unknown";
    return res.status(503).json({
      error: {
        code: "ASSISTANT_UNAVAILABLE",
        message: `${FALLBACK_REPLY} [debug: ${message}; base=${env.OLLAMA_BASE_URL}]`,
      },
    });
  }
});
