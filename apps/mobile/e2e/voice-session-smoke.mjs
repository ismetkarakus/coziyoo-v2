#!/usr/bin/env node

const apiBaseUrl = process.env.API_BASE_URL || process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.coziyoo.com';
const agentApiBaseUrl = process.env.AGENT_API_BASE_URL || 'http://127.0.0.1:9000';
const email = process.env.E2E_EMAIL || 'admin@coziyoo.com';
const password = process.env.E2E_PASSWORD || 'Admin12345';
const deviceId = process.env.E2E_DEVICE_ID || 'mobile_dev_001';

function fail(message, details) {
  console.error('[e2e][fail]', message);
  if (details !== undefined) {
    console.error(details);
  }
  process.exit(1);
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const bodyText = await response.text();
  let body = null;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    body = bodyText;
  }

  if (!response.ok) {
    fail(`HTTP ${response.status} ${url}`, body);
  }

  return body;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('[e2e] login ->', apiBaseUrl);
  const login = await request(`${apiBaseUrl}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const accessToken = login?.data?.tokens?.accessToken;
  if (!accessToken) {
    fail('Missing access token from login response', login);
  }

  console.log('[e2e] session/start');
  const started = await request(`${apiBaseUrl}/v1/livekit/session/start`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      participantName: email,
      channel: 'mobile',
      autoDispatchAgent: true,
      deviceId,
      locale: 'en-US',
    }),
  });

  const data = started?.data;
  if (!data?.roomName || !data?.wsUrl || !data?.user?.token) {
    fail('Invalid start-session payload', started);
  }

  console.log('[e2e] room:', data.roomName);

  const taskId = data?.agent?.dispatch?.body?.taskId;
  if (!taskId) {
    console.log('[e2e] no taskId in dispatch body; skipping agent dispatch poll');
    console.log('[e2e] success');
    return;
  }

  console.log('[e2e] dispatch task:', taskId);
  let completed = false;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    await sleep(300);
    const status = await request(`${agentApiBaseUrl}/livekit/agent-session/${taskId}`);
    const dispatchStatus = status?.task?.status;
    console.log(`[e2e] dispatch status attempt ${attempt}:`, dispatchStatus);
    if (dispatchStatus === 'completed') {
      completed = true;
      break;
    }
    if (dispatchStatus === 'failed') {
      fail('Dispatch task failed', status);
    }
  }

  if (!completed) {
    fail('Dispatch task did not reach completed state within retry window');
  }

  console.log('[e2e] success');
}

main().catch((error) => fail(error instanceof Error ? error.message : 'Unexpected e2e failure', error));
