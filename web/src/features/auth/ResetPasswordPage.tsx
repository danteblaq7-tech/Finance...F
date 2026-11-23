import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, ErrorNote, Field } from '@/components/ui';
import { supabase } from '@/lib/supabase';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    async function establishRecoverySession() {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const accessToken = fragment.get('access_token');
      const refreshToken = fragment.get('refresh_token');
      if (fragment.get('type') === 'recovery' && accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (sessionError) throw sessionError;
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      }

      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!data.session) throw new Error('This password-reset link is invalid or has expired. Request a new one.');
      if (active) setReady(true);
    }

    establishRecoverySession().catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause : new Error('Could not validate the password-reset link.'));
    });
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(new Error('Passwords do not match.'));
      return;
    }
    if (password.length < 8) {
      setError(new Error('Use at least 8 characters.'));
      return;
    }
    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (updateError) {
      setError(new Error(updateError.message));
      return;
    }
    navigate('/', { replace: true });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg-secondary px-4 py-8">
      <form onSubmit={submit} className="card w-full max-w-lg space-y-4">
        <div>
          <h1 className="text-2xl font-black">Set a new password</h1>
          <p className="mt-2 text-sm text-ink-secondary">Choose a new password for your Finesse account.</p>
        </div>
        {ready ? (
          <>
            <Field label="New password">
              <input className="input" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} />
            </Field>
            <Field label="Confirm new password">
              <input className="input" type="password" autoComplete="new-password" minLength={8} required value={confirm} onChange={(event) => setConfirm(event.target.value)} />
            </Field>
          </>
        ) : <p role="status">Validating reset link…</p>}
        <ErrorNote error={error} />
        {ready && <Button type="submit" loading={saving}>Update password</Button>}
      </form>
    </main>
  );
}