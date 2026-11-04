import * as SecureStore from 'expo-secure-store';

// Keys may only contain letters, digits, '.', '-' and '_' (SecureStore rule).
export const KEYS = {
  token: 'finesse_token',
  serverUrl: 'finesse_server_url',
  theme: 'finesse_theme',
} as const;

export async function getItem(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    /* storage unavailable: the app still works for this session */
  }
}

export async function removeItem(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    /* nothing to remove */
  }
}
