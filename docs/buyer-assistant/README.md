# Buyer Assistant Docs Index

Bu klasor, Buyer Assistant'in kimligini, davranisini, is akislarini ve prompt standardini tek yerde toplar.

## Hangi Dosya Ne Icin?

| Dosya | Amac | Ne Zaman Okunur? |
|---|---|---|
| `SOUL.md` | Asistanin karakteri, tonu, sinirlari | Yeni ozellik eklemeden once |
| `POLICY.md` | Guvenlik, read-only, role ve data kurallari | Endpoint/UI davranisi degisirken |
| `WORKFLOW.md` | Uctan uca teknik akis (STT -> API -> Foods -> LLM -> TTS) | Bugfix, entegrasyon, runtime sorunlarinda |
| `PROMPTS.md` | System prompt, payload semasi, cevap formati | Prompt degisikligi yaparken |
| `AGENTS.md` | Gelistirme protokolu ve kontrol listesi | Kod degisikligine baslamadan once |

## Hızlı Okuma Sırası
1. `SOUL.md`
2. `POLICY.md`
3. `WORKFLOW.md`
4. `PROMPTS.md`
5. `AGENTS.md`

## Kısa Kural Seti
- Assistant daima read-only kalir.
- Mutasyon endpointlerine baglanmaz.
- Query farkliligi minimum tutulur (mevcut metadata/query desenleri tercih edilir).
- Prompt degisikligi policy ile uyumlu olmadan merge edilmez.

## Uygulama ile Dogrudan Ilgili Dosyalar
- Backend route: `src/routes/buyer-assistant.ts`
- Mobile/Web UI: `buyer-assistant/src/components/BuyerAssistantScreen.tsx`
- API client: `buyer-assistant/src/services/buyerAssistantApi.ts`
