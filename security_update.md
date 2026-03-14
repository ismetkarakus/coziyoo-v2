# Login Guvenligi ve Raporlama Plani (App+Admin, Device-Temelli)

## Ozet
Mevcut tablolarinizda `3 yanlis sifre sonrasi geciktirme/lock` icin ozel bir alan yok. Su an sadece `auth_audit/admin_auth_audit` event kaydi var.
Bu planla:
1. App login'de yanlis denemeleri kalici sayacla tutacagiz,
2. 3+ yanlis denemede kullaniciya bilgi verip kademeli gecikme uygulayacagiz (`2s -> 4s -> 8s -> max 15s`),
3. IP yerine app kullanicilarinda `device_id + device_name` ile kayit/raporlama yapacagiz,
4. Admin'de IP takibini mevcut haliyle koruyacagiz,
5. Admin paneline ayri bir **Security** rapor ekrani ekleyecegiz.

## Uygulama Degisiklikleri
- **DB (yeni tablolar)**
  - `security_login_events`
    - `id`, `realm` (`app|admin`), `actor_user_id` nullable, `identifier` (normalize email), `success` bool,
    - `failure_reason`, `device_id` nullable, `device_name` nullable, `ip` nullable, `user_agent`, `created_at`.
  - `security_login_state`
    - `realm`, `identifier` unique,
    - `consecutive_failed_count`, `last_failed_at`, `last_success_at`, `last_device_id`, `last_device_name`, `last_ip`.
  - Indeksler:
    - `security_login_events(created_at desc)`,
    - `(realm, identifier, created_at desc)`,
    - `(realm, device_id, created_at desc)` (app raporu icin),
    - `(realm, ip, created_at desc)` (admin tarafi icin).

- **Auth akisi (API)**
  - `POST /v1/auth/login`
    - Request'e `deviceId`, `deviceName` alanlari eklenir (app icin; geriye uyumlu geciste opsiyonel baslayacak).
    - Login basinda `security_login_state` okunur:
      - `consecutive_failed_count >= 3` ise delay uygulanir (`2-4-8-15s` cap).
    - Hatali giriste:
      - `consecutive_failed_count` artirilir,
      - `security_login_events` icine `success=false` + device alanlari yazilir,
      - response'da genel (enumeration-safe) uyari mesaji doner.
    - Basarili giriste:
      - `consecutive_failed_count` sifirlanir,
      - `security_login_events` icine `success=true` + device alanlari yazilir.
  - `POST /v1/admin/auth/login`
    - Ayni delay/state mantigi uygulanir (scope karari geregi),
    - device yerine mevcut `ip` kaydi korunur,
    - event/state admin realm'de tutulur.
  - Guvenlik notu:
    - Mesajlar kullanici var/yok ayrimini aciga cikarmayacak.
    - Delay hesaplamasi auth islemi oncesi, tek noktadan uygulanacak.

- **Rapor API + Admin UI**
  - Yeni admin endpointleri:
    - `GET /v1/admin/security/login-risk/summary`
      - son 24 saat: `3+ failed` hesaplar, shared device alarm sayilari, admin IP anomali sayilari.
    - `GET /v1/admin/security/login-risk/events`
      - filtre: realm, success, identifier, deviceId, ip, from/to, minFailedCount.
  - Admin'de yeni sayfa: **Security**
    - Kartlar:
      - "3+ yanlis deneme (24s)"
      - "Ayni deviceId ile coklu kullanici (24s)"
      - "Admin realm IP yogun anomali"
    - Detay tablo + CSV export.
  - "Ayni device" alarm kurali:
    - Son 24 saatte ayni `device_id` ile **en az 3 farkli kullanici** giris/denemesi.

## Arayuz / Sozlesme Degisiklikleri
- **Public API degisikligi (app login)**
  - `POST /v1/auth/login` body:
    - `deviceId?: string`, `deviceName?: string` (gecis donemi opsiyonel, sonra zorunluya cevrilebilir).
- **Yeni admin API'leri**
  - `/v1/admin/security/login-risk/summary`
  - `/v1/admin/security/login-risk/events`
- **Admin UI**
  - Yeni menu ogesi ve yeni "Security" sayfasi.

## Test Plani
- **Unit**
  - Delay hesap fonksiyonu: attempt 4/5/6/... icin 2/4/8/15s dogrulamasi.
  - State guncelleme: basarisizda artis, basarilida reset.
- **Integration (API)**
  - App login:
    - 1-3 yanlista delay yok, 4+'ta delay var.
    - Basarili login sonrasi sayac sifirlaniyor.
    - `security_login_events` dogru device alanlariyla yaziliyor.
  - Admin login:
    - Ayni delay/state akisi, IP alani dolu.
- **Rapor**
  - 24 saat penceresinde shared device (>=3 user) dogru sayiliyor.
  - 3+ failed listesi dogru donuyor.
  - Pagination/filter/sort calisiyor.
- **Regresyon**
  - Mevcut `auth_audit/admin_auth_audit` yazimlari ve login response davranisi bozulmuyor.

## Varsayimlar ve Secilen Defaultlar
- Scope: **App + Admin**.
- Politika: **Kademeli delay** (`2-4-8-15s cap`), hard lock yok.
- App tarafinda IP anomalisi yerine **device bazli** raporlama kullanilacak.
- Admin tarafinda IP takibi korunacak.
- Device storage: **ayri security event/state tablolari** (users tablosuna tekil kolon eklenmeyecek).
- Baslangicta app login'de `deviceId/deviceName` opsiyonel kabul edilip, istemci gecisi tamamlaninca zorunluya alinacak (breaking risk azalimi).
