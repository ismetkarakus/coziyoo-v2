import { app } from "./app.js";
import { env } from "./config/env.js";
import { startPayoutScheduler } from "./services/payout-scheduler.js";

startPayoutScheduler();

app.listen(env.PORT, env.HOST, () => {
  console.log(`API listening on http://${env.HOST}:${env.PORT}`);
  console.log("n8n config: host=%s webhookUrl=%s webhookPath=%s workflowId=%s",
    env.N8N_HOST ?? "(not set)",
    env.N8N_LLM_WEBHOOK_URL ?? "(not set)",
    env.N8N_LLM_WEBHOOK_PATH || "(default)",
    env.N8N_LLM_WORKFLOW_ID,
  );
});
