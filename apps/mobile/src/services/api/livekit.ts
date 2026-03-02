import type { StartSessionRequest, StartSessionResponse } from '../../types/api';
import { apiRequest } from './client';

export async function startLiveKitSession(
  accessToken: string,
  payload: StartSessionRequest,
): Promise<StartSessionResponse> {
  return apiRequest<StartSessionResponse>('/v1/livekit/session/start', {
    method: 'POST',
    accessToken,
    body: payload,
  });
}

export async function getAgentSettings(accessToken: string, deviceId: string): Promise<Record<string, unknown>> {
  return apiRequest<Record<string, unknown>>(`/v1/livekit/starter/agent-settings/${deviceId}`, {
    method: 'GET',
    accessToken,
  });
}

export async function updateAgentSettings(
  accessToken: string,
  deviceId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return apiRequest<Record<string, unknown>>(`/v1/livekit/starter/agent-settings/${deviceId}`, {
    method: 'PUT',
    accessToken,
    body: payload,
  });
}
