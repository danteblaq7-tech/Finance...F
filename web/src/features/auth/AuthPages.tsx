import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button, ErrorNote, Field } from '@/components/ui';
import { homeFor } from '@/lib/utils';
import { useAuth } from './AuthProvider';

/**
 * Shared frame for Sign in and Create account.
 * Wide screens: the form floats on the left over a night-sky gradient, with an offset outline frame behind it.
 * Phones: the gradient becomes a banner at the top and the form card sits over it, full width.
 * The gradient and stars are pure CSS (see .auth-art in index.css): no images to load, nothing to break.
 * The form side follows the light/dark theme; the artwork is the same in both.
 */
function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-3 sm:p-6">
      {/* Light / dark switch, as on every other page. It has its own background so it reads over the artwork too. */}
      <div className="fixed right-4 top-4 z-20">
        <ThemeToggle className="border-line bg-bg-secondary text-ink-secondary hover:border-line-active" />
      </div>
      <div className="relative w-full max-w-5xl overflow-hidden rounded-xl shadow-card">
        <div aria-hidden className="auth-art absolute inset-0" />
        <div className="relative grid lg:grid-cols-[1.1fr_0.9fr]">
          {/* Form (first in the page for keyboard and screen-reader users; shown on the left on wide screens) */}
          <div className="relative z-10 order-2 px-3 pb-3 sm:px-6 sm:pb-6 lg:order-1 lg:flex lg:items-center lg:p-10 lg:pr-0">
            <div className="relative w-full">
              <div aria-hidden className="absolute inset-0 hidden translate-x-3 translate-y-3 rounded-xl border border-white/30 lg:block" />
              <div className="relative space-y-5 rounded-xl bg-bg-secondary p-6 shadow-2xl sm:p-10">
                <h1 className="text-3xl font-black tracking-wide">{title}</h1>
                {children}
              </div>
            </div>
          </div>
          {/* Artwork + brand */}
          <div className="relative order-1 flex min-h-[9.5rem] flex-col justify-between p-6 text-white sm:min-h-[11rem] lg:order-2 lg:min-h-[36rem] lg:p-10">
            <div>
              <div className="font-display text-2xl font-black tracking-widest sm:text-3xl">FINESSE</div>
              <div className="mt-1 text-[10px] uppercase tracking-widest text-white/70">Campus Finance Management</div>
            </div>
            <p className="hidden max-w-xs text-sm leading-relaxed text-white/80 lg:block">
              Raise tickets, book appointments, upload your fee statement and print your exam card, all in one place.
            </p>
            <span aria-hidden className="absolute right-6 top-1/2 hidden -translate-y-1/2 font-display text-[10px] uppercase tracking-[0.5em] text-white/50 [writing-mode:vertical-rl] lg:block">
              Fees · Tickets · Exam cards
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Gradient pill for the main button; the shape and font are the normal Button's. */
const AUTH_BUTTON = 'w-full bg-gradient-to-r from-brand-teal via-brand-teal-lt to-brand-cyan py-3 hover:brightness-110';
const AUTH_INPUT = 'input py-3 focus:shadow-teal';

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
          <input type="email" autoComplete="username" className={AUTH_INPUT} {...register('email')} />
        </Field>
        <Field label="Password" error={errors.password?.message}>
          <input type="password" autoComplete="current-password" className={AUTH_INPUT} {...register('password')} />
        </Field>
        <ErrorNote error={error} />
        <Button type="submit" loading={isSubmitting} className={AUTH_BUTTON}>Sign in</Button>
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
        <Button type="submit" loading={isSubmitting} className={AUTH_BUTTON}>Create account</Button>
      </form>
      <p className="text-center text-ink-secondary">
        Already registered? <Link to="/login" className="text-brand-teal-lt underline">Sign in</Link>
      </p>
    </AuthShell>
  );
}
