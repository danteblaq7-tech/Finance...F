const BASE = import.meta.env.VITE_API_URL ?? '';
const TOKEN_KEY = 'finesse_token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details; // optional: [{ field, message }]
  }
}

export const UNAUTHORIZED_EVENT = 'finesse:unauthorized';

async function request(method, path, body) {
  const token = tokenStore.get();
  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Is the backend running on port 4000?');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // An expired/invalid session on a normal call signs the user out; failed logins are just errors.
    if (res.status === 401 && token && !path.startsWith('/auth/login'))
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
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
