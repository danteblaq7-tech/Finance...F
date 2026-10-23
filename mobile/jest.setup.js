// In-memory replacement for SecureStore-backed storage, shared by every test.
const mockStore = new Map();

jest.mock('@/lib/storage', () => ({
  KEYS: { token: 'finesse_token', serverUrl: 'finesse_server_url', theme: 'finesse_theme' },
  getItem: jest.fn(async (k) => mockStore.get(k) ?? null),
  setItem: jest.fn(async (k, v) => void mockStore.set(k, v)),
  removeItem: jest.fn(async (k) => void mockStore.delete(k)),
  __store: mockStore,
}));

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

beforeEach(() => {
  mockStore.clear();
  // The app uses one shared QueryClient; start each test with an empty cache so results never leak between tests.
  require('@/lib/queryClient').queryClient.clear();
});

// Icon fonts are binary assets that Jest can't load; render a placeholder instead.
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');
