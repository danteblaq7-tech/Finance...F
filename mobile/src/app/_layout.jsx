import { Orbitron_700Bold, Orbitron_900Black } from '@expo-google-fonts/orbitron';
import { SpaceMono_400Regular, SpaceMono_700Bold } from '@expo-google-fonts/space-mono';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/context/AuthProvider';
import { queryClient } from '@/lib/queryClient';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';

function Gate({ fontsReady }) {
  const { user, loading } = useAuth();
  const { colors, isDark } = useTheme();

  if (!fontsReady || loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg_primary }}>
        <ActivityIndicator color={colors.accent_teal_lt} size="large" />
      </View>
    );
  }

  // Role-based route groups. A group the signed-in user shouldn't see is "protected":
  // the router refuses to show it and redirects, and flips automatically on sign-in/out.
  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!user}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={user?.role === 'student'}>
          <Stack.Screen name="(student)" />
        </Stack.Protected>
        <Stack.Protected guard={!!user && user.role !== 'student'}>
          <Stack.Screen name="(staff)" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [loaded, fontError] = useFonts({
    Orbitron_700Bold,
    Orbitron_900Black,
    SpaceMono_400Regular,
    SpaceMono_700Bold,
  });
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            {/* If a font fails to load we still start the app with system fonts rather than hang. */}
            <Gate fontsReady={loaded || !!fontError} />
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
