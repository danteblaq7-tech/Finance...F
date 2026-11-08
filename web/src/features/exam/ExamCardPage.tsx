import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, Printer } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useRef, useState } from 'react';
import { Badge, Button, Empty, ErrorNote, PageHeader, Spinner } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { UnitChecklist } from './UnitChecklist';
import { api } from '@/lib/api';
import { EXAM_STATUS, TONE } from '@/lib/constants';
import type { Application, ExamPeriod, FeeRecord, FeeStatement, MyUnit } from '@/lib/types';
import { cardNumber, formatDate, formatDateTime, formatKsh, toDateString } from '@/lib/utils';

const MAX_MB = 5;
const ACCEPT = '.pdf,.csv,.txt,.png,.jpg,.jpeg,application/pdf,text/csv,text/plain,image/png,image/jpeg';

/** Provisional = approved from an uploaded statement that no staff member has verified yet. */
const isProvisional = (a: Application) => a.decision_source === 'statement' && !a.manually_approved_by;

function PrintableCard({ app }: { app: Application }) {
  const { user } = useAuth();
  // The units this student may sit (registered by the finance/academic office); shown on the card so nothing is a surprise at the door.
  const myUnits = useQuery({
    queryKey: ['my-units', app.exam_period_id],
    queryFn: () => api.get<{ units: MyUnit[] }>(`/exam-units/mine?periodId=${app.exam_period_id}`),
    retry: false,
    refetchInterval: 15_000, // safety net; live updates normally arrive instantly (lib/realtime.ts)
  });
  const verifyUrl = `${window.location.origin}/verify/${app.verification_code}`;
  return (
    <div className="print-area card mt-4 space-y-3 border-2 border-brand-teal-lt">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-display text-xl font-black tracking-widest text-brand-teal-lt">FINESSE</div>
          <div className="text-[10px] uppercase tracking-widest text-ink-muted">Examination Card</div>
        </div>
        <div className="text-right"><div className="label">Card No.</div><div className="font-bold">{cardNumber(app.id)}</div></div>
      </div>
      {isProvisional(app) && (
        <div className="rounded-md border border-brand-amber p-2 text-center text-xs font-bold uppercase tracking-wider text-brand-amber">
          Provisional: subject to verification by the finance office
        </div>
      )}
      <div className="flex items-start justify-between gap-4">
        <dl className="grid flex-1 grid-cols-2 gap-3">
          <div><dt className="label">Student</dt><dd className="font-bold">{app.student_name}</dd></div>
          <div><dt className="label">Student ID</dt><dd className="font-bold">{app.student_id}</dd></div>
          <div><dt className="label">Course</dt><dd>{app.course ?? user?.course ?? '—'}</dd></div>
          <div><dt className="label">Year</dt><dd>{app.year_of_study ?? '—'}</dd></div>
          <div><dt className="label">Semester</dt><dd>{app.semester}, {app.academic_year}</dd></div>
          <div><dt className="label">Exam dates</dt><dd>{formatDate(app.exam_start_date)} – {formatDate(app.exam_end_date)}</dd></div>
        </dl>
        {app.verification_code && (
          <div className="shrink-0 text-center">
            <div className="rounded-md bg-white p-2"><QRCodeSVG value={verifyUrl} size={104} level="M" /></div>
            <div className="mt-1 font-mono text-[10px] tracking-widest">{app.verification_code}</div>
          </div>
        )}
      </div>
      {myUnits.data && <UnitChecklist units={myUnits.data.units} />}
      <p className="text-xs text-ink-muted">
        Issued {formatDateTime(app.card_issued_at)}. Present this card, with your student ID, at every examination. Invigilators can confirm it is genuine by scanning the QR code.
      </p>
    </div>
  );
}

/** Upload your fee statement; the figures on it decide the outcome (or send it to the finance office). */
function StatementUpload({ period, replacing }: { period: ExamPeriod; replacing: boolean }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: (file: File) => api.upload<{ application: Application; statement: FeeStatement }>(`/fee-statements?examPeriodId=${period.id}`, file),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['applications'] }); void qc.invalidateQueries({ queryKey: ['statements'] }); },
  });

  const pick = (file: File | undefined) => {
    setLocalError(null);
    if (!file) return;
    if (file.size > MAX_MB * 1024 * 1024) return setLocalError(`That file is larger than ${MAX_MB} MB.`);
    if (file.size === 0) return setLocalError('That file is empty.');
    upload.mutate(file);
    if (input.current) input.current.value = '';
  };

  return (
    <div className="space-y-2 rounded-md border border-dashed border-line p-3">
      <div className="text-sm font-bold">{replacing ? 'Upload a newer fee statement' : 'Upload your fee statement'}</div>
      <p className="text-xs text-ink-muted">
        PDF or CSV downloaded from your student portal works best (a clear photo is accepted but is checked by a person). It must show your student ID. The figures on it decide your exam card.
      </p>
      <input ref={input} type="file" accept={ACCEPT} className="sr-only" id={`stmt-${period.id}`} onChange={(e) => pick(e.target.files?.[0])} />
      <Button variant="secondary" loading={upload.isPending} onClick={() => input.current?.click()}><FileUp className="h-4 w-4" /> {upload.isPending ? 'Reading your statement…' : 'Choose statement file'}</Button>
      {localError && <p role="alert" className="text-brand-red">{localError}</p>}
      <ErrorNote error={upload.error} />
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
  const awaitingReview = app?.status === 'pending' && app.decision_source === 'statement';
  const canRetry = open && (!app || app.status === 'rejected' || awaitingReview);
  const st = app ? EXAM_STATUS[app.status] : null;
  const fromStatement = Boolean(app?.statement_id) && app?.decision_source !== 'fee_record';

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold">{period.title}</h2>
          <p className="text-ink-secondary">{period.semester}, {period.academic_year}</p>
        </div>
        <div className="flex gap-2">
          {awaitingReview && <Badge color={TONE.amber}>AWAITING VERIFICATION</Badge>}
          {app?.revoked_at ? <Badge color={TONE.gray}>REVOKED</Badge> : st && !awaitingReview && <Badge color={st.color}>{st.label}</Badge>}
        </div>
      </div>
      <p className="text-xs text-ink-muted">
        Applications {formatDate(period.application_open)} – {formatDate(period.application_close)} · Exams {formatDate(period.exam_start_date)} – {formatDate(period.exam_end_date)}
        {period.min_payment_percent < 100 && ` · at least ${period.min_payment_percent}% of fees must be paid`}
      </p>

      {fee && (
        <div className="grid grid-cols-3 gap-2 rounded-md bg-bg-tertiary p-3 text-center">
          <div><div className="label">Total</div>{formatKsh(fee.total_fee)}</div>
          <div><div className="label">Paid</div>{formatKsh(fee.amount_paid)}</div>
          <div><div className="label">Balance</div><span className={fee.balance > 0 ? 'text-brand-red' : 'text-brand-green'}>{formatKsh(fee.balance)}</span></div>
        </div>
      )}
      {!fee && app && fromStatement && (
        <div className="rounded-md bg-bg-tertiary p-3">
          <div className="label mb-1 text-center">Read from your uploaded statement</div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div><div className="label">Total</div>{formatKsh(app.total_fee)}</div>
            <div><div className="label">Paid</div>{formatKsh(app.amount_paid)}</div>
            <div><div className="label">Balance</div><span className={app.balance > 0 ? 'text-brand-red' : 'text-brand-green'}>{formatKsh(app.balance)}</span></div>
          </div>
        </div>
      )}

      {app?.status === 'rejected' && <div role="alert" className="rounded-md border border-brand-red/40 bg-brand-red/10 p-3 text-brand-red">{app.rejection_reason}</div>}
      {app?.status_note && app.status !== 'rejected' && <div className="rounded-md border border-brand-amber/40 bg-brand-amber/10 p-3 text-ink-secondary">{app.status_note}</div>}
      {app?.manual_approval_note && <p className="text-xs text-ink-muted">Finance office note: {app.manual_approval_note}</p>}
      {app?.revoked_at && <div role="alert" className="rounded-md border border-brand-red/40 bg-brand-red/10 p-3 text-brand-red">This card was revoked on {formatDate(app.revoked_at)}. Please visit the finance office.</div>}

      <ErrorNote error={apply.error ?? issue.error} />
      <div className="flex flex-wrap gap-2">
        {fee && canRetry && <Button loading={apply.isPending} onClick={() => apply.mutate()}>{app ? 'Re-apply' : 'Apply for exam card'}</Button>}
        {!open && !app && <span className="text-ink-muted">Applications are not open right now.</span>}
        {app?.status === 'approved' && !app.revoked_at && <Button loading={issue.isPending} onClick={() => issue.mutate()}>Generate &amp; email my card</Button>}
        {app?.status === 'issued' && !app.revoked_at && <Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print card</Button>}
      </div>
      {(canRetry && (!fee || app)) && <StatementUpload period={period} replacing={Boolean(app)} />}
      {app?.status === 'issued' && !app.revoked_at && <PrintableCard app={app} />}
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
      <PageHeader title="Exam Card" subtitle="Upload your fee statement and your exam card is decided from the figures on it. If your fees are cleared you can print your card." />
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
