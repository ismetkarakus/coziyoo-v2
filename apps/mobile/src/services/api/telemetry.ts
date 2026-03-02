import { apiRequest } from './client';

export type TelemetryEvent = {
  level: 'info' | 'warn' | 'error';
  eventType: string;
  message: string;
  roomName?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
};

export async function sendTelemetryEvent(accessToken: string, payload: TelemetryEvent): Promise<void> {
  await apiRequest('/v1/livekit/mobile/telemetry', {
    method: 'POST',
    accessToken,
    body: payload,
  });
}
