# Coziyoo Admin Panel

This folder contains the Coziyoo admin panel frontend.

## Deployment Trigger Test

This README was added to verify GitHub Actions auto-deploy on push to `main`.

## UI Component Reuse Rule

- Component olan UI parcalari tekrar yazilmaz, mevcut component kullanilir.
- Ayni ozellige sahip butonlar (or. `PrintButton`, `ExcelExportButton`) tum sayfalarda tek ortak componentten kullanilir.
- Ortak bir davranis degisecekse sadece component/utility degistirilir; sayfa bazli kopya kod eklenmez.
