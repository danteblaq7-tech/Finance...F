import { Stack } from 'expo-router';
import { Shell } from '@/components/Shell';
import { useAuth } from '@/context/AuthProvider';
import { navFor } from '@/lib/nav';
import { useTheme } from '@/theme/ThemeProvider';

// One frame for every signed-in role, like the web's <Layout>. Each screen is guarded by role (the web's RequireAuth):
// a group a person may not see is "protected", so the router refuses it even if they navigate there directly.
export default function AppLayout() {
  const { user } = useAuth();
  const { colors } = useTheme();
  if (!user) return null;
  const staff = user.role === 'staff' || user.role === 'admin';
  const invigilator = staff || user.role === 'lecturer';
  return (
    <Shell items={navFor(user.role)}>
      <Stack screenOptions={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: colors.bg_secondary } }}>
        <Stack.Protected guard={user.role === 'student'}>
          <Stack.Screen name="tickets/index" />
          <Stack.Screen name="tickets/new" />
          <Stack.Screen name="tickets/[id]" />
          <Stack.Screen name="exam" />
        </Stack.Protected>
        <Stack.Protected guard={staff}>
          <Stack.Screen name="dashboard" />
          <Stack.Screen name="queue/index" />
          <Stack.Screen name="queue/[id]" />
          <Stack.Screen name="applications" />
          <Stack.Screen name="fees" />
          <Stack.Screen name="periods" />
          <Stack.Screen name="slots" />
        </Stack.Protected>
        <Stack.Protected guard={invigilator}>
          <Stack.Screen name="scan" />
          <Stack.Screen name="units/index" />
          <Stack.Screen name="units/[id]" />
        </Stack.Protected>
        <Stack.Screen name="profile" />
      </Stack>
    </Shell>
  );
}
