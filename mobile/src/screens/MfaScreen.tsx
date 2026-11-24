import { useEffect, useState } from 'react';
import { TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { AppText, Button, Card, ErrorNote, Screen } from '@/components/ui';
import { useAuth } from '@/context/AuthProvider';
import { api } from '@/lib/api';
import { homeFor } from '@/lib/nav';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/theme/ThemeProvider';
import { SPACING } from '@/theme/theme';

interface MfaStatus {
  enrolled: boolean;
  required: boolean;
  assuranceLevel: 'aal1' | 'aal2';
  factorId: string | null;
}

export function MfaScreen() {
  const { colors } = useTheme();
  const { refreshProfile } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api.get<{ mfa: MfaStatus }>('/auth/mfa/status')
      .then(({ mfa }) => { if (active) setStatus(mfa); })
      .catch((cause: unknown) => { if (active) setError(cause); });
    return () => { active = false; };
  }, []);

  async function verifyCode() {
    if (!status?.factorId) return;
    setBusy(true);
    setError(null);
    try {
      const { error: authError } = await supabase.auth.mfa.challengeAndVerify({
        factorId: status.factorId,
        code: code.replace(/\s/g, ''),
      });
      if (authError) throw authError;
      const updated = await refreshProfile();
      router.replace(homeFor(updated.role) as never);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Card style={{ gap: SPACING.md }}>
        <AppText variant="heading">Two-factor authentication</AppText>
        {error ? <ErrorNote error={error} /> : null}
        {!status && !error ? <AppText variant="muted">Checking authenticator status…</AppText> : null}
        {status?.enrolled && status.assuranceLevel !== 'aal2' && status.factorId ? (
          <>
            <AppText variant="body">Enter the current six-digit code from your authenticator app to continue.</AppText>
            <TextInput
              accessibilityLabel="Authenticator code"
              autoComplete="one-time-code"
              keyboardType="number-pad"
              maxLength={8}
              onChangeText={setCode}
              style={{ borderColor: colors.border, borderWidth: 1, borderRadius: 8, color: colors.text_primary, padding: SPACING.md }}
              value={code}
            />
            <Button title="Verify and continue" loading={busy} disabled={code.replace(/\s/g, '').length < 6} onPress={() => void verifyCode()} />
          </>
        ) : null}
        {status?.enrolled && status.assuranceLevel !== 'aal2' && !status.factorId ? (
          <AppText variant="body">No active authenticator factor was found. Ask another admin to reset MFA before continuing.</AppText>
        ) : null}
        {status && !status.enrolled ? (
          <AppText variant="body">
            {status.required
              ? 'Two-factor authentication is required. Set up your authenticator in the Finesse web app, then return here to sign in.'
              : 'Authenticator enrollment is available in the Finesse web app. Open the web app in your browser to set it up for this account.'}
          </AppText>
        ) : null}
        {status?.enrolled && status.assuranceLevel === 'aal2' ? (
          <AppText variant="body">Your authenticator is active and this session is verified.</AppText>
        ) : null}
        <AppText variant="muted">
          If you lose your device, ask another admin to reset your authenticator. The reset removes MFA factors and signs out your sessions. If no other admin is available, the project owner must use the out-of-band Supabase recovery process.
        </AppText>
      </Card>
    </Screen>
  );
}
