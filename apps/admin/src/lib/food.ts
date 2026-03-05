import { normalizeImageUrl } from "./format";
import type { Language } from "../types/core";

export const FOOD_METADATA_BY_NAME: Record<string, { ingredients: string; imageUrl: string }> = {
  "izgara tavuk": {
    ingredients: "tavuk, yogurt, zeytinyagi, sarimsak, pul biber, kimyon, tuz, karabiber",
    imageUrl: "https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?auto=format&fit=crop&w=900&q=80",
  },
  "etli kuru fasulye": {
    ingredients: "kuru fasulye, dana eti, sogan, domates salcasi, siviyag, tuz, karabiber",
    imageUrl: "https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=900&q=80",
  },
  "adana kebap": {
    ingredients: "kuzu kiyma, kuyruk yagi, pul biber, paprika, tuz, isot, lavas, sogan",
    imageUrl: "https://images.unsplash.com/photo-1529692236671-f1f6cf9683ba?auto=format&fit=crop&w=900&q=80",
  },
  "mercimek corbasi": {
    ingredients: "kirmizi mercimek, sogan, havuc, patates, tereyagi, un, tuz, kimyon",
    imageUrl: "https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=80",
  },
  "firinda sutlac": {
    ingredients: "sut, pirinc, toz seker, nisasta, vanilya, tarcin",
    imageUrl: "https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=900&q=80",
  },
  "fistikli baklava": {
    ingredients: "baklava yufkasi, antep fistigi, tereyagi, toz seker, su, limon",
    imageUrl: "https://images.unsplash.com/photo-1626803775151-61d756612f97?auto=format&fit=crop&w=900&q=80",
  },
  "levrek izgara": {
    ingredients: "levrek fileto, zeytinyagi, limon, sarimsak, tuz, karabiber, roka",
    imageUrl: "https://images.unsplash.com/photo-1612874742237-6526221588e3?auto=format&fit=crop&w=900&q=80",
  },
  "zeytinyagli yaprak sarma": {
    ingredients: "asma yapragi, pirinc, sogan, zeytinyagi, kus uzumu, dolmalik fistik, nane, limon",
    imageUrl: "https://images.unsplash.com/photo-1611584186769-0a53b5f7f350?auto=format&fit=crop&w=900&q=80",
  },
  "kasarli sucuklu pide": {
    ingredients: "un, su, maya, kasar peyniri, sucuk, tereyagi, tuz",
    imageUrl: "https://images.unsplash.com/photo-1590947132387-155cc02f3212?auto=format&fit=crop&w=900&q=80",
  },
  "tavuklu pilav": {
    ingredients: "pirinc, tavuk gogsu, tereyagi, tavuk suyu, nohut, tuz, karabiber",
    imageUrl: "https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=900&q=80",
  },
};

export function foodMetadataByName(value: string | null | undefined): { ingredients: string; imageUrl: string } | null {
  const key = String(value ?? "")
    .toLowerCase()
    .replace(/[ç]/g, "c")
    .replace(/[ğ]/g, "g")
    .replace(/[ı]/g, "i")
    .replace(/[ö]/g, "o")
    .replace(/[ş]/g, "s")
    .replace(/[ü]/g, "u")
    .trim();
  return FOOD_METADATA_BY_NAME[key] ?? null;
}

export function isPlaceholderIngredients(value: string | null | undefined): boolean {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, "");
  if (!normalized) return true;
  return normalized.includes("icerik1") || normalized.includes("icerik2") || normalized.includes("standarttarif");
}

export function resolveFoodIngredients(
  currentIngredients: string | null | undefined,
  recipe: string | null | undefined,
  metadataIngredients: string | null | undefined,
  language: Language
): string {
  if (!isPlaceholderIngredients(currentIngredients) && String(currentIngredients ?? "").trim()) {
    return String(currentIngredients).trim();
  }
  if (!isPlaceholderIngredients(recipe) && String(recipe ?? "").trim()) {
    return String(recipe).trim();
  }
  if (String(metadataIngredients ?? "").trim()) {
    return String(metadataIngredients).trim();
  }
  return language === "tr" ? "Belirtilmemiş" : "Not specified";
}

export function resolveFoodImageUrl(
  name: string,
  currentImageUrl: string | null | undefined,
  metadataImageUrl: string | null | undefined
): string | null {
  const current = normalizeImageUrl(currentImageUrl);
  const meta = normalizeImageUrl(metadataImageUrl);
  if (!meta) return current;
  // Known placeholder flows should prefer name-based image metadata.
  const loweredName = name.toLowerCase();
  if (loweredName.includes("mercimek") || loweredName.includes("levrek") || loweredName.includes("baklava")) {
    return meta;
  }
  return current ?? meta;
}
