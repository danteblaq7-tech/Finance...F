// In-memory replacement for SecureStore-backed storage, shared by every test.
const mockStore = new Map<string, string>();

jest.mock('@/lib/storage', () => ({
  KEYS: { token: 'finesse_token', serverUrl: 'finesse_server_url', theme: 'finesse_theme' },
  getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItem: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  removeItem: jest.fn(async (k: string) => void mockStore.delete(k)),
  __store: mockStore,
}));

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

// The camera does not exist in Jest. Tests drive it through `__camera`: set the permission, or call onScanned({ data }) like a QR read.
jest.mock('expo-camera', () => {
  const React = require('react');
  const { View } = require('react-native');
  const __camera: { onScanned: unknown; permission: unknown; ask: unknown } = { onScanned: null, permission: { granted: true, canAskAgain: true }, ask: jest.fn() };
  return {
    __camera,
    CameraView: (props: { onBarcodeScanned?: unknown }) => {
      __camera.onScanned = props.onBarcodeScanned ?? null;
      return React.createElement(View, { testID: 'camera' });
    },
    useCameraPermissions: () => [__camera.permission, __camera.ask],
  };
});

type MockListener = (event: string, session: unknown) => void;

// Fake Supabase client: tests decide whether a saved session exists (signedInAs) and whether a password is accepted.
// The real client talks to the network and a keychain, neither of which exist in Jest.
jest.mock('@/lib/supabase', () => {
  const fake = {
    session: null as null | { access_token: string; user: { id: string } },
    listeners: new Set<MockListener>(),
    emit(event: string) {
      fake.listeners.forEach((l) => l(event, fake.session));
    },
    signIn: jest.fn(),
    signOut: jest.fn(),
  };
  const supabase = {
    auth: {
      getSession: async () => ({ data: { session: fake.session } }),
      onAuthStateChange: (cb: MockListener) => {
        fake.listeners.add(cb);
        Promise.resolve().then(() => cb('INITIAL_SESSION', fake.session)); // Supabase reports a saved session on subscribe
        return { data: { subscription: { unsubscribe: () => fake.listeners.delete(cb) } } };
      },
      signInWithPassword: (args: unknown) => fake.signIn(args),
      signOut: () => fake.signOut(),
    },
    channel: () => {
      const ch = { on: () => ch, subscribe: () => ch };
      return ch;
    },
    removeChannel: jest.fn(),
  };
  return { __esModule: true, supabase, supabaseConfigured: true, __fake: fake };
});

beforeEach(() => {
  const { __fake: fake } = jest.requireMock('@/lib/supabase');
  fake.session = null;
  fake.listeners.clear();
  fake.signOut.mockReset().mockImplementation(async () => {
    fake.session = null;
    fake.emit('SIGNED_OUT');
    return { error: null };
  });
  // Default: the demo password works (the signed-in user's id is whatever /auth/me later reports); anything else is refused.
  fake.signIn.mockReset().mockImplementation(async ({ password }: { password: string }) => {
    if (password !== 'Finesse@2026') {
      return { data: { user: null, session: null }, error: { message: 'Invalid login credentials', status: 400, code: 'invalid_credentials' } };
    }
    fake.session = { access_token: 'jwt-signed-in', user: { id: 'signed-in-user' } };
    fake.emit('SIGNED_IN');
    return { data: { user: { id: 'signed-in-user' }, session: fake.session }, error: null };
  });
  mockStore.clear();
  // The app uses one shared QueryClient; start each test with an empty cache so results never leak between tests.
  require('@/lib/queryClient').queryClient.clear();
});

// Icon fonts are binary assets that Jest can't load; render a placeholder instead.
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

// A cold start (fresh checkout, CI, --no-cache) compiles every screen the first time a test visits it, which can take longer
// than the default 1 s that findBy*/waitFor wait. Give the first run room; warm runs are unaffected because they finish sooner.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('@testing-library/react-native').configure({ asyncUtilTimeout: 6000 });
jest.setTimeout(30000);
