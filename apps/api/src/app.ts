import express from "express";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { adminAuthRouter } from "./routes/admin-auth.js";
import { ordersRouter } from "./routes/orders.js";
import { paymentsRouter } from "./routes/payments.js";
import { sellerComplianceRouter, adminComplianceRouter } from "./routes/compliance.js";
import { orderAllergenRouter } from "./routes/order-allergen.js";
import {
  adminCommissionRouter,
  sellerFinanceRouter,
  orderDisputeRouter,
  adminDisputeRouter,
  adminFinanceRouter,
} from "./routes/finance.js";
import { requestContext } from "./middleware/observability.js";
import { deliveryProofRouter, adminDeliveryProofRouter } from "./routes/delivery-proof.js";
import { sellerLotsRouter, adminLotsRouter } from "./routes/lots.js";
import { adminMetadataRouter } from "./routes/admin-metadata.js";
import { docsRouter } from "./routes/docs.js";
import { adminDashboardRouter } from "./routes/admin-dashboard.js";
import { adminUserManagementRouter } from "./routes/admin-users.js";
import { adminAuditRouter } from "./routes/admin-audit.js";
import { adminSystemRouter } from "./routes/admin-system.js";
import { env } from "./config/env.js";
import { liveKitRouter } from "./routes/livekit.js";
import { adminLiveKitRouter } from "./routes/admin-livekit.js";
import { adminApiTokenRouter } from "./routes/admin-api-tokens.js";

export const app = express();

const corsOrigins = env.CORS_ALLOWED_ORIGINS.split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const allowAnyOrigin = corsOrigins.includes("*");
const allowedCorsOrigins = new Set(corsOrigins.filter((value) => value !== "*" && !value.includes("*")));
const wildcardCorsOrigins = corsOrigins.filter((value) => value !== "*" && value.includes("*"));

function wildcardOriginMatches(origin: string, wildcardPattern: string): boolean {
  try {
    const originUrl = new URL(origin);
    const patternUrl = new URL(wildcardPattern.replace("://*.", "://wildcard."));
    if (!wildcardPattern.includes("://*.")) return false;
    if (originUrl.protocol !== patternUrl.protocol) return false;
    if (patternUrl.port && originUrl.port !== patternUrl.port) return false;
    const suffix = patternUrl.hostname.replace(/^wildcard\./, "");
    if (!suffix) return false;
    return originUrl.hostname.endsWith(`.${suffix}`) && originUrl.hostname !== suffix;
  } catch {
    return false;
  }
}

function isCorsOriginAllowed(origin: string): boolean {
  if (allowAnyOrigin) return true;
  if (allowedCorsOrigins.has(origin)) return true;
  return wildcardCorsOrigins.some((pattern) => wildcardOriginMatches(origin, pattern));
}

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && isCorsOriginAllowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", allowAnyOrigin ? "*" : origin);
    if (!allowAnyOrigin) {
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
    res.setHeader("Access-Control-Max-Age", "600");
  }

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  return next();
});

app.use(requestContext);

app.use(
  express.json({
    limit: env.JSON_BODY_LIMIT,
    strict: false,
    type: ["application/json", "application/*+json", "text/plain"],
    verify: (req, _res, buf) => {
      (req as { rawBody?: string }).rawBody = buf.toString("utf8");
    },
  })
);

app.get("/", (_req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html lang="tr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Coziyoo API Status</title>
    <style>
      :root {
        --bg-a: #0b1020;
        --bg-b: #111a35;
        --card: rgba(255, 255, 255, 0.08);
        --text: #eaf0ff;
        --muted: #a7b5d8;
        --ok: #1ed760;
        --warn: #ff9f1a;
        --down: #ff4d4f;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
        color: var(--text);
        background: radial-gradient(circle at 15% 20%, #1d2a55 0%, transparent 35%),
                    radial-gradient(circle at 85% 80%, #233f7a 0%, transparent 35%),
                    linear-gradient(160deg, var(--bg-a), var(--bg-b));
      }
      .panel {
        width: min(92vw, 760px);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 18px;
        padding: 28px;
        background: var(--card);
        backdrop-filter: blur(8px);
        box-shadow: 0 30px 60px rgba(0, 0, 0, 0.35);
      }
      .head {
        display: flex;
        align-items: center;
        gap: 14px;
      }
      .icon {
        width: 44px;
        height: 44px;
      }
      h1 {
        margin: 0;
        font-size: 24px;
      }
      .sub {
        margin-top: 8px;
        color: var(--muted);
      }
      .status {
        margin-top: 20px;
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        font-weight: 700;
      }
      .dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: var(--warn);
        box-shadow: 0 0 14px var(--warn);
      }
      .meta {
        margin-top: 18px;
        color: var(--muted);
        font-size: 14px;
      }
      code {
        color: #d7e3ff;
      }
      .ok .dot { background: var(--ok); box-shadow: 0 0 14px var(--ok); }
      .down .dot { background: var(--down); box-shadow: 0 0 14px var(--down); }
    </style>
  </head>
  <body>
    <main class="panel">
      <div class="head">
        <svg class="icon" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <rect x="8" y="8" width="48" height="48" rx="12" fill="rgba(255,255,255,0.2)"/>
          <rect x="18" y="18" width="28" height="8" rx="4" fill="white"/>
          <rect x="18" y="30" width="22" height="8" rx="4" fill="white"/>
          <circle cx="48" cy="34" r="3" fill="#1ed760"/>
          <rect x="18" y="42" width="16" height="4" rx="2" fill="white"/>
        </svg>
        <div>
          <h1>Coziyoo API Status</h1>
          <p class="sub">Sunucu durumu canlı olarak kontrol ediliyor.</p>
        </div>
      </div>

      <div id="statusPill" class="status">
        <span class="dot"></span>
        <span id="statusText">Kontrol ediliyor...</span>
      </div>

      <p id="details" class="meta">Endpoint: <code>/v1/health</code></p>
    </main>

    <script>
      const pill = document.getElementById("statusPill");
      const statusText = document.getElementById("statusText");
      const details = document.getElementById("details");

      async function check() {
        try {
          const res = await fetch("/v1/health", { cache: "no-store" });
          const data = await res.json();
          const db = data?.data?.db ?? "unknown";
          const dbTime = data?.data?.dbTime ?? "-";
          if (res.ok && data?.data?.status === "ok") {
            pill.classList.add("ok");
            pill.classList.remove("down");
            statusText.textContent = "API Server çalışıyor";
            details.textContent = "DB: " + db + " | DB Time: " + dbTime;
          } else {
            pill.classList.add("down");
            pill.classList.remove("ok");
            statusText.textContent = "API Server sorunlu";
            details.textContent = "Health endpoint HTTP " + res.status + " | DB: " + db;
          }
        } catch (_error) {
          pill.classList.add("down");
          pill.classList.remove("ok");
          statusText.textContent = "API Server durdu veya erişilemiyor";
          details.textContent = "Health endpoint'e ulaşılamadı.";
        }
      }

      check();
      setInterval(check, 15000);
    </script>
  </body>
</html>`);
});

app.get("/v1", (_req, res) => {
  res.json({
    data: {
      service: "coziyoo-api-v2",
      version: "v1",
    },
  });
});

app.use("/v1/health", healthRouter);
app.use("/v1/auth", authRouter);
app.use("/v1/admin/auth", adminAuthRouter);
app.use("/v1/orders", ordersRouter);
app.use("/v1/payments", paymentsRouter);
app.use("/v1/seller/compliance", sellerComplianceRouter);
app.use("/v1/admin/compliance", adminComplianceRouter);
app.use("/v1/orders", orderAllergenRouter);
app.use("/v1/orders", deliveryProofRouter);
app.use("/v1/seller/lots", sellerLotsRouter);
app.use("/v1/admin/lots", adminLotsRouter);
app.use("/v1/admin/commission-settings", adminCommissionRouter);
app.use("/v1/sellers", sellerFinanceRouter);
app.use("/v1/orders", orderDisputeRouter);
app.use("/v1/admin/disputes", adminDisputeRouter);
app.use("/v1/admin/finance", adminFinanceRouter);
app.use("/v1/admin", adminDeliveryProofRouter);
app.use("/v1/admin", adminMetadataRouter);
app.use("/v1/admin", adminDashboardRouter);
app.use("/v1/admin", adminUserManagementRouter);
app.use("/v1/admin", adminAuditRouter);
app.use("/v1/admin", adminSystemRouter);
app.use("/v1/admin", adminApiTokenRouter);
app.use("/v1/admin/livekit", adminLiveKitRouter);
app.use("/v1/docs", docsRouter);
app.use("/v1/livekit", liveKitRouter);
