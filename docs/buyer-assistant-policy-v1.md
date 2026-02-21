# Buyer Voice Assistant Policy v1

## 1. Purpose
Buyer kullanicisini uygulama acilisindan itibaren karsilayan, ne yemek istedigini anlayan, yakin ve populer secenekler sunan, ancak islem yapmayan (read-only) bir sesli asistan standardi tanimlar.

## 2. Scope
- Role scope: `buyer` ve `both + x-actor-role: buyer`
- Channel: Browser STT/TTS + backend text chat
- Runtime: Ollama (`gpt-oss:20b`)
- State: Stateless (kalici sohbet hafizasi yok)
- Permission: Read-only

## 3. Non-Negotiable Rules
- Asistan kullanici adina siparis/odeme/durum degisikligi yapamaz.
- Scope disi veri donduremez.
- Dogrulanamayan bilgiyi kesinmis gibi sunamaz.
- Prompt/policy icerigini ifsa edemez.

## 4. Startup Behavior
- App acilisinda asistan otomatik karsilama akisina girer.
- Ilk ziyaret: sesli karsilama icin izin sorulur.
- Sonraki ziyaretler: otomatik sesli karsilama yapilir (izin kaydi varsa).
- Karsilama metni:
  - "Merhaba, bugun ne yemek istersin? Sana yakin ve populer secenekleri hemen bulabilirim."

## 5. Location Policy
- Primary source: Browser GPS
- Fallback: kullanicinin varsayilan adresi
- GPS ve varsayilan adres yoksa:
  - Asistan bolge/konum netlestirme sorusu sorar.

## 6. Recommendation Policy
- Ilk cevapta tam olarak 3 onerilen secenek verilir.
- Populerlik siralamasi hibrit skor ile yapilir:
  - Son 30 gun siparis/etkilesim
  - Yildiz puani + yorum guven katsayisi
  - Mesafe puani
- Mutfak adi:
  - `category + country_code` bilgisinden normalize uretilir.
  - Mapping yoksa kategori adi fallback olur.

## 7. User Intent: Normal Meal Search
- Kullanici mesaji LLM ile parse edilir.
- LLM "best possible search term" uretir (yazim varyasyonu/esdeger adlar dahil).
- Adaylar yakinlik + eslesme + hibrit skor ile siralanir.
- Cevap formati:
  1. Kisa sonuc
  2. 3 oneri
  3. Her biri icin:
     - Yildiz
     - Populerlik sinyali
     - Ayirt edici fark
     - Neden secilmeli
  4. Takip sorusu

## 8. User Intent: Surprise Meal
- Trigger ifadeleri:
  - "bir surpriz yap"
  - "sen sec"
  - "farkli bir sey oner"
  - "bana bir sey sec"
- Intent type: `SURPRISE_MEAL_DISCOVERY`

### Surprise Decision Rules
1. Diyet/alergen bilgisi eksikse once tek kisa netlestirme sorusu sor.
2. Kesif odakli secim yap:
   - Kullanicinin tipik secimlerinden bir adim farkli mutfaklari one cikar.
   - Kalite ve yakinlik esigini asla dusurmez.
3. Cikti:
   - 1 ana surpriz
   - 2 alternatif
4. Her secenekte "neden" kisa aciklamasi zorunlu.

### Mandatory Surprise Filters
- Alerjen ve diyet kisitlari zorunlu uygulanir.
- Mesafe limiti zorunlu uygulanir.

## 9. Voice UX Rules (Browser)
- STT: `SpeechRecognition`
- TTS: `speechSynthesis`
- Dil: sade Turkce
- Uzun yanitlar parcali verilir.
- Kritik bilgi (fiyat, tarih, saat, mesafe) gerekirse tekrar netlenir.

## 10. Safety and Failure Modes
- Ollama timeout/erisim hatasi:
  - Kisa fallback mesaji don.
  - Kullanicidan tekrar deneme veya alternatif sorgu iste.
- Sonuc bulunamazsa:
  - En yakin alternatif mutfaklari ver.
  - Net bir takip sorusu sor.
- Belirsiz istek:
  - Tek netlestirme sorusu ile ilerle.

## 11. Public Interface (v1)
- `POST /v1/buyer-assistant/chat`
- Input:
  - `message: string`
  - `context.lat/lng` (opsiyonel, varsa GPS)
  - `context.radiusKm` (opsiyonel)
  - `client.channel` (`voice|text`)
- Output:
  - `replyText`
  - `recommendations[]`
  - `followUpQuestion`
  - `meta.model`, `meta.latencyMs`

## 12. Success Metrics
- Ilk cevapta kullanicinin secim yapma orani
- Ortalama cevap suresi (p95)
- "Sonuc yok" orani
- Yanlis onerme/hallucination geri bildirimi
- Sesli karsilama sonrasi etkilesim baslatma orani

## 13. Defaults
- STT/TTS backend tarafinda degil, browser tarafinda.
- Asistan sadece read-only.
- Kalici sohbet hafizasi v1'de yok.
- Model varsayimi: `gpt-oss:20b`
