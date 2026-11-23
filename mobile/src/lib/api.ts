import { supabase } from './supabase';

const REQUEST_TIMEOUT_MS = 15_000;

const stripSlash = (u: string) => u.trim().replace(/\/+$/, '');

const configuredBase = process.env.EXPO_PUBLIC_API_URL?.trim();
if (!configuredBase || /your[-_ ]?|api\.example|paste[-_ ]|\[YOUR/i.test(configuredBase)) {
  throw new Error('EXPO_PUBLIC_API_URL is required at build time. Set it to the HTTPS Finesse API URL.');
}

let baseUrl: string;
try {
  const parsed = new URL(configuredBase);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
  baseUrl = stripSlash(configuredBase);
} catch {
  throw new Error('EXPO_PUBLIC_API_URL must be a valid HTTP(S) URL.');
}
let unauthorizedHandler: (() => void) | null = null;

export const getServerUrl = () => baseUrl;

/** The current Supabase access token (supabase-js refreshes it automatically before it expires). */
async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export const onUnauthorized = (fn: (() => void) | null) => {
  unauthorizedHandler = fn;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: { field: string; message: string }[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await accessToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(
      0,
      `Can't reach the configured server at ${baseUrl}. Check your internet connection and try again.`,
    );
  } finally {
    clearTimeout(timer);
  }

  const data = (await res.json().catch(() => null)) as { error?: string; details?: ApiError['details'] } | null;
  if (!res.ok) {
    // A rejected session on a normal call signs the user out; a failed registration is just an error message.
    if (res.status === 401 && token) unauthorizedHandler?.();
    const detail = data?.details?.[0]?.message;
    throw new ApiError(
      res.status,
      detail ? `${data?.error}: ${detail}` : (data?.error ?? `Request failed (${res.status})`),
      data?.details,
    );
  }
  return data as T;
}

const UPLOAD_TIMEOUT_MS = 60_000;

/**
 * Upload a picked file (fee statement). The file is the raw request body, as documented for expo-file-system:
 * `new File(uri)` is a Blob that `expo/fetch` can send directly. Both modules are imported lazily so screens
 * that never upload (and the unit tests) don't load native code.
 */
async function upload<T>(path: string, picked: { uri: string; name: string; mimeType?: string | null }): Promise<T> {
  const token = await accessToken();
  const [{ fetch: expoFetch }, { File }] = await Promise.all([import('expo/fetch'), import('expo-file-system')]);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  let res: Awaited<ReturnType<typeof expoFetch>>;
  try {
    res = await expoFetch(`${baseUrl}/api${path}`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': picked.mimeType || 'application/octet-stream',
        'X-File-Name': encodeURIComponent(picked.name),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: new File(picked.uri),
    });
  } catch {
    throw new ApiError(0, `Can't reach the server at ${baseUrl}. Check your connection and try again.`);
  } finally {
    clearTimeout(timer);
  }
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) {
    if (res.status === 401 && token) unauthorizedHandler?.();
    throw new ApiError(res.status, data?.error ?? `Upload failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  upload,
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

/** Ping /api/health, for the "Test connection" button. */
export async function checkHealth(url?: string): Promise<{ ok: boolean; message: string }> {
  const target = stripSlash(url ?? baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${target}/api/health`, { signal: controller.signal });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; db?: string } | null;
    if (res.ok && json?.ok) return { ok: true, message: `Connected. Database: ${json.db}.` };
    return { ok: false, message: 'The server answered, but its database is not reachable.' };
  } catch {
    return { ok: false, message: `No response from ${target}. Is the backend running, and is the address right?` };
  } finally {
    clearTimeout(timer);
  }
}
