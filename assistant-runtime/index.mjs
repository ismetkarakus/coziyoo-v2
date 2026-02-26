import express from 'express';
import { RoomServiceClient, DataPacket_Kind } from 'livekit-server-sdk';
import { z } from 'zod';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';

const app = express();
app.use(express.json({ limit: '2mb' }));

const JoinSchema = z.object({
  roomName: z.string().min(1),
  participantIdentity: z.string().min(1),
  participantName: z.string().min(1).optional(),
  token: z.string().min(8),
  wsUrl: z.string().min(1),
  metadata: z.string().optional(),
  voiceMode: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

function livekitHttpUrl(raw) {
  if (!raw) return '';
  if (raw.startsWith('wss://')) return `https://${raw.slice('wss://'.length).replace(/\/+$/, '')}`;
  if (raw.startsWith('ws://')) return `http://${raw.slice('ws://'.length).replace(/\/+$/, '')}`;
  return raw.replace(/\/+$/, '');
}

function roomClient() {
  const livekitUrl = process.env.LIVEKIT_URL || '';
  const apiKey = process.env.LIVEKIT_API_KEY || '';
  const apiSecret = process.env.LIVEKIT_API_SECRET || '';
  if (!livekitUrl || !apiKey || !apiSecret) {
    throw new Error('LIVEKIT_ENV_MISSING');
  }
  return new RoomServiceClient(livekitHttpUrl(livekitUrl), apiKey, apiSecret);
}

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, service: 'assistant-runtime' });
});

app.get('/', (_req, res) => {
  res.status(200).json({ ok: true, service: 'assistant-runtime' });
});

app.post('/livekit/agent-session', async (req, res) => {
  const parsed = JoinSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
  }

  const input = parsed.data;
  const logCtx = {
    roomName: input.roomName,
    participantIdentity: input.participantIdentity,
    voiceMode: input.voiceMode || null,
    deviceId: String(input.payload?.deviceId || ''),
  };

  console.log('[assistant-runtime] join request', JSON.stringify(logCtx));

  try {
    const client = roomClient();
    const msg = {
      type: 'assistant_runtime_status',
      status: 'join_request_received',
      runtime: 'assistant-runtime',
      roomName: input.roomName,
      participantIdentity: input.participantIdentity,
      voiceMode: input.voiceMode || 'assistant_native_audio',
      ts: new Date().toISOString(),
    };

    const bytes = new TextEncoder().encode(JSON.stringify(msg));
    await client.sendData(input.roomName, bytes, DataPacket_Kind.RELIABLE, {
      topic: 'chat',
      destinationIdentities: [],
    });

    return res.status(202).json({ ok: true, accepted: true, mode: 'control-plane-only' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[assistant-runtime] join failed', message);
    return res.status(500).json({ error: 'ASSISTANT_RUNTIME_FAILED', message });
  }
});

app.listen(port, host, () => {
  console.log(`[assistant-runtime] listening on http://${host}:${port}`);
});
