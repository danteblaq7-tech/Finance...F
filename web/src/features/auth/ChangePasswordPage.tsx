import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Button, ErrorNote, Field } from '@/components/ui';
import { api } from '@/lib/api';
import { homeFor } from '@/lib/utils';
import { useAuth } from './AuthProvider';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your temporary password'),
    newPassword: z.string().min(8, 'Use at least 8 characters').max(100),
    confirm: z.string(),
  })
  .refine((value) => value.newPassword === value.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });

type Values = z.infer<typeof schema>;

export function ChangePasswordPage() {
  const { user, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const { register, handleSubmit, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  });
  const change = useMutation({
    mutationFn: ({ currentPassword, newPassword }: Values) =>
      api.post('/auth/change-password', { currentPassword, newPassword }),
    onSuccess: async () => {
      const updated = await refreshProfile();
      navigate(homeFor(updated.role), { replace: true });
    },
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg-secondary px-4 py-8">
      <form onSubmit={handleSubmit((values) => change.mutate(values))} className="card w-full max-w-lg space-y-4" noValidate>
        <div>
          <h1 className="text-2xl font-black">Change your temporary password</h1>
          <p className="mt-2 text-sm text-ink-secondary">
            {user?.name}, set a new password before using the Finesse account.
          </p>
        </div>
        <Field label="Temporary password" error={errors.currentPassword?.message}>
          <input type="password" autoComplete="current-password" className="input" {...register('currentPassword')} />
        </Field>
        <Field label="New password" error={errors.newPassword?.message}>
          <input type="password" autoComplete="new-password" className="input" {...register('newPassword')} />
        </Field>
        <Field label="Confirm new password" error={errors.confirm?.message}>
          <input type="password" autoComplete="new-password" className="input" {...register('confirm')} />
        </Field>
        <ErrorNote error={change.error} />
        <Button type="submit" loading={change.isPending}>Update password</Button>
      </form>
    </main>
  );
}
