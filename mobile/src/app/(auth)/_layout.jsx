import { Stack } from 'expo-router';
import { useNavOptions } from '@/theme/navOptions';

export default function AuthLayout() {
  const nav = useNavOptions();
  return (
    <Stack screenOptions={nav.stack}>
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="register" options={{ title: 'Create account' }} />
    </Stack>
  );
}
