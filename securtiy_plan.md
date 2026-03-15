### Login Güvenliği ve Raporlama Planı (App, Device-Temelli)

### Özet
Mevcut tablolarda `yanlış şifre sonrası geciktirme/lock` için özel bir alan yok. Şu an sadece `auth_audit` event kaydı var.
Bu planla:
1. App login'de yanlış denemeleri kalıcı sayaçla tutacağız,
2. 3+ yanlış denemede kademeli gecikme uygulayacağız (`2s → 4s → 8s → 15s cap`) — gecikme **server'da sleep değil**, `Retry-After` header ile client'a bildirilecek,
3. 10+ yanlış denemede soft lock uygulanacak; kullanıcı e-posta doğrulamasıyla hesabını açabilecek,
4. `device_id + device_name` ile kayıt/raporlama yapılacak; `deviceId` olmayan isteklerde IP fallback uygulanacak,
5. Başarısız deneme eşiği aşıldığında kullanıcıya push/email ile bildirim gönderilecek,
6. Admin paneline **Security** rapor ekranı eklenecek.

### Scope
- **Bu plan: Sadece App (buyer/seller) login.**
- Admin login güvenliği ayrı bir plana bırakılmıştır.

---

### DB Değişiklikleri

**Yeni tablolar:**

`security_login_events`
- `id`, `realm` (şimdilik sadece `app`), `actor_user_id` nullable, `identifier` (lowercase + trim normalize edilmiş email/phone),
- `success` bool, `failure_reason`, `device_id` nullable, `device_name` nullable, `ip` nullable, `user_agent`, `created_at`.

`security_login_state`
- `realm`, `identifier` — birlikte unique (composite PK),
- `consecutive_failed_count`, `last_failed_at`, `last_success_at`,
- `last_device_id`, `last_device_name`, `last_ip`,
- `soft_locked` bool default false, `soft_locked_at` nullable.

**İndeksler:**
- `security_login_events(created_at desc)`
- `(realm, identifier, created_at desc)`
- `(realm, device_id, created_at desc)` — shared device raporu için
- `(realm, ip, created_at desc)` — deviceId olmayan fallback için

**Retention politikası:**
- `security_login_events` kayıtları 90 gün sonra silinir (scheduled job veya cron ile).

---

### Auth Akışı (API) — `POST /v1/auth/login`

**Request body değişikliği:**
- `deviceId?: string`, `deviceName?: string` — geçiş dönemi opsiyonel; istemci migrasyonu tamamlanınca zorunluya alınacak.
- `deviceId` yoksa `ip` fallback olarak kullanılır (kör nokta oluşmaz).

**Identifier normalizasyonu:**
- Lowercase + trim. `+` alias'ları olduğu gibi bırakılır (ayrıca bir karar gerektirir).

**Login başında state kontrolü:**
1. `security_login_state` okunur — `(realm='app', identifier)` üzerinden.
2. `soft_locked = true` ise:
   - Anında `423 Locked` döner, `Retry-After` header'da unlock talimatı verilir.
   - Server **sleep yapmaz**.
3. `consecutive_failed_count >= 3` ise delay hesaplanır:
   - `count=3 → 2s`, `4 → 4s`, `5 → 8s`, `6+ → 15s`
   - `last_failed_at + delay > now` ise `429 Too Many Requests` + `Retry-After: <seconds>` döner.
   - Server **sleep yapmaz** — gecikme tamamen client-side'dır.

**Hatalı girişte (atomik):**
```sql
INSERT INTO security_login_state (realm, identifier, consecutive_failed_count, last_failed_at, last_device_id, last_device_name, last_ip)
VALUES ('app', $identifier, 1, now(), $deviceId, $deviceName, $ip)
ON CONFLICT (realm, identifier) DO UPDATE
  SET consecutive_failed_count = security_login_state.consecutive_failed_count + 1,
      last_failed_at = now(),
      last_device_id = EXCLUDED.last_device_id,
      last_device_name = EXCLUDED.last_device_name,
      last_ip = EXCLUDED.last_ip,
      soft_locked = CASE WHEN security_login_state.consecutive_failed_count + 1 >= 10 THEN true ELSE security_login_state.soft_locked END,
      soft_locked_at = CASE WHEN security_login_state.consecutive_failed_count + 1 >= 10 AND NOT security_login_state.soft_locked THEN now() ELSE security_login_state.soft_locked_at END
```
- `security_login_events` içine `success=false` + device/ip alanları yazılır.
- `consecutive_failed_count` 3'e ulaştığında kullanıcıya push/email bildirimi gönderilir.
- `consecutive_failed_count` 10'a ulaştığında soft lock aktif olur + kullanıcıya unlock linki içeren email gönderilir.
- Response: genel (enumeration-safe) hata mesajı.

**Başarılı girişte:**
```sql
UPDATE security_login_state
SET consecutive_failed_count = 0, last_success_at = now(), soft_locked = false, soft_locked_at = null
WHERE realm = 'app' AND identifier = $identifier
```
- `security_login_events` içine `success=true` yazılır.

**Soft lock açma akışı:**
- Kullanıcı email'deki linke tıklar → `POST /v1/auth/unlock` (token ile doğrulama).
- Doğrulama başarılıysa `soft_locked = false`, `consecutive_failed_count = 0`.

**Güvenlik notları:**
- Tüm response mesajları kullanıcı var/yok ayrımını açığa çıkarmayacak.
- Delay/lock kontrolü auth işlemi öncesi, tek noktadan uygulanacak.

---

### Rapor API + Admin UI

**Yeni admin endpointleri (superadmin rolü zorunlu):**
- `GET /v1/admin/security/login-risk/summary`
  - Son 24 saat: `3+ failed` hesap sayısı, `soft_locked` hesap sayısı, shared device alarm sayısı.
- `GET /v1/admin/security/login-risk/events`
  - Filtre: `success`, `identifier`, `deviceId`, `ip`, `from/to`, `minFailedCount`, `softLocked`.
  - Pagination + sort.

**Admin'de yeni sayfa: Security**
- Kartlar:
  - "3+ yanlış deneme (24s)"
  - "Soft lock'ta hesaplar"
  - "Aynı deviceId ile çoklu kullanıcı (24s)"
- Detay tablo + CSV export (yalnızca superadmin rolü).
- "Aynı device" alarm kuralı: Son 24 saatte aynı `device_id` ile **en az 3 farklı kullanıcı** giriş/denemesi.
- Shared device alarm eşiği admin ayarlardan yapılandırılabilir (hardcode edilmeyecek).

---

### Arayüz / Sözleşme Değişiklikleri

**Public API değişikliği:**
- `POST /v1/auth/login` body: `deviceId?: string`, `deviceName?: string`
- Yeni HTTP response kodları:
  - `429 Too Many Requests` + `Retry-After: <seconds>` — delay durumunda
  - `423 Locked` + `Retry-After` header — soft lock durumunda

**Yeni app endpoint:**
- `POST /v1/auth/unlock` — soft lock kaldırma (email token ile)

**Yeni admin API'leri:**
- `GET /v1/admin/security/login-risk/summary`
- `GET /v1/admin/security/login-risk/events`

---

### Test Planı

**Unit:**
- Delay hesap fonksiyonu: count 3/4/5/6+ için 2/4/8/15s doğrulaması.
- Soft lock eşiği: count=10'da `soft_locked=true` set ediliyor.
- State güncelleme atomik: eş zamanlı 5 istek count'u tam 5 artırıyor (race condition yok).
- Başarılıda reset: count=0, soft_locked=false.
- Identifier normalizasyonu: boşluk, büyük harf, mixed case → aynı identifier.

**Integration (API):**
- 1-2 yanlışta `401`, delay yok.
- 3. yanlıştan itibaren `429` + doğru `Retry-After` değeri.
- 10. yanlışta `423` dönüyor, soft_locked=true.
- Başarılı login sonrası sayaç sıfırlanıyor, soft lock kalkmış.
- `deviceId` olmayan istekte `ip` fallback ile event yazılıyor.
- `security_login_events` doğru device/ip alanlarıyla yazılıyor.
- 3. yanlışta bildirim gönderildi (mock).
- 10. yanlışta unlock email gönderildi (mock).

**Rapor:**
- 24 saat penceresinde shared device (>=3 user) doğru sayılıyor.
- 3+ failed ve soft_locked listesi doğru dönüyor.
- Pagination/filter/sort çalışıyor.
- CSV export yalnızca superadmin rolüyle erişilebilir.

**Regresyon:**
- Mevcut `auth_audit` yazımları ve login response davranışı bozulmuyor.
- Admin login akışı değişmiyor.

---

### Varsayımlar ve Seçilen Defaultlar

- Scope: **Sadece App login** (admin ayrı plan).
- Gecikme: **Client-side Retry-After** — server sleep yok (DoS riski taşımaz).
- Politika: Kademeli delay (`2-4-8-15s cap`) + **soft lock 10+ yanlışta** (hard lock yok, unlock akışı var).
- Device ID spoofing riski: `deviceId` olmayan veya şüpheli istekler IP fallback ile izlenir; lock/delay `(realm, identifier)` bazlı tutulduğundan device rotasyonu bypass etmez.
- Identifier normalizasyonu: lowercase + trim (kesin kural).
- Device storage: ayrı security event/state tabloları (users tablosuna kolon eklenmeyecek).
- Shared device alarm eşiği: varsayılan 3 farklı kullanıcı/24s, admin ayardan değiştirilebilir.
- Retention: `security_login_events` 90 gün.
- `deviceId/deviceName` başlangıçta opsiyonel; istemci migrasyonu tamamlanınca zorunluya alınacak.
