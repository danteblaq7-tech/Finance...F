import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Button, ErrorNote, Field } from '@/components/ui';
import { homeFor } from '@/lib/utils';
import { useAuth } from './AuthProvider';

function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="font-display text-3xl font-black tracking-widest text-brand-teal-lt">FINESSE</div>
          <div className="mt-1 text-[10px] uppercase tracking-widest text-ink-muted">Campus Finance Management</div>
        </div>
        <div className="card space-y-4">
          <h1 className="text-lg font-bold">{title}</h1>
          {children}
        </div>
      </div>
    </div>
  );
}

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});
type LoginValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<unknown>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      const user = await login(v.email, v.password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : homeFor(user.role), { replace: true });
    } catch (e) {
      setError(e);
    }
  });

  return (
    <AuthShell title="Sign in">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Email" error={errors.email?.message}>
          <input type="email" autoComplete="username" className="input" {...register('email')} />
        </Field>
        <Field label="Password" error={errors.password?.message}>
          <input type="password" autoComplete="current-password" className="input" {...register('password')} />
        </Field>
        <ErrorNote error={error} />
        <Button type="submit" loading={isSubmitting} className="w-full">Sign in</Button>
      </form>
      <p className="text-center text-ink-secondary">
        New student? <Link to="/register" className="text-brand-teal-lt underline">Create an account</Link>
      </p>
    </AuthShell>
  );
}

const registerSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter your full name'),
    studentId: z.string().trim().min(3, 'Enter your student ID (e.g. EGM/027/2024)'),
    email: z.string().trim().email('Enter a valid email'),
    university: z.string().trim().optional(),
    course: z.string().trim().optional(),
    yearOfStudy: z.string().optional(),
    password: z.string().min(8, 'At least 8 characters'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });
type RegisterValues = z.infer<typeof registerSchema>;

export function RegisterPage() {
  const { register: signUp } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<RegisterValues>({ resolver: zodResolver(registerSchema) });

  const onSubmit = handleSubmit(async ({ confirm: _c, ...v }) => {
    setError(null);
    try {
      await signUp({ ...v, university: v.university || undefined, course: v.course || undefined, yearOfStudy: v.yearOfStudy || undefined });
      navigate('/tickets', { replace: true });
    } catch (e) {
      setError(e);
    }
  });

  return (
    <AuthShell title="Create student account">
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <Field label="Full name" error={errors.name?.message}><input className="input" {...register('name')} /></Field>
        <Field label="Student ID" error={errors.studentId?.message}><input className="input" {...register('studentId')} /></Field>
        <Field label="Email" error={errors.email?.message}><input type="email" className="input" {...register('email')} /></Field>
        <Field label="University" error={errors.university?.message}><input className="input" {...register('university')} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2"><Field label="Course"><input className="input" {...register('course')} /></Field></div>
          <Field label="Year">
            <select className="input" {...register('yearOfStudy')}>
              <option value="">—</option>
              {[1, 2, 3, 4, 5, 6].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Password" error={errors.password?.message}><input type="password" autoComplete="new-password" className="input" {...register('password')} /></Field>
        <Field label="Confirm password" error={errors.confirm?.message}><input type="password" autoComplete="new-password" className="input" {...register('confirm')} /></Field>
        <ErrorNote error={error} />
        <Button type="submit" loading={isSubmitting} className="w-full">Create account</Button>
      </form>
      <p className="text-center text-ink-secondary">
        Already registered? <Link to="/login" className="text-brand-teal-lt underline">Sign in</Link>
      </p>
    </AuthShell>
  );
}
