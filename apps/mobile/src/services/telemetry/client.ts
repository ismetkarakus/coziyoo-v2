import { sendTelemetryEvent, type TelemetryEvent } from '../api/telemetry';

export async function trackEvent(accessToken: string | undefined, payload: TelemetryEvent): Promise<void> {
  if (!accessToken) return;

  try {
    await sendTelemetryEvent(accessToken, payload);
  } catch {
    // Telemetry must never block UI or voice flow.
  }
}
