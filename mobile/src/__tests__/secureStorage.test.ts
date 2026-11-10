import { Platform } from 'react-native';

// The real Supabase module (jest.setup replaces it for every other test). Its storage adapter sits on the in-memory
// stand-in for expo-secure-store that jest.setup also provides.
const { secureStorage } = jest.requireActual('@/lib/supabase') as typeof import('@/lib/supabase');
const storage = jest.requireActual('@/lib/storage') as typeof import('@/lib/storage');
const store = (jest.requireMock('@/lib/storage') as { __store: Map<string, string> }).__store;

describe('browser storage', () => {
  const originalPlatform = Platform.OS;
  const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const browserStore = new Map<string, string>();

  beforeEach(() => {
    Platform.OS = 'web';
    browserStore.clear();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => browserStore.get(key) ?? null,
        setItem: (key: string, value: string) => void browserStore.set(key, value),
        removeItem: (key: string) => void browserStore.delete(key),
      },
    });
  });

  afterAll(() => {
    Platform.OS = originalPlatform;
    if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it('persists and removes Supabase session values in browser storage', async () => {
    await storage.setItem('session', 'token');
    expect(await storage.getItem('session')).toBe('token');
    await storage.removeItem('session');
    expect(await storage.getItem('session')).toBeNull();
  });
});

describe('session storage adapter (SecureStore has a ~2 KB limit per value)', () => {
  const bigSession = JSON.stringify({ access_token: 'x'.repeat(900), refresh_token: 'y'.repeat(60), user: { meta: 'z'.repeat(4200) } });

  it('stores a session far bigger than 2 KB in several small chunks and reads it back intact', async () => {
    await secureStorage.setItem('sb-test-auth-token', bigSession);
    expect(bigSession.length).toBeGreaterThan(5000);
    for (const v of store.values()) expect(v.length).toBeLessThanOrEqual(1800);
    expect(await secureStorage.getItem('sb-test-auth-token')).toBe(bigSession);
  });

  it('returns null when nothing is stored', async () => {
    expect(await secureStorage.getItem('sb-test-auth-token')).toBeNull();
  });

  it('overwriting with a shorter value leaves no stale chunks behind', async () => {
    await secureStorage.setItem('k', 'a'.repeat(5000));
    await secureStorage.setItem('k', 'short');
    expect(await secureStorage.getItem('k')).toBe('short');
    expect([...store.keys()].filter((k) => k.startsWith('k.')).sort()).toEqual(['k.0', 'k.n']);
  });

  it('removeItem clears every chunk', async () => {
    await secureStorage.setItem('k', 'a'.repeat(5000));
    await secureStorage.removeItem('k');
    expect(await secureStorage.getItem('k')).toBeNull();
    expect([...store.keys()].filter((k) => k.startsWith('k'))).toEqual([]);
  });

  it('treats an interrupted write (a chunk missing) as signed out instead of returning corrupt JSON', async () => {
    await secureStorage.setItem('k', 'a'.repeat(5000));
    store.delete('k.1');
    expect(await secureStorage.getItem('k')).toBeNull();
  });
});
