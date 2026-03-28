export const HOME_FEED_CATEGORIES = [
  "Tümü",
  "Çorbalar",
  "Ana Yemekler",
  "Salata",
  "Meze",
  "Tatlılar",
  "İçecekler",
] as const;

export const HOME_FOOD_CATEGORIES = HOME_FEED_CATEGORIES.filter((item) => item !== "Tümü");
