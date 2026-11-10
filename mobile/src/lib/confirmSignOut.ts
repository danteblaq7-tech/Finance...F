import { Alert, Platform } from 'react-native';

export function confirmSignOut(logout: () => void | Promise<void>): void {
  if (Platform.OS === 'web') {
    if (globalThis.confirm('Sign out?')) void logout();
    return;
  }

  Alert.alert('Sign out?', undefined, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Sign out', style: 'destructive', onPress: () => void logout() },
  ]);
}
