# Buyer Assistant (React Native)

Mobil odakli Buyer Assistant uygulamasi.

## Calistirma

```bash
npm run assistant:dev
```

Alternatif:

```bash
npm run assistant:ios
npm run assistant:android
```

## API Baglantisi

Varsayilan API: `http://localhost:3000`

Farkli bir backend icin:

```bash
EXPO_PUBLIC_API_BASE_URL=http://<ip>:3000 npm run assistant:dev
```

## Bu Surumde

- Acilista sesli karsilama (TTS)
- Konum izni + GPS context
- `/v1/buyer-assistant/chat` ile mesajlasma
- Asistan yanitini sesli okuma (opsiyonel)
- Ilk chat arayuzu ve 3 oneriyi listede gosterme

## Not

Bu ilk mobil surumde sesli giris (STT) henuz eklenmedi. Sonraki adimda `expo-speech-recognition` veya native STT provider ile push-to-talk eklenebilir.
