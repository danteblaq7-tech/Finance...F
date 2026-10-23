import * as SecureStore from 'expo-secure-store';

// Keys may only contain letters, digits, '.', '-' and '_' (SecureStore rule).
export const KEYS = {
  token: 'finesse_token',
  serverUrl: 'finesse_server_url',
  theme: 'finesse_theme',
};

export async function getItem(key) {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function setItem(key, value) {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    /* storage unavailable: the app still works for this session */
  }
}

export async function removeItem(key) {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    /* nothing to remove */
  }
}
