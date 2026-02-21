# Coziyoo v2 Detaylı Görev Listesi (Sıfırdan, `/v1` Kontratlı)

## Kısa Özet
Bu planın amacı: marketplace backend’i sıfırdan, versiyonlu `/v1` API kontratıyla, güvenli ödeme doğrulaması, compliance zorunlulukları, finance/dispute altyapısı ve operasyonel hardening ile üretime hazır seviyeye getirmek.  
Liste “uygulayıcı karar vermeden ilerleyebilsin” diye kararları sabitleyerek yazıldı.

## İlerleme Durumu (2026-02-21)
1. `Tamamlandı`: 1, 2, 3, 4, 5
2. `Tamamlandı`: 8, 9, 10, 11
3. `Tamamlandı`: 12, 13, 14, 15
4. `Tamamlandı`: 16, 17, 18, 19
5. `Tamamlandı`: 20
6. `Tamamlandı`: 21, 22, 23, 24, 25, 26
7. `Tamamlandı`: 27
8. `Tamamlandı`: 28
9. `Tamamlandı`: 29
10. `Tamamlandı`: 30

## Public API / Interface / Type Değişimleri (Sabitlenecek)
1. Tüm public endpoint’ler sadece `/v1/*` altında olacak.
2. Yazma işlemlerinde `Idempotency-Key` desteklenecek.
3. Standart response envelope kullanılacak:
```json
{
  "data": {},
  "pagination": {}
}
```
4. Standart hata kodları kullanılacak: `PAGINATION_INVALID`, `SORT_FIELD_INVALID`, `CURSOR_INVALID`, `API_VERSION_UNSUPPORTED`, `ORDER_INVALID_STATE` vb.
5. App auth ve admin auth tamamen ayrılacak:
- App: `/v1/auth/*`
- Admin: `/v1/admin/auth/*`
6. Display name uniqueness kuralı DB seviyesinde `display_name_normalized` ile garanti edilecek.
7. Payment paid geçişi sadece server-side doğrulama ile yapılacak; return query ile asla yapılmayacak.
8. Order status machine sabit olacak ve illegal transition’lar engellenecek.
9. Compliance, lot traceability, allergen disclosure ve retention kuralları backend’de zorunlu uygulanacak.
10. Finance kayıtları immutable olacak; refund/chargeback sadece adjustment ile yansıtılacak.

## Detaylı Görev Listesi (Numaralı, Uçtan Uca)

1. Proje Charter ve Scope Freeze
Amaç: Tek sayfalık “ne yapıyoruz / ne yapmıyoruz” dökümanı yaz.
Çıktı: Goal, non-goal, başarı kriteri, milestone sınırları.
Kabul: Ekipte yorum farkı bırakmayacak kadar net.

2. Mimari Kararların Kilitlenmesi
Amaç: Runtime, DB, auth authority, payment modeli, API versioning kararlarını sabitle.
Çıktı: Architecture Decision Record (ADR) seti.
Kabul: “alternatif” kalmasın; implementasyon tek rotadan yürüsün.

3. Domain Model Freeze
Amaç: `User`, `Order`, `PaymentAttempt`, `Compliance`, `Lot`, `Finance` dahil tüm entity ve enum’ları finalize et.
Çıktı: Canonical domain spec.
Kabul: İsimlendirme/alan tipi çakışması kalmasın.

4. Order State Machine Spesifikasyonu
Amaç: Geçerli transition’ları ve guard kurallarını tek tabloya indir.
Çıktı: State transition matrix + policy kuralları.
Kabul: Her endpoint sadece izinli geçiş yapabilsin.

5. RBAC/Policy Matrix
Amaç: `buyer|seller|both` ve `admin|super_admin` bazlı endpoint yetki tablosu çıkar.
Çıktı: Endpoint-policy matrisi.
Kabul: “kim neyi yapar” belirsizliği sıfır.

6. API Kontratı (OpenAPI) v1.0 Taslağı
Amaç: Auth, Orders, Payments, Compliance, Finance, Admin endpointlerini sözleşme olarak yaz.
Çıktı: OpenAPI dosyaları + örnek request/response.
Kabul: Frontend ve backend aynı sözleşmeye bakarak geliştirebilsin.

7. Pagination ve Sorting Standardı
Amaç: Offset/cursor ayrımını endpoint bazında sabitle.
Çıktı: Endpoint->pagination mapping ve sort allowlist.
Kabul: Undefined sort field her zaman validation hatası dönsün.

8. Monorepo/Klasör Yapısı Kuralları
Amaç: `app`, `server`, `admin-panel`, `shared-contracts` yapısını netleştir.
Çıktı: Dizin standardı ve package sorumlulukları.
Kabul: Kod yeri/sahibi net olsun.

9. Environment ve Secret Stratejisi
Amaç: Ortam değişkenleri, doğrulama şeması ve gizli bilgi yönetimini tanımla.
Çıktı: Env schema ve örnek env template.
Kabul: Uygulama eksik/yanlış env ile açılmasın.

10. Server Foundation
Amaç: Bootstrapping, merkezi error handling, request logging, health/version endpoint.
Çıktı: Çalışan temel server iskeleti.
Kabul: Local ve test ortamında stabil ayağa kalksın.

11. DB Şema Tasarımı ve Migrations Planı
Amaç: PostgreSQL greenfield şema, index, FK, enum/check policy tasarla.
Çıktı: Migration sırası ve idempotent bootstrap stratejisi.
Kabul: Boş veritabanında tek komutla kurulabilsin.

12. Identity ve Session Altyapısı
Amaç: `users`, `admin_users`, `auth_sessions`, `admin_auth_sessions`, audit tablolarını devreye al.
Çıktı: Session lifecycle ve token policy.
Kabul: Refresh token’lar hashli, rotate ve revoke çalışır.

13. Auth Endpointleri (App)
Amaç: `register/login/refresh/logout/me/display-name-check`.
Çıktı: Auth v1 endpoint implementasyon planı.
Kabul: Display name uniqueness case-insensitive ve normalized zorunlu.

14. Auth Endpointleri (Admin)
Amaç: `admin/auth/login/refresh/logout/me`.
Çıktı: Ayrı admin auth flow.
Kabul: App token admin endpoint’e giremesin, tersi de geçmesin.

15. Idempotency Katmanı
Amaç: Monetary/critical write endpointlerde replay-safe davranış.
Çıktı: `idempotency_keys` modeli + middleware tasarımı.
Kabul: Duplicate request’te yan etkisiz aynı sonuç dönebilsin.

16. Core Marketplace Endpointleri
Amaç: Foods, Categories, Orders, Chats, Messages, Reviews, Favorites, Addresses kontratlarını tamamla.
Çıktı: Endpoint bazlı görev kırılımı.
Kabul: Tüm listelerde pagination/sort standardı uygulanmış olsun.

17. Payment Entegrasyon Akışı
Amaç: `payments/start`, `return`, `webhook`, `status` akışını güvenli hale getir.
Çıktı: Provider adapter + signature verification + callback persistence.
Kabul: Sadece doğrulanmış callback order’ı `paid` yapabilsin.

18. Compliance Workflow
Amaç: Seller compliance state machine ve admin review queue mekanizması.
Çıktı: Compliance profile/doc/check/event modelleri ve endpoint planı.
Kabul: UK/TR kuralları backend’de enforce edilsin.

19. Allergen Disclosure Enforcement
Amaç: `pre_order` ve `handover` disclosure kayıtlarını zorunlu kıl.
Çıktı: Disclosure endpointleri + order completion guard.
Kabul: Gerekli disclosure yoksa `completed` geçişi engellensin.

20. Lot Traceability ve Recall
Amaç: Production lot, allocation, recall süreçlerini zorunlu hale getir.
Çıktı: Lot/Allocation/Event modeli ve admin sorguları.
Kabul: Recalled lot yeni siparişe allocate edilemesin.

21. Seller Finance ve Commission Snapshot
Amaç: Versioned commission ayarı ve `order_finance` immutable kayıt sistemi.
Çıktı: Commission settings + finance hesaplama kuralları.
Kabul: Komisyon değişikliği sadece gelecekte finalize olan siparişleri etkilesin.

22. Dispute / Chargeback / Refund Workflow
Amaç: `payment_dispute_cases` ve `finance_adjustments` ile sorumluluk ataması.
Çıktı: Dispute lifecycle endpoint ve karar kuralları.
Kabul: Orijinal finance satırı değişmeden adjustment ile etki işlensin.

23. Delivery Proof (PIN) Kontrolü
Amaç: Delivery order’larda PIN gönderme/doğrulama zorunluluğu.
Çıktı: Delivery proof modeli ve verify gate.
Kabul: Başarılı PIN verify olmadan delivery completion olmasın (admin override hariç).

24. Abuse Protection (OWASP API6 Odaklı)
Amaç: signup/login/display-name-check/payment_start/refund/pin_verify akışlarını koru.
Çıktı: Rate, velocity, risk score, challenge/deny politikası.
Kabul: Yüksek risk monetary işlemler fail-closed davransın.

25. Outbox, Retry, DLQ ve Worker Planı
Amaç: Async olayların güvenilir işlenmesi.
Çıktı: Outbox modeli, retry politikası, DLQ stratejisi.
Kabul: Geçici hata durumlarında veri kaybı olmadan tekrar işlenebilsin.

26. Gözlemlenebilirlik ve Operasyon
Amaç: Log, metric, trace, SLO, alert ve incident runbook tanımları.
Çıktı: Monitoring/alert seti + backup/restore planı.
Kabul: Payment callback failure ve auth outage gibi kritik olaylar alarm üretsin.

27. Admin Grid Metadata ve Field Parity
Amaç: Admin tablolarında DB-field parity + dinamik kolon göster/gizle.
Çıktı: Metadata endpoint + `admin_table_preferences` modeli.
Kabul: Yeni DB alanları frontend redeploy olmadan seçilebilir kolon olarak görünsün.

28. Contract Test ve CI Kapısı
Amaç: OpenAPI uyumluluğunu otomatik denetle.
Çıktı: Contract test pipeline.
Kabul: Kontrat kıran değişiklik merge edilemesin.

29. Test Kapsamı Tamamlama
Amaç: Unit + integration + API contract + E2E senaryolarını tamamla.
Çıktı: Test matrisi ve coverage hedefleri.
Kabul: Kritik akışlar (order-payment-compliance-finance) otomasyonla korunuyor olsun.

30. Definition of Done Gate
Amaç: Yayın öncesi checklist ile tüm kalite kapılarını kapat.
Çıktı: DoD raporu.
Kabul: `/v1 only`, auth separation, payment verify, compliance enforcement, retention, finance immutability, abuse controls tamamlanmış olsun.

## Test Senaryoları (Zorunlu)
1. App auth token ile admin endpoint erişimi reddedilmeli.
2. Duplicate display name (case-insensitive/normalized) reddedilmeli.
3. `POST /v1/orders` idempotency key ile duplicate sipariş oluşturmamalı.
4. Payment return query tek başına `paid` yapmamalı.
5. Duplicate webhook aynı order transition’ı ikinci kez çalıştırmamalı.
6. UK compliance onaysız satıcı listing aktive edememeli.
7. `completed` geçişi disclosure kayıtları olmadan engellenmeli.
8. Commission değişimi eski finalize order finance kayıtlarını değiştirmemeli.
9. Refund/chargeback adjustment finance total’e doğru yansıtılmalı.
10. Delivery PIN verify başarısızken order delivered/completed olmamalı.
11. Abuse kontrolünde hızlı tekrar denemeler challenge/deny üretmeli.
12. Retention job 730 günden genç kayıtları silmemeli.

## Varsayımlar ve Seçilen Defaultlar
1. Veritabanı: PostgreSQL.
2. Backend: Node.js + Express + TypeScript.
3. Auth authority: Sadece backend JWT + rotating refresh.
4. API: Sadece `/v1`, versionless route yok.
5. Payment: External hosted checkout + server-side callback verification.
6. Komisyon default: `%10`, admin tarafından versiyonlu değiştirilebilir.
7. Retention: Minimum `730 gün`, legal-hold varsa purge yok.
8. Monetary writes için idempotency zorunlu kabul edildi.
9. Admin audit logging tüm mutable admin işlemlerde zorunlu kabul edildi.
10. Bu plan, önce backend sözleşmesi ve domain doğruluğunu, sonra app/admin uygulamasını ilerletme sırasını baz alır.
