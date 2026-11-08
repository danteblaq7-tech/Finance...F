import { CheckSquare, Square, XSquare } from 'lucide-react';
import type { MyUnit } from '@/lib/types';
import { clock, cn, formatDate, formatDateTime } from '@/lib/utils';

/**
 * The student's units as a checklist. A unit ticks itself the moment a lecturer scans the card for it
 * (the page refreshes live; see lib/realtime.ts). Units the student is not allowed to sit show why.
 */
export function UnitChecklist({ units }: { units: MyUnit[] }) {
  if (units.length === 0) {
    return (
      <section aria-label="Your units">
        <div className="label mb-1">Your units</div>
        <p className="text-xs text-ink-muted">No units are registered for you in this exam period yet. If that looks wrong, ask your department or the finance office.</p>
      </section>
    );
  }
  const sat = units.filter((u) => u.signed_at).length;
  const eligible = units.filter((u) => u.allowed || u.signed_at).length;
  return (
    <section aria-label="Your units">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="label !mb-0">Your units</span>
        <span className="text-xs font-bold text-ink-secondary" aria-live="polite">{sat} of {eligible} sat</span>
      </div>
      <ul className="divide-y divide-line rounded-md border border-line">
        {units.map((u) => {
          const state = u.signed_at ? 'sat' : u.allowed ? 'todo' : 'barred';
          const Icon = state === 'sat' ? CheckSquare : state === 'barred' ? XSquare : Square;
          const when = [formatDate(u.exam_date), clock(u.start_time), u.venue].filter((x) => x && x !== '—').join(' · ');
          return (
            <li key={u.id} data-state={state} className="flex items-start gap-3 px-3 py-2 text-xs">
              <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', state === 'sat' && 'text-brand-green', state === 'barred' && 'text-brand-red', state === 'todo' && 'text-ink-muted')} aria-hidden />
              <div className="min-w-0 flex-1">
                <div><b>{u.unit_code}</b> {u.unit_name}</div>
                {when && <div className="text-ink-muted">{when}</div>}
              </div>
              <div className={cn('shrink-0 text-right font-bold', state === 'sat' && 'text-brand-green', state === 'barred' && 'text-brand-red', state === 'todo' && 'text-ink-muted')}>
                {state === 'sat' ? <>Sat<div className="font-normal text-ink-muted">{formatDateTime(u.signed_at!)}</div></>
                  : state === 'barred' ? <>Not allowed{u.block_reason && <div className="font-normal">{u.block_reason}</div>}</>
                    : 'Not yet'}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
