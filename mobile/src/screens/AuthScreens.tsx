import { zodResolver } from '@hookform/resolvers/zod';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useContext, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Pressable, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { z } from 'zod';
import { FormSelectField, FormTextField } from '@/components/forms';
import { AppText, Button, Card, ErrorNote, Screen } from '@/components/ui';
import { useAuth } from '@/context/AuthProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { FONTS, RADIUS, SPACING } from '@/theme/theme';

// Positions (in %) and sizes of the faint stars in the banner. Fixed, so the screen never changes between renders.
const STARS = [
  { x: 8, y: 14, s: 2 }, { x: 22, y: 62, s: 1.5 }, { x: 37, y: 24, s: 2.5 }, { x: 52, y: 70, s: 1.5 }, { x: 64, y: 12, s: 2 },
  { x: 78, y: 40, s: 1.5 }, { x: 90, y: 20, s: 2 }, { x: 14, y: 82, s: 2 }, { x: 46, y: 46, s: 1.5 }, { x: 86, y: 76, s: 2 },
] as const;

/** A soft glow: stacked circles that each add a little colour, so it fades out towards the edge (React Native has no blur). */
function Glow({ right, bottom, radius, color, steps = 18 }: { right: number; bottom: number; radius: number; color: string; steps?: number }) {
  return (
    <>
      {Array.from({ length: steps }, (_, i) => {
        const r = radius * (1 - i / steps);
        return <View key={i} pointerEvents="none" style={{ position: 'absolute', right: right - r, bottom: bottom - r, width: r * 2, height: r * 2, borderRadius: r, backgroundColor: color, opacity: 0.04 }} />;
      })}
    </>
  );
}

/**
 * Night-sky banner with a cyan glow, made only of plain Views (no image, no gradient library), so it can't fail to load.
 * It is dark in both themes; the status bar icons are forced light while this screen is showing.
 */
function Hero() {
  const insets = useContext(SafeAreaInsetsContext);
  const { isDark, toggle } = useTheme();
  const top = insets?.top ?? 0;
  return (
    <View style={{ backgroundColor: '#07172B', overflow: 'hidden', borderBottomLeftRadius: RADIUS.xl, borderBottomRightRadius: RADIUS.xl, paddingTop: top + SPACING.lg, paddingBottom: SPACING.xl + SPACING.lg, paddingHorizontal: SPACING.lg }}>
      <Glow right={-30} bottom={-10} radius={230} color="#0E7490" />
      <Glow right={30} bottom={10} radius={150} color="#22D3EE" />
      {STARS.map((st) => (
        <View key={`${st.x}-${st.y}`} pointerEvents="none" style={{ position: 'absolute', left: `${st.x}%`, top: `${st.y}%`, width: st.s, height: st.s, borderRadius: st.s, backgroundColor: '#FFFFFF', opacity: 0.6 }} />
      ))}
      <Pressable accessibilityRole="button" accessibilityLabel="Switch theme" hitSlop={10} onPress={toggle} style={{ position: 'absolute', right: SPACING.md, top: top + SPACING.sm }}>
        <Ionicons name={isDark ? 'sunny-outline' : 'moon-outline'} size={22} color="#FFFFFF" />
      </Pressable>
      <AppText style={{ fontFamily: FONTS.display, fontSize: 30, letterSpacing: 4, color: '#FFFFFF' }}>FINESSE</AppText>
      <AppText variant="label" style={{ marginTop: 4, color: 'rgba(255,255,255,0.7)' }}>Campus Finance Management</AppText>
    </View>
  );
}

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});
type LoginValues = z.infer<typeof loginSchema>;

export function LoginScreen() {
  const { colors } = useTheme();
  const { login } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const { control, handleSubmit } = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });

  const submit = handleSubmit(async (v) => {
    setError(null);
    setBusy(true);
    try {
      await login(v.email.trim().toLowerCase(), v.password);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  });

  return (
    <Screen padded={false} edges={[]}>
      <StatusBar style="light" />
      <Hero />
      <Card style={{ marginHorizontal: SPACING.md, marginTop: -SPACING.xl, borderRadius: RADIUS.xl, padding: SPACING.lg, elevation: 6, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } }}>
        <AppText variant="heading" style={{ marginBottom: SPACING.md, fontSize: 24 }}>Sign in</AppText>
        <FormTextField control={control} name="email" label="Email" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="username" />
        <FormTextField control={control} name="password" label="Password" secureTextEntry autoCapitalize="none" autoComplete="current-password" textContentType="password" onSubmitEditing={() => void submit()} />
        <ErrorNote error={error} />
        <Button title="Sign in" loading={busy} onPress={() => void submit()} testID="login-submit" style={{ backgroundColor: colors.accent_teal_lt, shadowColor: colors.accent_teal_lt, shadowOpacity: 0.45, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 }} />
      </Card>
      <View style={{ paddingHorizontal: SPACING.md }}>
        <AppText variant="muted" style={{ textAlign: 'center', marginTop: SPACING.md }} onPress={() => router.push('/register')}>
          New student? <AppText variant="muted" style={{ color: colors.accent_teal_lt, textDecorationLine: 'underline' }}>Create an account</AppText>
        </AppText>
      </View>
    </Screen>
  );
}

const normalizeStudentNumber = (value: string) => value.trim().toUpperCase().replace(/[\s/-]+/g, '/').replace(/^\/+|\/+$/g, '');

const registerSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter your full name').max(150),
    studentId: z.string().trim().min(3).max(40).transform(normalizeStudentNumber)
      .refine((value) => /^[A-Z]{2,6}\/\d{3,4}\/\d{2}$/.test(value), 'Use COURSE/072/23 (3–4 digits in the middle).'),
    email: z.string().trim().email('Enter a valid email').max(190),
    university: z.string().trim().max(150).optional(),
    course: z.string().trim().max(150).optional(),
    yearOfStudy: z.enum(['1', '2', '3', '4', '5', '6']).or(z.literal('')).optional(),
    password: z.string().min(8, 'At least 8 characters').max(100),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });
type RegisterValues = z.infer<typeof registerSchema>;

export function RegisterScreen() {
  const { register } = useAuth();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const { control, handleSubmit } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', studentId: '', email: '', university: '', course: '', yearOfStudy: '', password: '', confirm: '' },
  });

  const submit = handleSubmit(async ({ confirm: _c, ...v }) => {
    setError(null);
    setBusy(true);
    try {
      await register({
        ...v,
        email: v.email.trim().toLowerCase(),
        university: v.university?.trim() || undefined,
        course: v.course?.trim() || undefined,
        yearOfStudy: v.yearOfStudy?.trim() || undefined,
      });
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  });

  return (
    <Screen edges={[]}>
      <Card>
        <AppText variant="heading" style={{ marginBottom: SPACING.md }}>Create student account</AppText>
        <FormTextField control={control} name="name" label="Full name" autoComplete="name" />
        <FormTextField control={control} name="studentId" label="Student number" hint="Format: COURSE/072/23. Spaces and dashes are converted to slashes." placeholder="COM/072/23" autoCapitalize="characters" autoCorrect={false} />
        <FormTextField control={control} name="email" label="Email" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" />
        <FormTextField control={control} name="university" label="University (optional)" />
        <FormTextField control={control} name="course" label="Course (optional)" />
        <FormSelectField control={control} name="yearOfStudy" label="Year of study (optional)" options={[
          { label: '—', value: '' }, ...[1, 2, 3, 4, 5, 6].map((year) => ({ label: String(year), value: String(year) })),
        ]} />
        <FormTextField control={control} name="password" label="Password" secureTextEntry autoCapitalize="none" autoComplete="new-password" />
        <FormTextField control={control} name="confirm" label="Confirm password" secureTextEntry autoCapitalize="none" autoComplete="new-password" />
        <ErrorNote error={error} />
        <Button title="Create account" loading={busy} onPress={() => void submit()} />
      </Card>
    </Screen>
  );
}
