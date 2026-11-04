import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import { getItem, removeItem, setItem } from './storage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

const isPlaceholder = (v: string) => /your[-_ ]?(project|anon)|paste[-_ ]/i.test(v);

/** False until mobile/.env has real values; the root layout shows a setup screen instead of a broken app. */
export const supabaseConfigured = !!url && !!anonKey && !isPlaceholder(url) && !isPlaceholder(anonKey);

/**
 * Keeps the Supabase session in the device keychain (expo-secure-store).
 * SecureStore refuses values over ~2 KB and a session (tokens + user) is bigger, so it is stored in chunks.
 */
const CHUNK = 1800;
export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const count = Number(await getItem(`${key}.n`));
    if (!count) return null;
    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      const part = await getItem(`${key}.${i}`);
      if (part === null) return null; // incomplete (e.g. interrupted write): treat as signed out
      parts.push(part);
    }
    return parts.join('');
  },
  async setItem(key: string, value: string): Promise<void> {
    await secureStorage.removeItem(key);
    const count = Math.ceil(value.length / CHUNK);
    for (let i = 0; i < count; i++) await setItem(`${key}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
    await setItem(`${key}.n`, String(count));
  },
  async removeItem(key: string): Promise<void> {
    const count = Number(await getItem(`${key}.n`)) || 0;
    for (let i = 0; i < count; i++) await removeItem(`${key}.${i}`);
    await removeItem(`${key}.n`);
  },
};

// The anon/publishable key is meant to be public: the database's Row Level Security limits what it can read.
// Never put the service_role / secret key in the mobile app.
export const supabase = createClient(
  supabaseConfigured ? url! : 'http://localhost:54321',
  supabaseConfigured ? anonKey! : 'not-configured',
  { auth: { storage: secureStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } },
);

// React Native has no "tab visible" signal, so tell Supabase when to refresh tokens: only while the app is in the foreground.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void supabase.auth.startAutoRefresh();
    else void supabase.auth.stopAutoRefresh();
  });
}
