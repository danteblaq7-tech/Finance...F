import { api, ApiError, checkHealth, getServerUrl, onUnauthorized } from '@/lib/api';
import { fake as __fake } from '@/test-utils/fakeSupabase';

const mockFetch = (impl: (url: string, init?: RequestInit) => { status?: number; body?: unknown } | Error) => {
  globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const r = impl(url, init);
    if (r instanceof Error) throw r;
    const { status = 200, body = {} } = r;
    return { ok: status < 400, status, json: async () => body } as Response;
  }) as unknown as typeof fetch;
};

describe('server configuration', () => {
  it('uses the environment-defined API URL', () => {
    expect(getServerUrl()).toBe('http://api.test:4000');
  });
});

describe('request client', () => {
  beforeEach(async () => {
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
    expect((err as ApiError).message).toContain('internet connection');
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
