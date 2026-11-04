import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { Badge, Button, Empty, ErrorNote, PageHeader, Spinner } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { api } from '@/lib/api';
import { EXAM_STATUS } from '@/lib/constants';
import type { Application, ExamPeriod, FeeRecord } from '@/lib/types';
import { cardNumber, formatDate, formatDateTime, formatKsh, toDateString } from '@/lib/utils';

function PrintableCard({ app }: { app: Application }) {
  const { user } = useAuth();
  return (
    <div className="print-area card mt-4 space-y-3 border-2 border-brand-teal-lt">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-display text-xl font-black tracking-widest text-brand-teal-lt">FINESSE</div>
          <div className="text-[10px] uppercase tracking-widest text-ink-muted">Examination Card</div>
        </div>
        <div className="text-right"><div className="label">Card No.</div><div className="font-bold">{cardNumber(app.id)}</div></div>
      </div>
      <dl className="grid grid-cols-2 gap-3">
        <div><dt className="label">Student</dt><dd className="font-bold">{app.student_name}</dd></div>
        <div><dt className="label">Student ID</dt><dd className="font-bold">{app.student_id}</dd></div>
        <div><dt className="label">Course</dt><dd>{app.course ?? user?.course ?? '—'}</dd></div>
        <div><dt className="label">Year</dt><dd>{app.year_of_study ?? '—'}</dd></div>
        <div><dt className="label">Semester</dt><dd>{app.semester}, {app.academic_year}</dd></div>
        <div><dt className="label">Exam dates</dt><dd>{formatDate(app.exam_start_date)} – {formatDate(app.exam_end_date)}</dd></div>
      </dl>
      <p className="text-xs text-ink-muted">Issued {formatDateTime(app.card_issued_at)}. Present this card, with your student ID, at every examination.</p>
    </div>
  );
}

function PeriodCard({ period, app, fee }: { period: ExamPeriod; app?: Application; fee?: FeeRecord }) {
  const qc = useQueryClient();
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['applications'] }); };
  const apply = useMutation({ mutationFn: () => api.post('/applications', { examPeriodId: period.id }), onSuccess: refresh });
  const issue = useMutation({ mutationFn: () => api.post(`/applications/${app!.id}/issue`), onSuccess: refresh });
  const today = toDateString(new Date());
  const open = today >= period.application_open.slice(0, 10) && today <= period.application_close.slice(0, 10);
  const canApply = open && (!app || app.status === 'rejected');
  const st = app ? EXAM_STATUS[app.status] : null;

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold">{period.title}</h2>
          <p className="text-ink-secondary">{period.semester}, {period.academic_year}</p>
        </div>
        {st && <Badge color={st.color}>{st.label}</Badge>}
      </div>
      <p className="text-xs text-ink-muted">
        Applications {formatDate(period.application_open)} – {formatDate(period.application_close)} · Exams {formatDate(period.exam_start_date)} – {formatDate(period.exam_end_date)}
      </p>
      {fee && (
        <div className="grid grid-cols-3 gap-2 rounded-md bg-bg-tertiary p-3 text-center">
          <div><div className="label">Total</div>{formatKsh(fee.total_fee)}</div>
          <div><div className="label">Paid</div>{formatKsh(fee.amount_paid)}</div>
          <div><div className="label">Balance</div><span className={fee.balance > 0 ? 'text-brand-red' : 'text-brand-green'}>{formatKsh(fee.balance)}</span></div>
        </div>
      )}
      {app?.status === 'rejected' && <div className="rounded-md border border-brand-red/40 bg-brand-red/10 p-3 text-brand-red">{app.rejection_reason}</div>}
      {app?.manual_approval_note && <p className="text-xs text-ink-muted">Finance office note: {app.manual_approval_note}</p>}
      <ErrorNote error={apply.error ?? issue.error} />
      <div className="flex flex-wrap gap-2">
        {canApply && <Button loading={apply.isPending} onClick={() => apply.mutate()}>{app ? 'Re-apply' : 'Apply for exam card'}</Button>}
        {!open && !app && <span className="text-ink-muted">Applications are not open right now.</span>}
        {app?.status === 'approved' && <Button loading={issue.isPending} onClick={() => issue.mutate()}>Generate &amp; email my card</Button>}
        {app?.status === 'issued' && <Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print card</Button>}
      </div>
      {app?.status === 'issued' && <PrintableCard app={app} />}
    </div>
  );
}

export function ExamCardPage() {
  const periods = useQuery({ queryKey: ['periods'], queryFn: () => api.get<{ periods: ExamPeriod[] }>('/exam-periods') });
  const apps = useQuery({ queryKey: ['applications'], queryFn: () => api.get<{ applications: Application[] }>('/applications') });
  const fees = useQuery({ queryKey: ['fees', 'mine'], queryFn: () => api.get<{ feeRecords: FeeRecord[] }>('/fee-records/mine') });
  if (periods.isLoading || apps.isLoading) return <Spinner />;
  const err = periods.error ?? apps.error;
  if (err) return <ErrorNote error={err} />;
  const active = periods.data!.periods.filter((p) => p.is_active);
  return (
    <>
      <PageHeader title="Exam Card" subtitle="Apply for your examination card. Your fee record decides the outcome automatically." />
      {active.length === 0 ? <Empty>There is no exam period open for applications.</Empty> : (
        <div className="space-y-4">
          {active.map((p) => (
            <PeriodCard key={p.id} period={p} app={apps.data!.applications.find((a) => a.exam_period_id === p.id)}
              fee={fees.data?.feeRecords.find((f) => f.academic_year === p.academic_year && f.semester === p.semester)} />
          ))}
        </div>
      )}
    </>
  );
}
