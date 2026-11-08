import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, ShieldAlert, XCircle } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Spinner } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { api } from '@/lib/api';
import type { VerifyResult } from '@/lib/types';
import { formatDate } from '@/lib/utils';

const LOOK = {
  valid: { Icon: CheckCircle2, color: 'text-brand-green', border: 'border-brand-green', title: 'Genuine exam card', text: 'This card was issued by the finance office and is in good standing.' },
  provisional: { Icon: ShieldAlert, color: 'text-brand-amber', border: 'border-brand-amber', title: 'Provisional exam card', text: 'Issued from the student\'s own fee statement, not yet verified by the finance office. Admit, and refer to the finance office if in doubt.' },
  revoked: { Icon: XCircle, color: 'text-brand-red', border: 'border-brand-red', title: 'Card REVOKED', text: 'The finance office has withdrawn this card. Do not admit. Refer the student to the finance office.' },
  expired: { Icon: Clock, color: 'text-brand-amber', border: 'border-brand-amber', title: 'Card expired', text: 'The exam period for this card has ended.' },
  not_found: { Icon: XCircle, color: 'text-brand-red', border: 'border-brand-red', title: 'Card not recognised', text: 'No exam card matches this code. It may be forged or mistyped.' },
} as const;

/** Public page opened by scanning the QR code on a printed exam card. */
export function VerifyPage() {
  const { code = '' } = useParams();
  const { user } = useAuth();
  // A lecturer or staff member who scanned with their phone's own camera can jump straight to signing a unit.
  const canSign = user?.role === 'lecturer' || user?.role === 'staff' || user?.role === 'admin';
  const q = useQuery({ queryKey: ['verify', code], queryFn: () => api.publicGet<VerifyResult>(`/verify/${encodeURIComponent(code)}`), retry: false });
  const look = q.data ? LOOK[q.data.state] : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-4">
      <div className="text-center"><div className="font-display text-xl font-black tracking-widest text-brand-teal-lt">FINESSE</div><div className="text-[10px] uppercase tracking-widest text-ink-muted">Exam card verification</div></div>
      {q.isLoading && <Spinner label="Checking card…" />}
      {q.error && <div role="alert" className="card border-brand-red text-brand-red">{q.error.message}</div>}
      {look && q.data && (
        <section className={`card space-y-3 border-2 ${look.border}`} aria-live="polite">
          <div className={`flex items-center gap-3 ${look.color}`}><look.Icon className="h-10 w-10 shrink-0" aria-hidden /><h1 className="font-display text-lg font-black">{look.title}</h1></div>
          <p className="text-ink-secondary">{look.text}</p>
          {q.data.studentName && (
            <dl className="grid grid-cols-2 gap-3 border-t border-line pt-3">
              <div className="col-span-2"><dt className="label">Student</dt><dd className="text-base font-bold">{q.data.studentName}</dd></div>
              <div><dt className="label">Student ID</dt><dd className="font-bold">{q.data.studentId}</dd></div>
              <div><dt className="label">Course</dt><dd>{q.data.course ?? '—'}</dd></div>
              <div><dt className="label">Semester</dt><dd>{q.data.semester}, {q.data.academicYear}</dd></div>
              <div><dt className="label">Exam dates</dt><dd>{formatDate(q.data.examStartDate)} – {formatDate(q.data.examEndDate)}</dd></div>
            </dl>
          )}
          {q.data.studentName && <p className="text-xs text-ink-muted">Check that the name and student ID match the student&apos;s ID card.</p>}
        </section>
      )}
      {canSign && q.data && q.data.state !== 'not_found' && (
        <Link to={`/scan?code=${encodeURIComponent(code)}`} className="rounded-md bg-brand-teal px-4 py-3 text-center text-xs font-bold uppercase tracking-wider text-white hover:bg-brand-teal-lt">
          Sign a unit for this student
        </Link>
      )}
    </main>
  );
}
