import type { N8nTurnRequest, N8nTurnResponse } from '../../domains/agent/types';
import { apiRequest } from '../../services/api/client';

export async function sendN8nTurn(accessToken: string, payload: N8nTurnRequest): Promise<N8nTurnResponse> {
  return apiRequest<N8nTurnResponse>('/v1/livekit/mobile/n8n/turn', {
    method: 'POST',
    accessToken,
    body: payload,
  });
}
