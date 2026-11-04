import { supabase } from './supabase';

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: { field: string; message: string }[],
  ) {
    super(message);
  }
}

export const UNAUTHORIZED_EVENT = 'finesse:unauthorized';

/** The current Supabase access token (supabase-js refreshes it automatically when it is about to expire). */
async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await accessToken();
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the Finesse API. Is the backend running on port 4000? (npm run dev)');
  }
  const data = (await res.json().catch(() => null)) as { error?: string; details?: ApiError['details'] } | null;
  if (!res.ok) {
    // A rejected session on a normal call signs the user out; a failed registration is just an error.
    if (res.status === 401 && token) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    const detail = data?.details?.[0]?.message;
    throw new ApiError(res.status, detail ? `${data?.error}: ${detail}` : (data?.error ?? `Request failed (${res.status})`), data?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};
