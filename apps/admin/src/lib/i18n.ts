import en from "../i18n/en.json";
import tr from "../i18n/tr.json";
import type { Language, Dictionary } from "../types/core";

export const LANGUAGE_KEY = "admin_language";

export const DICTIONARIES: Record<Language, Dictionary> = {
  en,
  tr,
};

export const initializeLanguage = (): Language => {
  const stored = localStorage.getItem(LANGUAGE_KEY);
  if (stored === "tr" || stored === "en") return stored;
  return "tr";
};
