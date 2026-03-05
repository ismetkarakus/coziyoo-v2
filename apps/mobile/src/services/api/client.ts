import { ApiError } from '../../shared/network/apiError';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://api.coziyoo.com';

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  accessToken?: string;
  body?: unknown;
};

function isRetriable(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (options.accessToken) {
    headers.Authorization = `Bearer ${options.accessToken}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const bodyText = await response.text();
  let parsedBody: unknown = null;

  try {
    parsedBody = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    parsedBody = bodyText;
  }

  if (!response.ok) {
    const bodyObj = (parsedBody ?? {}) as { error?: { code?: string; message?: string; details?: unknown } };
    throw new ApiError({
      status: response.status,
      code: bodyObj.error?.code ?? 'REQUEST_FAILED',
      message: bodyObj.error?.message ?? `Request failed with ${response.status}`,
      details: bodyObj.error?.details,
      retriable: isRetriable(response.status),
      rawBody: parsedBody,
    });
  }

  if (parsedBody && typeof parsedBody === 'object' && 'data' in parsedBody) {
    return (parsedBody as { data: T }).data;
  }

  return parsedBody as T;
}
