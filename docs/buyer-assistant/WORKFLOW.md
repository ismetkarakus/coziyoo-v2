# Buyer Assistant Workflow v1

## 1. High-Level Akis
1. UI acilir, selamlama okunur (TTS).
2. Kullanici yazi veya sesle komut verir.
3. Backend `foods` snapshot ceker.
4. Snapshot + mesaj LLM promptuna gider.
5. JSON cikti parse edilir.
6. Cevap + oneriler UI'da gosterilir, gerekirse TTS okunur.

## 2. Runtime Bilesenleri
- Frontend: `buyer-assistant/src/components/BuyerAssistantScreen.tsx`
- API client: `buyer-assistant/src/services/buyerAssistantApi.ts`
- Backend route: `src/routes/buyer-assistant.ts`
- Data source: `public.foods` (+ `categories` join)

## 3. STT/TTS Akisi
- STT: `expo-speech-recognition` (native modul varsa)
- TTS: `expo-speech`
- Expo Go'da STT modul yoksa fallback uyari verilir, app cokus yapmaz.

## 4. Foods Data Akisi (Minimum Query Farki)
Bu sistem admin metadata'daki arama mantigini tekrar kullanir:
- `row_to_json(t)::text ILIKE` ile search
- Sabit allowlist + limit
- Sadece aktif, stokta ve available urunler

## 5. Endpointler
### 5.1 Foods Test
- `GET /v1/buyer-assistant/foods-test`
- Query: `search?`, `limit?`
- Amaç: UI-backend-data baglantisini hizli dogrulamak

### 5.2 Chat
- `POST /v1/buyer-assistant/chat`
- Auth: app token + buyer role (both ise `x-actor-role: buyer`)
- Input: `message`, `context`, `client.channel`
- Output: `replyText`, `recommendations[]`, `followUpQuestion`, `meta`

## 6. Fallback Kurallari
- LLM json parse olmazsa: duz metin reply kullan
- Oneri yoksa: foods snapshot'tan ilk 3 fallback oneri
- Upstream yoksa: standart fallback mesaji

## 7. Gozlem ve Debug
- UI: foods-test sonucu kartta gorunur
- API: `meta.model`, `meta.latencyMs`
- Fail durumlari: `ASSISTANT_UPSTREAM_ERROR`, `ASSISTANT_UNAVAILABLE`, `ROLE_NOT_ALLOWED`

## 8. Gelecek Adimlar
- Niyet siniflandirma (meal-search/surprise)
- Kisit profili (alerjen/diyet)
- Mesafe skoru ile siralama
- Session-level short memory (opsiyonel)
