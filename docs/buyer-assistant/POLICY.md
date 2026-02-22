# Buyer Assistant Policy v2 (Operational)

## 1. Scope
- Kanal: voice + text
- Rol: `buyer`, `both` + `x-actor-role: buyer`
- Yetki: read-only

## 2. Yetki ve Guvenlik
- Mutasyon endpointlerine asla cagri yok
- Siparis/odeme/state degisikligi yok
- Prompt/policy gizli kalir
- Hata durumunda detayli internal stack paylasilmaz

## 3. Data Kullanimi
- Birincil kaynak: `foods` + `categories`
- Filtre: `is_active=TRUE`, `is_available=TRUE`, `current_stock>0`
- Search: case-insensitive text match (`ILIKE`)
- Max öneri: 3

## 4. Yanit Kurallari
- Kisa, net, eylem odakli
- Uydurma bilgi yasak
- Kritik degerlerde (fiyat/mesafe) emin degilse belirt

## 5. Hata Modlari
- `ASSISTANT_UPSTREAM_ERROR`: upstream problem
- `ASSISTANT_UNAVAILABLE`: model/timeout ulasilamiyor
- `ROLE_NOT_ALLOWED`: buyer disi rol

## 6. Logging ve Privacy
- Kisisel veri minumum tasinmali
- Session memory kalici tutulmaz (v1)
- Audit ihtiyaci icin server tarafinda kontrollu log

## 7. Kabul Kriterleri
- Foods test endpointi 2xx donmeli
- Chat endpointi 2xx + 3'e kadar oneri donmeli
- Upstream yokken fallback mesaji gorunmeli
- Expo Go'da STT yoksa crash olmamali
