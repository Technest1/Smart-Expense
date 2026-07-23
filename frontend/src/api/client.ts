import { storage } from '@/src/utils/storage';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
export const API_BASE = `${BACKEND_URL}/api`;

const TOKEN_KEY = 'expensesync_session_token';

export async function saveToken(token: string) {
  await storage.secureSet(TOKEN_KEY, token);
}
export async function getToken(): Promise<string | null> {
  const v = await storage.secureGet<string | null>(TOKEN_KEY, null);
  return typeof v === 'string' ? v : null;
}
export async function clearToken() {
  await storage.secureRemove(TOKEN_KEY);
}

export async function apiFetch<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  if (res.status === 401) {
    await clearToken();
    throw new Error('unauthenticated');
  }
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `HTTP ${res.status}`);
  }
  return res.json();
}
