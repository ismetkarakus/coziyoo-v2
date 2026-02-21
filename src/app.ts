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
import { buyerAssistantRouter } from "./routes/buyer-assistant.js";

export const app = express();

app.use(requestContext);

app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as { rawBody?: string }).rawBody = buf.toString("utf8");
    },
  })
);

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
app.use("/v1/docs", docsRouter);
app.use("/v1/buyer-assistant", buyerAssistantRouter);
