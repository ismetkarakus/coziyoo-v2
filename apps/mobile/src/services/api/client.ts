const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://api.coziyoo.com';

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  accessToken?: string;
  body?: unknown;
};

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

  const json = await response.json();
  if (!response.ok) {
    const message = json?.error?.message ?? `Request failed with ${response.status}`;
    throw new Error(message);
  }

  return (json?.data ?? json) as T;
}
