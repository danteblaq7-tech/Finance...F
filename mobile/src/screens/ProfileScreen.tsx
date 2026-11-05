import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Alert, Switch, View } from 'react-native';
import { z } from 'zod';
import { FormTextField } from '@/components/forms';
import { AppText, Badge, Button, Card, ErrorNote, Header, Screen } from '@/components/ui';
import { useAuth } from '@/context/AuthProvider';
import { api } from '@/lib/api';
import { initials } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { FONTS, SPACING } from '@/theme/theme';
import { ServerSettings } from './AuthScreens';

const ROLE_COLORS = { student: '#22C55E', staff: '#2BA8BF', admin: '#7C3AED' } as const;

const pwSchema = z
  .object({
    currentPassword: z.string().min(1, 'Required'),
    newPassword: z.string().min(8, 'At least 8 characters'),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });
type PwValues = z.infer<typeof pwSchema>;

function ChangePassword() {
  const { control, handleSubmit, reset } = useForm<PwValues>({ resolver: zodResolver(pwSchema), defaultValues: { currentPassword: '', newPassword: '', confirm: '' } });
  const change = useMutation({
    mutationFn: (v: PwValues) => api.post('/auth/change-password', { currentPassword: v.currentPassword, newPassword: v.newPassword }),
    onSuccess: () => reset(),
  });
  return (
    <Card>
      <AppText variant="heading" style={{ marginBottom: SPACING.md }}>Change password</AppText>
      <FormTextField control={control} name="currentPassword" label="Current password" secureTextEntry autoCapitalize="none" />
      <FormTextField control={control} name="newPassword" label="New password" secureTextEntry autoCapitalize="none" />
      <FormTextField control={control} name="confirm" label="Confirm new password" secureTextEntry autoCapitalize="none" />
      <ErrorNote error={change.error} />
      <Button title={change.isSuccess ? 'Password changed ✓' : 'Update password'} variant="secondary" loading={change.isPending} onPress={() => void handleSubmit((v) => change.mutate(v))()} />
    </Card>
  );
}

export function ProfileScreen() {
  const { user, logout } = useAuth();
  const { colors, isDark, toggle } = useTheme();
  if (!user) return null;
  const row = (label: string, value: string | null) => (
    <View style={{ marginBottom: SPACING.sm + 4 }}>
      <AppText variant="label">{label}</AppText>
      <AppText variant="bold">{value || '—'}</AppText>
    </View>
  );
  return (
    <Screen>
      <Header title={user.role === 'student' ? 'Profile' : 'Account'} />
      <Card style={{ marginBottom: SPACING.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: SPACING.md }}>
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.accent_teal, alignItems: 'center', justifyContent: 'center' }}>
            <AppText style={{ fontFamily: FONTS.heading, fontSize: 18, color: '#FFFFFF' }}>{initials(user.name)}</AppText>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <AppText variant="heading">{user.name}</AppText>
            <Badge color={ROLE_COLORS[user.role]}>{user.role.toUpperCase()}</Badge>
          </View>
        </View>
        {row('Email', user.email)}
        {user.role === 'student' ? (<>{row('Student ID', user.student_id)}{row('University', user.university)}{row('Course', user.course)}{row('Year of study', user.year_of_study)}</>) : null}
      </Card>

      <Card style={{ marginBottom: SPACING.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <AppText variant="bold">Dark theme</AppText>
          <Switch value={isDark} onValueChange={toggle} accessibilityLabel="Dark theme" trackColor={{ true: colors.accent_teal, false: colors.border }} />
        </View>
      </Card>

      <ChangePassword />
      <ServerSettings />

      <Button title="Sign out" variant="danger" style={{ marginTop: SPACING.lg }}
        onPress={() => Alert.alert('Sign out?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => void logout() }])} />
    </Screen>
  );
}
