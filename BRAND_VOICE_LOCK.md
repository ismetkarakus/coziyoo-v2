# Coziyoo Brand Voice Lock (Immutable)

Bu dosya, Coziyoo metin dilinin kalici kilididir. Aksi belirtilmedikce degistirilemez.

## 1) Zorunlu Dil Kurali
- Tum mobil uygulama metinleri:
  - Tam Turkce
  - Samimi "sen" dili
  - Kisa ve net cumleler
  - Guven veren, insani ton
- Kurumsal/robotik dil kullanilmaz.

## 2) Ana Slogan (Sabit)
- `Komsunun mutfagindan kapina`
- Bu slogan degistirilemez.
- Home ekraninda arama cubugunun altinda tek satir gorunur.

## 3) Yasak Uslup
- "Siparisiniz basariyla olusturulmustur" gibi kurumsal kaliplar
- Teknik ve soguk metinler (`request failed`, `saved`, vb.) son kullaniciya acik sekilde verilmez
- Turkce-Ingilizce karisik UI metni

## 4) Uygulama Kapsami
- Mobildeki tum UI metinleri tek kaynaktan yonetilir:
  - `apps/mobile/src/copy/brandCopy.ts`
- Yeni bir metin eklenecekse dogrudan ekran dosyasina yazilmaz; once `brandCopy`ya eklenir.

## 5) Degisiklik Politikasi
- Bu ses/ton yalnizca urun sahibinin acik talimatiyla degistirilebilir.
- Aksi durumda tum yeni ekran ve degisiklikler bu dile uymak zorundadir.
