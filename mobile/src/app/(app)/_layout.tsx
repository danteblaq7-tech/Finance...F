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
  const mustChangePassword = Boolean(user.must_change_password);
  const staff = user.role === 'staff' || user.role === 'admin';
  const invigilator = staff || user.role === 'lecturer';
  const mfa = user.mfa;
  const mfaBlocked = staff && Boolean(mfa?.required && (!mfa.enrolled || mfa.assuranceLevel !== 'aal2'));
  const items = mustChangePassword
    ? navFor(user.role).filter((item) => item.href === '/profile')
    : mfaBlocked
      ? navFor(user.role).filter((item) => item.href === '/mfa')
      : navFor(user.role);
  return (
    <Shell items={items}>
      <Stack screenOptions={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: colors.bg_secondary } }}>
        <Stack.Protected guard={!mustChangePassword && !mfaBlocked && user.role === 'student'}>
          <Stack.Screen name="tickets/index" />
          <Stack.Screen name="tickets/new" />
          <Stack.Screen name="tickets/[id]" />
          <Stack.Screen name="exam" />
        </Stack.Protected>
        <Stack.Protected guard={!mustChangePassword && !mfaBlocked && staff}>
          <Stack.Screen name="dashboard" />
          <Stack.Screen name="queue/index" />
          <Stack.Screen name="queue/[id]" />
          <Stack.Screen name="applications" />
          <Stack.Screen name="fees" />
          <Stack.Screen name="periods" />
          <Stack.Screen name="slots" />
        </Stack.Protected>
        <Stack.Protected guard={!mustChangePassword && !mfaBlocked && invigilator}>
          <Stack.Screen name="scan" />
          <Stack.Screen name="units/index" />
          <Stack.Screen name="units/[id]" />
        </Stack.Protected>
        <Stack.Protected guard={!mustChangePassword && staff}>
          <Stack.Screen name="mfa" />
        </Stack.Protected>
        <Stack.Protected guard={mustChangePassword || !mfaBlocked}>
          <Stack.Screen name="profile" />
        </Stack.Protected>
      </Stack>
    </Shell>
  );
}
