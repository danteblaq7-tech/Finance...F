import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { api, ApiError, checkHealth, defaultServerUrl, getServerUrl, initApi, normaliseServerUrl, onUnauthorized, setServerUrl } from '@/lib/api';
import { fake as __fake } from '@/test-utils/fakeSupabase';

// expo-constants' config is read-only in the real module, so replace the module with a plain object.
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: null } }));

const mockFetch = (impl: (url: string, init?: RequestInit) => { status?: number; body?: unknown } | Error) => {
  globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const r = impl(url, init);
    if (r instanceof Error) throw r;
    const { status = 200, body = {} } = r;
    return { ok: status < 400, status, json: async () => body } as Response;
  }) as unknown as typeof fetch;
};

describe('server address', () => {
  const original = Constants.expoConfig;
  afterEach(() => {
    (Constants as { expoConfig: unknown }).expoConfig = original;
    delete process.env.EXPO_PUBLIC_API_URL;
  });

  it("uses the dev computer's address from Expo (so a real phone can reach it)", () => {
    (Constants as { expoConfig: unknown }).expoConfig = { hostUri: '192.168.1.5:8081' };
    expect(defaultServerUrl()).toBe('http://192.168.1.5:4000');
  });

  it('prefers EXPO_PUBLIC_API_URL when set, without a trailing slash', () => {
    process.env.EXPO_PUBLIC_API_URL = 'https://api.example.com/';
    expect(defaultServerUrl()).toBe('https://api.example.com');
  });

  it('falls back to the Android emulator alias or localhost', () => {
    (Constants as { expoConfig: unknown }).expoConfig = null;
    Platform.OS = 'android';
    expect(defaultServerUrl()).toBe('http://10.0.2.2:4000');
    Platform.OS = 'ios';
    expect(defaultServerUrl()).toBe('http://localhost:4000');
  });

  it.each([
    ['192.168.1.5', 'http://192.168.1.5:4000'],
    ['192.168.1.5:4000', 'http://192.168.1.5:4000'],
    ['  http://10.0.0.9:5000/ ', 'http://10.0.0.9:5000'],
    ['https://api.finesse.ac.ke', 'https://api.finesse.ac.ke'],
  ])('normalises "%s" to %s', (input, expected) => expect(normaliseServerUrl(input)).toBe(expected));

  it.each([[''], ['   '], ['http://']])('rejects unusable input "%s"', (input) => expect(normaliseServerUrl(input)).toBeNull());

  it('persists a user-chosen address and restores it on next start', async () => {
    await setServerUrl('http://10.1.1.1:4000');
    expect(getServerUrl()).toBe('http://10.1.1.1:4000');
    await setServerUrl(null);
    await setServerUrl('http://10.2.2.2:4000');
    await initApi();
    expect(getServerUrl()).toBe('http://10.2.2.2:4000');
    await setServerUrl(null);
  });
});

describe('request client', () => {
  beforeEach(async () => {
    await setServerUrl('http://api.test:4000');
    __fake.session = null;
    onUnauthorized(null);
  });

  it('sends the Supabase access token as the bearer token, with the JSON body', async () => {
    __fake.session = { access_token: 'jwt-1', user: { id: 'u1' } };
    mockFetch(() => ({ body: { ok: true } }));
    await api.post('/tickets', { a: 1 });
    const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('http://api.test:4000/api/tickets');
    expect(init.headers.Authorization).toBe('Bearer jwt-1');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{"a":1}');
  });

  it('turns server errors into ApiError with the first validation detail', async () => {
    mockFetch(() => ({ status: 400, body: { error: 'Validation failed', details: [{ field: 'description', message: 'too short' }] } }));
    await expect(api.post('/tickets', {})).rejects.toMatchObject({ status: 400, message: 'Validation failed: too short' });
  });

  it('explains network failures in plain language, including the address tried', async () => {
    mockFetch(() => new Error('Network request failed'));
    const err = await api.get('/tickets').catch((e) => e as ApiError);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
    expect((err as ApiError).message).toContain('http://api.test:4000');
    expect((err as ApiError).message).toContain('same Wi-Fi');
  });

  it('uses the latest token on every request (Supabase rotates it in the background)', async () => {
    mockFetch(() => ({ body: {} }));
    __fake.session = { access_token: 'first', user: { id: 'u1' } };
    await api.get('/tickets');
    __fake.session = { access_token: 'refreshed', user: { id: 'u1' } };
    await api.get('/tickets');
    const auth = (globalThis.fetch as jest.Mock).mock.calls.map(([, init]) => init.headers.Authorization);
    expect(auth).toEqual(['Bearer first', 'Bearer refreshed']);
  });

  it('sends no Authorization header when signed out', async () => {
    mockFetch(() => ({ body: {} }));
    await api.post('/auth/register', { a: 1 });
    expect((globalThis.fetch as jest.Mock).mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it('signs the user out on a 401 when signed in, but not when there was no session (e.g. a failed registration)', async () => {
    const onOut = jest.fn();
    onUnauthorized(onOut);
    __fake.session = { access_token: 'stale', user: { id: 'u1' } };
    mockFetch(() => ({ status: 401, body: { error: 'Session expired.' } }));
    await expect(api.get('/tickets')).rejects.toThrow('Session expired.');
    expect(onOut).toHaveBeenCalledTimes(1);
    __fake.session = null;
    await expect(api.post('/auth/register', {})).rejects.toThrow();
    expect(onOut).toHaveBeenCalledTimes(1);
  });

  it('health check reports connected, db-down and unreachable', async () => {
    mockFetch(() => ({ body: { ok: true, db: 'connected' } }));
    expect(await checkHealth()).toEqual({ ok: true, message: 'Connected. Database: connected.' });
    mockFetch(() => ({ status: 503, body: { ok: false, db: 'unreachable' } }));
    expect((await checkHealth()).ok).toBe(false);
    mockFetch(() => new Error('down'));
    expect((await checkHealth()).message).toContain('No response from');
  });
});
