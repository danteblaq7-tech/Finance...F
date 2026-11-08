import { Lexend_400Regular, Lexend_600SemiBold } from '@expo-google-fonts/lexend';
import { Orbitron_700Bold, Orbitron_900Black } from '@expo-google-fonts/orbitron';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/context/AuthProvider';
import { queryClient } from '@/lib/queryClient';
import { supabaseConfigured } from '@/lib/supabase';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';

/** Shown instead of the app when mobile/.env is missing or still has the template's placeholder values. */
function SetupNeeded() {
  const { colors } = useTheme();
  const text = { color: colors.text_secondary, fontSize: 14, lineHeight: 21, marginTop: 10 } as const;
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 28, backgroundColor: colors.bg_primary }}>
      <Text style={{ color: colors.text_primary, fontSize: 20, fontWeight: '700' }}>Finesse needs its Supabase settings</Text>
      <Text style={text}>1. Copy mobile/.env.example to mobile/.env.</Text>
      <Text style={text}>2. Fill in EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (Supabase dashboard ▸ Project Settings ▸ API, or ask the project owner).</Text>
      <Text style={text}>3. Restart Expo with the cache cleared: npx expo start -c</Text>
    </View>
  );
}

function Gate({ fontsReady }: { fontsReady: boolean }) {
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
        <Stack.Protected guard={user?.role === 'staff' || user?.role === 'admin'}>
          <Stack.Screen name="(staff)" />
        </Stack.Protected>
        <Stack.Protected guard={user?.role === 'lecturer'}>
          <Stack.Screen name="(lecturer)" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [loaded, fontError] = useFonts({ Orbitron_700Bold, Orbitron_900Black, Lexend_400Regular, Lexend_600SemiBold });
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            {/* If a font fails to load we still start the app with system fonts rather than hang. */}
            {supabaseConfigured ? <Gate fontsReady={loaded || !!fontError} /> : <SetupNeeded />}
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
