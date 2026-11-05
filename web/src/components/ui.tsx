import { AlertCircle, Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  variant = 'primary',
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  const styles: Record<Variant, string> = {
    primary: 'bg-brand-teal text-white hover:bg-brand-teal-lt shadow-teal',
    secondary: 'border border-line bg-bg-tertiary text-ink-primary hover:border-line-active',
    danger: 'bg-brand-red text-white hover:opacity-90',
    ghost: 'text-ink-secondary hover:bg-bg-tertiary',
  };
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-xs font-bold uppercase tracking-wider transition disabled:cursor-not-allowed disabled:opacity-50',
        styles[variant],
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Field({ label, error, children, hint }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-ink-muted">{hint}</span>}
      {error && (
        <span role="alert" className="mt-1 block text-xs text-brand-red">
          {error}
        </span>
      )}
    </label>
  );
}

export function Badge({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      className="inline-block rounded-sm border px-2 py-0.5 text-[10px] font-bold tracking-widest"
      style={{ color, borderColor: color, backgroundColor: `${color}1A` }}
    >
      {children}
    </span>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-wide">{title}</h1>
        {subtitle && <p className="mt-1 text-ink-secondary">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 py-8 text-ink-secondary">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {label}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-brand-red/40 bg-brand-red/10 p-3 text-brand-red">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> <span>{msg}</span>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line p-8 text-center text-ink-muted">{children}</div>;
}

/** Small modal that collects a required note (reason for an override, etc). */
export function NoteDialog({
  title, description, confirmLabel, onConfirm, onCancel, busy,
}: {
  title: string; description: string; confirmLabel: string; busy?: boolean;
  onConfirm: (note: string) => void; onCancel: () => void;
}) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <form
        className="card w-full max-w-md space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const note = String(new FormData(e.currentTarget).get('note') ?? '').trim();
          if (note.length >= 5) onConfirm(note);
        }}
      >
        <h2 className="text-base font-bold">{title}</h2>
        <p className="text-ink-secondary">{description}</p>
        <textarea name="note" required minLength={5} rows={3} className="input" placeholder="Reason (min 5 characters)" autoFocus />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button type="submit" loading={busy}>{confirmLabel}</Button>
        </div>
      </form>
    </div>
  );
}
