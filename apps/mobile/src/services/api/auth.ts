import type { LoginResponse } from '../../types/api';
import { apiRequest } from './client';

export async function login(email: string, password: string): Promise<LoginResponse> {
  return apiRequest<LoginResponse>('/v1/auth/login', {
    method: 'POST',
    body: { email, password },
  });
}
