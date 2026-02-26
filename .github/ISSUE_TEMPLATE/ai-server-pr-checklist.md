---
name: AI Server PR Checklist
about: AI server geliştirmesi için task/issue checklist'i
labels: ["ai-server", "backend", "checklist"]
---

## Kısa kullanım

- Bu issue’yu AI Server task/issue olarak açın.
- Geliştirici maddeleri tek tek tamamlayıp PR açsın.
- PR’da aşağıdaki kanıtları zorunlu isteyin:
  - `join log` (`can_publish=true`)
  - `audio_publish_end` logu (`track_sid` ile)
  - greeting + chat + interrupt test çıktıları
- Staging’de test edin:
  - `AGENT_AUDIO_TRACK_AVAILABLE` görünmeli
  - `BROWSER_TTS_FALLBACK` kaybolmalı
- Sonra production’a alın.

---

## AI Server PR Checklist

### A. Config & Boot
- [ ] `assistant/config.json` loader required `stt/tts/llm` alanlarını doğruluyor
- [ ] Geçersiz config’te uygulama fail-fast davranıyor
- [ ] Boot log `config_validated=true` içeriyor

### B. Join & Session
- [ ] Join endpoint `roomName`, `participantIdentity`, `token`, `voiceMode`, `payload.deviceId` parse ediyor
- [ ] Worker LiveKit room’a başarıyla join oluyor
- [ ] Join log `joined_room=true`, `can_publish=true` içeriyor

### C. Text Pipeline
- [ ] User chat path agent text response üretiyor
- [ ] Greeting instruction path agent text response üretiyor
- [ ] LLM timeout/retry policy uygulanmış
- [ ] Loglar `llm_start`, `llm_end`, `llm_ms` içeriyor

### D. TTS Pipeline
- [ ] TTS configured engine ile çalışıyor
- [ ] Output validation boş audio’yu reddediyor (`audio_bytes > 0`)
- [ ] Loglar `tts_start`, `tts_end`, `tts_ms`, `audio_bytes`, `tts_engine` içeriyor

### E. Audio Publish (Critical)
- [ ] TTS output LiveKit-compatible audio source’a dönüştürülüyor
- [ ] Agent local audio track’i room’a publish ediyor
- [ ] Publish success log `audio_publish_end`, `track_sid` içeriyor
- [ ] Publish failure log `audio_publish_failed`, error code içeriyor

### F. Interrupt / Barge-in
- [ ] `system_instruction: interrupt` handler uygulanmış
- [ ] Aktif TTS/playback anında durduruluyor
- [ ] Log `interrupt_applied=true` içeriyor

### G. Payload Contract to Client
- [ ] Agent message payload `ttsEngine` içeriyor
- [ ] Agent message payload `ttsProfileId` ve `ttsProfileName` içeriyor (varsa)
- [ ] Opsiyonel: `audioPublished` ve `audioErrorCode`

### H. Observability
- [ ] Her tur için `turn_id` üretiliyor
- [ ] Tüm stage logları şunları içeriyor: `room_name`, `device_id`, `participant_identity`, `turn_id`
- [ ] End-to-end turn latency loglanıyor (`end_to_end_ms`)

### I. Smoke Tests
- [ ] Connect greeting ile hem text hem audio track tetikliyor
- [ ] Chat mesajı hem text hem audio track döndürüyor
- [ ] Konuşma sırasında interrupt mevcut audio’yu durduruyor
- [ ] Sağlıklı path’te client browser fallback’e ihtiyaç duymuyor (`AGENT_AUDIO_TRACK_AVAILABLE` görülüyor)

### J. Rollout Safety
- [ ] Önce staging’e deploy edildi
- [ ] Staging loglarında LiveKit track publish doğrulandı
- [ ] Client verbose event doğrulaması yapıldı:
  - [ ] `AGENT_AUDIO_TRACK_AVAILABLE`
  - [ ] persistent `BROWSER_TTS_FALLBACK` yok
- [ ] Staging geçince production’a promote edildi

---

## PR Kanıtları (zorunlu)

PR açıklamasına aşağıdakileri ekleyin:

- [ ] `join log` ekran çıktısı / snippet (`can_publish=true`)
- [ ] `audio_publish_end` log snippet’i (`track_sid` ile)
- [ ] greeting test çıktısı
- [ ] chat test çıktısı
- [ ] interrupt test çıktısı
- [ ] staging doğrulaması: `AGENT_AUDIO_TRACK_AVAILABLE` mevcut
- [ ] staging doğrulaması: `BROWSER_TTS_FALLBACK` persistent değil
