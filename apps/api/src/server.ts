import { app } from "./app.js";
import { env } from "./config/env.js";
import { startPayoutScheduler } from "./services/payout-scheduler.js";

startPayoutScheduler();

app.listen(env.PORT, env.HOST, () => {
  console.log(`API listening on http://${env.HOST}:${env.PORT}`);
});
