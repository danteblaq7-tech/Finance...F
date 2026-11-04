// The real Supabase module (jest.setup replaces it for every other test). Its storage adapter sits on the in-memory
// stand-in for expo-secure-store that jest.setup also provides.
const { secureStorage } = jest.requireActual('@/lib/supabase') as typeof import('@/lib/supabase');
const store = (jest.requireMock('@/lib/storage') as { __store: Map<string, string> }).__store;

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
