import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { getItem, KEYS, removeItem, setItem } from './storage';

export const API_PORT = 4000;
const REQUEST_TIMEOUT_MS = 15_000;

const stripSlash = (u) => u.trim().replace(/\/+$/, '');

/**
 * Where is the backend? A phone can't use "localhost" (that's the phone itself), so:
 *   1. EXPO_PUBLIC_API_URL if set (for builds), else
 *   2. the same computer that is serving this app over Expo (hostUri) on port 4000, else
 *   3. the Android emulator's alias for the host machine, else localhost (iOS simulator).
 * The user can also override it in the app (Login screen → Server).
 */
export function defaultServerUrl() {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return stripSlash(fromEnv);
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const host = hostUri.split(':')[0];
    if (host) return `http://${host}:${API_PORT}`;
  }
  return Platform.OS === 'android' ? `http://10.0.2.2:${API_PORT}` : `http://localhost:${API_PORT}`;
}

let baseUrl = defaultServerUrl();
let token = null;
let unauthorizedHandler = null;

export const getServerUrl = () => baseUrl;

/** Normalise and validate a user-typed server address. Returns null if it isn't usable. */
export function normaliseServerUrl(input) {
  let v = input.trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`;
  try {
    const u = new URL(v);
    if (!u.hostname) return null;
    // No port typed on a bare host → assume the Finesse API port.
    const withPort = u.port || /^https:/i.test(v) ? v : `${u.protocol}//${u.hostname}:${API_PORT}`;
    return stripSlash(withPort);
  } catch {
    return null;
  }
}

export async function setServerUrl(url) {
  if (url) {
    baseUrl = stripSlash(url);
    await setItem(KEYS.serverUrl, baseUrl);
  } else {
    baseUrl = defaultServerUrl();
    await removeItem(KEYS.serverUrl);
  }
}

/** Load the saved token + server override. Call once at app start. */
export async function initApi() {
  const saved = await getItem(KEYS.serverUrl);
  if (saved) baseUrl = stripSlash(saved);
  token = await getItem(KEYS.token);
  return token;
}

export async function setToken(t) {
  token = t;
  if (t) await setItem(KEYS.token, t);
  else await removeItem(KEYS.token);
}

export const hasToken = () => !!token;
export const onUnauthorized = (fn) => {
  unauthorizedHandler = fn;
};

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details; // optional: [{ field, message }]
  }
}

async function request(method, path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
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
      `Can't reach the server at ${baseUrl}. Make sure the backend is running and your phone is on the same Wi-Fi as your computer.`,
    );
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // An expired session on a normal call signs the user out; a failed login is just an error message.
    if (res.status === 401 && token && !path.startsWith('/auth/login')) unauthorizedHandler?.();
    const detail = data?.details?.[0]?.message;
    throw new ApiError(
      res.status,
      detail ? `${data?.error}: ${detail}` : (data?.error ?? `Request failed (${res.status})`),
      data?.details,
    );
  }
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body ?? {}),
  patch: (path, body) => request('PATCH', path, body),
  put: (path, body) => request('PUT', path, body),
  del: (path) => request('DELETE', path),
};

/** Ping /api/health, for the "Test connection" button. */
export async function checkHealth(url) {
  const target = stripSlash(url ?? baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${target}/api/health`, { signal: controller.signal });
    const json = await res.json().catch(() => null);
    if (res.ok && json?.ok) return { ok: true, message: `Connected. Database: ${json.db}.` };
    return { ok: false, message: 'The server answered, but its database is not reachable.' };
  } catch {
    return { ok: false, message: `No response from ${target}. Is the backend running, and is the address right?` };
  } finally {
    clearTimeout(timer);
  }
}
