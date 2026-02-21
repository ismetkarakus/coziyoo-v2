import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { resolveActorRole } from "../middleware/app-role.js";
import { env } from "../config/env.js";

const ChatInputSchema = z.object({
  message: z.string().min(1).max(2000),
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

type AssistantOutput = {
  replyText: string;
  followUpQuestion?: string;
  recommendations?: Array<{
    title: string;
    rating?: number;
    popularitySignal?: string;
    reason?: string;
    distanceKm?: number;
  }>;
};

const FALLBACK_REPLY =
  "Su an asistana ulasamiyorum. Istersen tekrar deneyelim veya aradigin yemegi daha net yazar misin?";

export const buyerAssistantRouter = Router();

buyerAssistantRouter.post("/chat", requireAuth("app"), async (req, res) => {
  const actorRole = resolveActorRole(req);
  if (actorRole !== "buyer") {
    return res.status(403).json({
      error: {
        code: "ROLE_NOT_ALLOWED",
        message: "Buyer Assistant sadece buyer rolu icin kullanilabilir. both kullanicisinda x-actor-role: buyer gonderin.",
      },
    });
  }

  const parsed = ChatInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;

  const systemPrompt = [
    "Sen Coziyoo Buyer Voice Assistant'sin.",
    "Kurallar:",
    "- Sadece read-only yardim sagla; siparis/odeme/durum degisikligi yapma.",
    "- Bilinmeyen bilgiyi kesinmis gibi yazma.",
    "- Turkce, net ve kisa cevap ver.",
    "- Ilk oneri cevabinda en fazla 3 secenek don.",
    "- Cevabi yalnizca gecerli JSON olarak don.",
    "JSON semasi:",
    '{"replyText":"string","followUpQuestion":"string","recommendations":[{"title":"string","rating":4.5,"popularitySignal":"string","reason":"string","distanceKm":1.2}]}',
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
        model: env.OLLAMA_MODEL,
        prompt: `${systemPrompt}\n\nKullanici girdisi:\n${userPrompt}`,
        stream: false,
        format: "json",
      }),
    });

    if (!response.ok) {
      return res.status(502).json({
        error: { code: "ASSISTANT_UPSTREAM_ERROR", message: "Ollama endpoint hatasi" },
      });
    }

    const ollamaBody = (await response.json()) as { response?: string };
    const raw = String(ollamaBody.response ?? "").trim();

    let parsedOutput: AssistantOutput | null = null;
    if (raw) {
      try {
        parsedOutput = JSON.parse(raw) as AssistantOutput;
      } catch {
        parsedOutput = { replyText: raw };
      }
    }

    const latencyMs = Date.now() - startedAt;

    return res.json({
      data: {
        replyText: parsedOutput?.replyText?.trim() || FALLBACK_REPLY,
        followUpQuestion: parsedOutput?.followUpQuestion,
        recommendations: (parsedOutput?.recommendations ?? []).slice(0, 3),
        meta: {
          model: env.OLLAMA_MODEL,
          latencyMs,
        },
      },
    });
  } catch {
    return res.status(503).json({
      error: {
        code: "ASSISTANT_UNAVAILABLE",
        message: FALLBACK_REPLY,
      },
    });
  } finally {
    clearTimeout(timeout);
  }
});
