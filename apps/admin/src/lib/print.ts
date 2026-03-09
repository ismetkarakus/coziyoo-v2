export function printModalContent(target: HTMLElement | null) {
  if (!target) return;

  const clone = target.cloneNode(true) as HTMLElement;
  clone.querySelector(".buyer-ops-modal-actions")?.remove();
  clone.querySelectorAll(".records-copy-btn").forEach((el) => el.remove());

  const win = window.open("", "_blank", "noopener,noreferrer,width=1000,height=750");
  if (!win) return;

  const printHtml = `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Coziyoo Admin - Yazdır</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      color: #0b1120;
      background: #f5f7fb;
      padding: 20px;
    }
    .print-page-shell {
      max-width: 1100px;
      margin: 0 auto;
      display: grid;
      gap: 14px;
    }
    .print-page-actions {
      position: sticky;
      top: 0;
      z-index: 4;
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      background: #f5f7fb;
      padding: 8px 0;
    }
    .print-page-actions button {
      border: 1px solid #c7d1e3;
      background: #fff;
      color: #0b1120;
      border-radius: 8px;
      height: 34px;
      padding: 0 12px;
      font-weight: 600;
      cursor: pointer;
    }
    .print-page-actions button.primary {
      border-color: #2766cc;
      background: #2766cc;
      color: #fff;
    }
    .print-content {
      background: #fff;
      border: 1px solid #d5dbe8;
      border-radius: 10px;
      padding: 16px;
    }
    h3 { font-size: 17px; font-weight: 700; margin-bottom: 4px; }
    h4 { font-size: 14px; font-weight: 700; margin-bottom: 10px; }
    p { font-size: 13px; }
    strong { font-weight: 600; }
    .panel-meta { font-size: 12px; color: #5a6a82; }

    .records-order-section {
      border: 1px solid #d5dbe8;
      border-radius: 8px;
      padding: 14px;
      margin-bottom: 14px;
    }
    .records-order-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid #e8edf5;
    }
    .records-order-title-wrap { display: flex; align-items: center; gap: 6px; }
    .records-order-status-wrap { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #5a6a82; }
    .records-order-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-bottom: 12px;
    }
    .records-order-info-card {
      border: 1px solid #e8edf5;
      border-radius: 8px;
      padding: 8px 10px;
    }
    .records-order-info-card > span:first-child {
      display: block;
      font-size: 11px;
      color: #5a6a82;
      margin-bottom: 2px;
    }
    .records-order-info-card > strong { font-size: 13px; word-break: break-all; }
    .records-order-info-card > .panel-meta { margin-top: 4px; }
    .records-order-info-meta { background: transparent; border-color: transparent !important; }
    .records-order-info-meta > div {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 0;
      border-bottom: 1px solid #f0f2f6;
    }
    .records-order-info-meta > div:last-child { border-bottom: none; }
    .records-order-info-meta > div > span { flex: 0 0 130px; font-size: 11px; color: #5a6a82; }
    .records-order-info-meta > div > strong { font-size: 13px; }
    .records-order-summary-inline {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 8px;
    }
    .records-order-uuid-row { display: flex; align-items: center; gap: 4px; }
    .records-order-uuid-text { font-size: 11px; color: #5a6a82; font-family: monospace; }
    .records-order-total-inline { display: flex; align-items: center; gap: 8px; }
    .records-order-total-inline > span { font-size: 12px; color: #5a6a82; }
    .records-order-total-inline > strong { font-size: 18px; font-weight: 700; }

    .status-pill {
      display: inline-block;
      padding: 2px 9px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
      border: 1px solid currentColor;
    }
    .is-pending { color: #9a6200; }
    .is-approved, .is-done, .is-paid { color: #0a6a30; }
    .is-disabled { color: #5a6a82; }
    .is-delivery { color: #1a4a9a; }
    .is-success { color: #0a6a30; }
    .is-warning { color: #9a6200; }

    .table-wrap { overflow: visible; margin-top: 8px; }
    table { border-collapse: collapse; width: 100%; font-size: 12px; }
    th, td { border: 1px solid #d5dbe8; padding: 5px 8px; text-align: left; vertical-align: top; }
    th { background: #f5f7fa; font-weight: 600; font-size: 11px; }

    .seller-doc-viewer-grid { display: grid; grid-template-columns: 180px 1fr; gap: 12px; }
    .seller-doc-viewer-list { display: flex; flex-direction: column; gap: 6px; }
    .seller-doc-viewer-list button {
      text-align: left; font-size: 12px; color: #0b1120;
      padding: 6px 8px; border: 1px solid #d5dbe8; border-radius: 6px; background: #f5f7fa;
    }
    .seller-doc-viewer-list button.is-active { border-color: #3a7bca; background: #eaf2ff; }
    .seller-doc-viewer-preview img { max-width: 100%; height: auto; border: 1px solid #d5dbe8; border-radius: 6px; }
    .seller-doc-viewer-preview iframe { width: 100%; height: 500px; border: 1px solid #d5dbe8; border-radius: 6px; }

    .buyer-ops-modal-actions, .records-copy-btn { display: none !important; }

    @media print {
      @page { margin: 1.5cm; }
      body { background: #fff; padding: 0; }
      .print-page-actions { display: none !important; }
      .print-content { border: 0; border-radius: 0; padding: 0; }
    }
  </style>
</head>
<body>
  <main class="print-page-shell">
    <div class="print-page-actions">
      <button type="button" onclick="window.close()">Kapat</button>
      <button type="button" class="primary" onclick="window.print()">Yazdır</button>
    </div>
    <section class="print-content">${clone.innerHTML}</section>
  </main>
</body>
</html>`;

  win.document.open();
  win.document.write(printHtml);
  win.document.close();
  win.focus();
}
