import { Stack } from 'expo-router';
import { useNavOptions } from '@/theme/navOptions';

export default function QueueLayout() {
  const nav = useNavOptions();
  return (
    <Stack screenOptions={nav.stack}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[id]" options={{ title: 'Ticket' }} />
    </Stack>
  );
}
