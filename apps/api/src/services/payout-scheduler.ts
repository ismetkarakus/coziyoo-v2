import { env } from "../config/env.js";
import { generateDailyPayoutBatches } from "./payouts.js";

let payoutTimer: NodeJS.Timeout | null = null;

export async function triggerDailyPayoutRun(): Promise<void> {
  try {
    await generateDailyPayoutBatches();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("Daily payout generation failed:", message);
  }
}

export function startPayoutScheduler(): void {
  if (!env.PAYOUT_SCHEDULER_ENABLED) return;
  if (payoutTimer) return;

  void triggerDailyPayoutRun();

  payoutTimer = setInterval(() => {
    void triggerDailyPayoutRun();
  }, env.PAYOUT_SCHEDULER_INTERVAL_MS);

  payoutTimer.unref();
}

export function stopPayoutScheduler(): void {
  if (!payoutTimer) return;
  clearInterval(payoutTimer);
  payoutTimer = null;
}
