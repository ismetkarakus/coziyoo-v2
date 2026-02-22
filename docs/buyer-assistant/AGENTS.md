# Buyer Assistant AGENTS Guide

Bu dokuman, projede Buyer Assistant alanina dokunacak gelistirme ajanlari icin calisma protokoludur.

## 1. Once Oku
1. `docs/buyer-assistant-policy-v1.md`
2. `docs/buyer-assistant/SOUL.md`
3. `docs/buyer-assistant/POLICY.md`
4. `docs/buyer-assistant/WORKFLOW.md`
5. `src/routes/buyer-assistant.ts`

## 2. Kod Degisiklik Prensipleri
- Mevcut admin metadata sorgu desenlerini tekrar kullan.
- Gereksiz yeni SQL pattern olusturma.
- Read-only sınırını bozacak endpoint ekleme.
- Response kontratini bozma (`replyText`, `recommendations`, `followUpQuestion`, `meta`).

## 3. Dosya Sahipligi
- Frontend UI: `buyer-assistant/src/components/*`
- API client: `buyer-assistant/src/services/*`
- Backend route: `src/routes/buyer-assistant.ts`
- Politika/dokuman: `docs/buyer-assistant/*`

## 4. Degisiklik Sonrasi Min Kontroller
- Backend: `npm run build`
- Frontend TS: `npx tsc --noEmit -p buyer-assistant/tsconfig.json`
- Manual: `/v1/buyer-assistant/foods-test` ve `/v1/buyer-assistant/chat`

## 5. Yasaklar
- Hard-coded gizli bilgi ekleme
- Mutasyon endpointleriyle assistant baglama
- Prompt icine policy ifsasi koyma

## 6. PR Checklist (Kisa)
- [ ] Read-only kurali korunuyor
- [ ] Query farkliligi minimum
- [ ] Fallback akisi calisiyor
- [ ] Mobil + web baglanti davranisi test edildi
