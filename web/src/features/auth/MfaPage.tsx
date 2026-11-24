import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useNavigate } from 'react-router-dom';
import { Button, ErrorNote, Field, PageHeader, Spinner } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { homeFor } from '@/lib/utils';

interface MfaStatus {
  enrolled: boolean;
  required: boolean;
  assuranceLevel: 'aal1' | 'aal2';
  factorId: string | null;
}

interface Enrollment {
  factorId: string;
  uri: string;
  secret: string;
}

export function MfaPage() {
  const { user, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let active = true;
    api.get<{ mfa: MfaStatus }>('/auth/mfa/status')
      .then(({ mfa }) => { if (active) setStatus(mfa); })
      .catch((cause: unknown) => { if (active) setError(cause); });
    return () => { active = false; };
  }, []);

  async function beginEnrollment() {
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/mfa/begin-enrollment');
      const { data, error: authError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Finesse authenticator',
      });
      if (authError) throw authError;
      setEnrollment({ factorId: data.id, uri: data.totp.uri, secret: data.totp.secret });
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    const factorId = enrollment?.factorId ?? status?.factorId;
    if (!factorId) return;
    setBusy(true);
    setError(null);
    try {
      const { error: authError } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code: code.replace(/\s/g, ''),
      });
      if (authError) throw authError;
      if (!status?.enrolled) await api.post('/auth/mfa/complete-enrollment');
      const updated = await refreshProfile();
      navigate(homeFor(updated.role), { replace: true });
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  if (!user || (status === null && !error)) return <Spinner label="Checking authenticator status…" />;

  const needsChallenge = Boolean(status?.enrolled && status.assuranceLevel !== 'aal2' && status.factorId);
  const needsEnrollment = Boolean(status && !status.enrolled && !enrollment);
  const needsRecovery = Boolean(status?.enrolled && status.assuranceLevel !== 'aal2' && !status.factorId);
  return (
    <div>
      <PageHeader title="Two-factor authentication" subtitle="Protect your Finesse staff account with an authenticator app." />
      {error ? <ErrorNote error={error} /> : null}

      {enrollment ? (
        <section className="card max-w-2xl space-y-4" aria-labelledby="enroll-mfa-heading">
          <h2 id="enroll-mfa-heading" className="text-base font-bold">Scan this QR code</h2>
          <p className="text-sm text-ink-secondary">Add Finesse to an authenticator app, then enter the current six-digit code to finish setup.</p>
          <div className="inline-block rounded bg-white p-3"><QRCodeSVG value={enrollment.uri} size={220} title="Authenticator setup QR code" /></div>
          <div>
            <Button variant="secondary" onClick={() => setShowSecret((shown) => !shown)}>
              {showSecret ? 'Hide setup key' : 'Show setup key'}
            </Button>
            {showSecret && <code className="ml-3 select-all break-all font-mono text-sm">{enrollment.secret}</code>}
          </div>
          <Field label="Authenticator code" hint="Enter the current six-digit code from your authenticator app.">
            <input className="input max-w-xs" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,8}" maxLength={8} value={code} onChange={(event) => setCode(event.target.value)} />
          </Field>
          <Button loading={busy} disabled={code.replace(/\s/g, '').length < 6} onClick={verifyCode}>Verify and enable</Button>
        </section>
      ) : needsChallenge ? (
        <section className="card max-w-xl space-y-4" aria-labelledby="verify-mfa-heading">
          <h2 id="verify-mfa-heading" className="text-base font-bold">Verify your identity</h2>
          <p className="text-sm text-ink-secondary">Enter the current six-digit code from your authenticator app to continue.</p>
          <Field label="Authenticator code">
            <input className="input max-w-xs" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,8}" maxLength={8} value={code} onChange={(event) => setCode(event.target.value)} />
          </Field>
          <Button loading={busy} disabled={code.replace(/\s/g, '').length < 6} onClick={verifyCode}>Verify and continue</Button>
        </section>
      ) : needsRecovery ? (
        <section className="card max-w-xl">
          <p>No active authenticator factor was found for this account. Ask another admin to reset MFA before continuing.</p>
        </section>
      ) : needsEnrollment ? (
        <section className="card max-w-xl space-y-4">
          <p>{status?.required ? 'Two-factor authentication is required for your account.' : 'Two-factor authentication is optional, but recommended for staff and admins.'}</p>
          <Button loading={busy} onClick={beginEnrollment}>Set up authenticator</Button>
        </section>
      ) : status?.assuranceLevel === 'aal2' ? (
        <section className="card max-w-xl">
          <p>Your authenticator is active and this session is verified.</p>
        </section>
      ) : null}

      <section className="mt-6 max-w-2xl rounded-lg border border-line p-4 text-sm">
        <h2 className="font-bold">If you lose your authenticator</h2>
        <p className="mt-2 text-ink-secondary">
          Ask another admin to reset your authenticator. This removes your MFA factors and signs out your sessions. If MFA is required for staff, set it up again before accessing the app. An admin cannot reset their own factor; if no other admin is available, the project owner must use the out-of-band Supabase recovery process.
        </p>
      </section>
    </div>
  );
}
