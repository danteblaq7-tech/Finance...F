import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge, Button, Empty, ErrorNote, Field, NoteDialog, PageHeader, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { parseFeeCsv, type FeeImportResult } from '@/lib/csv';
import { EXAM_STATUS } from '@/lib/constants';
import type { Application, ExamCardStatus, ExamPeriod, FeeRecord } from '@/lib/types';
import { cn, formatDate, formatDateTime, formatKsh } from '@/lib/utils';

// ── Applications ─────────────────────────────────────────────

export function ApplicationsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<ExamCardStatus | 'all'>('all');
  const [approving, setApproving] = useState<Application | null>(null);
  const q = useQuery({ queryKey: ['applications', 'staff'], queryFn: () => api.get<{ applications: Application[] }>('/applications'), refetchInterval: 15_000 });
  const approve = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => api.post(`/applications/${id}/approve`, { note }),
    onSuccess: () => { setApproving(null); void qc.invalidateQueries({ queryKey: ['applications'] }); },
  });
  const rows = (q.data?.applications ?? []).filter((a) => filter === 'all' || a.status === filter);
  return (
    <>
      <PageHeader title="Exam Card Applications" subtitle="Outcomes are decided automatically from fee records; override with a recorded reason." />
      <div className="mb-4 flex flex-wrap gap-2">
        {(['all', 'pending', 'approved', 'rejected', 'issued'] as const).map((v) => (
          <button key={v} onClick={() => setFilter(v)} className={cn('rounded-md border px-3 py-1 text-xs font-bold uppercase', filter === v ? 'border-brand-teal-lt bg-brand-teal/20' : 'border-line text-ink-secondary')}>{v}</button>
        ))}
      </div>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} /> : rows.length === 0 ? <Empty>No applications.</Empty> : (
        <div className="space-y-3">
          {rows.map((a) => (
            <div key={a.id} className="card flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><span className="font-bold">{a.student_name}</span><Badge color={EXAM_STATUS[a.status].color}>{EXAM_STATUS[a.status].label}</Badge></div>
                <div className="text-xs text-ink-muted">{a.student_id} · {a.course} · {a.period_title} · applied {formatDateTime(a.created_at)}</div>
                <div className="text-xs">Paid {formatKsh(a.amount_paid)} of {formatKsh(a.total_fee)} · balance {formatKsh(a.balance)}</div>
                {a.manual_approval_note && <div className="text-xs text-ink-secondary">Override: {a.manual_approval_note}</div>}
              </div>
              {['rejected', 'pending'].includes(a.status) && <Button variant="secondary" onClick={() => setApproving(a)}>Approve manually</Button>}
            </div>
          ))}
        </div>
      )}
      {approving && (
        <NoteDialog title={`Approve ${approving.student_name}?`} description="This overrides the automatic decision. Your name and reason are recorded." confirmLabel="Approve" busy={approve.isPending}
          onCancel={() => setApproving(null)} onConfirm={(note) => approve.mutate({ id: approving.id, note })} />
      )}
      <ErrorNote error={approve.error} />
    </>
  );
}

// ── Fee records ──────────────────────────────────────────────

const importMeta = z.object({ academicYear: z.string().trim().regex(/^\d{4}\/\d{4}$/, 'Use the format 2026/2027'), semester: z.string().trim().min(1, 'Required') });
type ImportMeta = z.infer<typeof importMeta>;

export function FeeRecordsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [parsed, setParsed] = useState<FeeImportResult | null>(null);
  const [excepting, setExcepting] = useState<FeeRecord | null>(null);
  const { register, handleSubmit, formState: { errors } } = useForm<ImportMeta>({ resolver: zodResolver(importMeta), defaultValues: { academicYear: '2026/2027', semester: 'Semester 1' } });

  const q = useQuery({ queryKey: ['fees', 'staff', search], queryFn: () => api.get<{ feeRecords: FeeRecord[] }>(`/fee-records?search=${encodeURIComponent(search)}`) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['fees'] }); };
  const doImport = useMutation({
    mutationFn: (m: ImportMeta) => api.post<{ imported: number }>('/fee-records/import', { ...m, rows: parsed!.rows }),
    onSuccess: () => { setParsed(null); refresh(); },
  });
  const grant = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => api.post(`/fee-records/${id}/exception`, { note }),
    onSuccess: () => { setExcepting(null); refresh(); },
  });

  return (
    <>
      <PageHeader title="Fee Records" subtitle="Import payments from the finance system, or grant exceptions." />
      <form onSubmit={handleSubmit((m) => doImport.mutate(m))} className="card mb-6 space-y-3" noValidate>
        <div className="label">Import CSV</div>
        <p className="text-xs text-ink-muted">Columns: <code>student_id, student_name, email, course, total_fee, amount_paid, payment_ref</code>. Existing rows for the same student and semester are updated.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Academic year" error={errors.academicYear?.message}><input className="input" {...register('academicYear')} /></Field>
          <Field label="Semester" error={errors.semester?.message}><input className="input" {...register('semester')} /></Field>
          <Field label="CSV file"><input type="file" accept=".csv,text/csv" className="input" onChange={async (e) => { const f = e.target.files?.[0]; setParsed(f ? parseFeeCsv(await f.text()) : null); }} /></Field>
        </div>
        {parsed && (
          <div className="text-xs">
            <span className="text-brand-green">{parsed.rows.length} valid row(s)</span>
            {parsed.errors.length > 0 && <span className="ml-3 text-brand-red">{parsed.errors.length} problem(s):</span>}
            <ul className="mt-1 list-disc pl-5 text-brand-red">{parsed.errors.slice(0, 5).map((er) => <li key={er.line}>Line {er.line}: {er.message}</li>)}</ul>
          </div>
        )}
        <ErrorNote error={doImport.error} />
        <Button type="submit" disabled={!parsed || parsed.rows.length === 0} loading={doImport.isPending}>
          Import {parsed?.rows.length ? `${parsed.rows.length} rows` : ''}
        </Button>
        {doImport.isSuccess && <span className="ml-3 text-brand-green">Imported {doImport.data.imported} records ✓</span>}
      </form>

      <input className="input mb-4 max-w-sm" placeholder="Search student ID or name…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search fee records" />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} /> : q.data!.feeRecords.length === 0 ? <Empty>No fee records.</Empty> : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-xs">
            <thead className="bg-bg-tertiary text-ink-label"><tr>{['Student', 'Term', 'Total', 'Paid', 'Balance', 'Cleared', ''].map((h) => <th key={h} className="px-3 py-2 font-bold uppercase tracking-wider">{h}</th>)}</tr></thead>
            <tbody>
              {q.data!.feeRecords.map((f) => (
                <tr key={f.id} className="border-t border-line">
                  <td className="px-3 py-2"><div className="font-bold">{f.student_name || '—'}</div><div className="text-ink-muted">{f.student_id}</div></td>
                  <td className="px-3 py-2">{f.semester}<br /><span className="text-ink-muted">{f.academic_year}</span></td>
                  <td className="px-3 py-2">{formatKsh(f.total_fee)}</td>
                  <td className="px-3 py-2">{formatKsh(f.amount_paid)}</td>
                  <td className={cn('px-3 py-2', f.balance > 0 && 'text-brand-red')}>{formatKsh(f.balance)}</td>
                  <td className="px-3 py-2">{f.is_cleared_for_exam ? <Badge color="#22C55E">YES</Badge> : <Badge color="#EF4444">NO</Badge>}{f.exception_note && <div className="mt-1 text-ink-muted">Exception: {f.exception_note}</div>}</td>
                  <td className="px-3 py-2">{!f.is_cleared_for_exam && <Button variant="secondary" onClick={() => setExcepting(f)}>Grant exception</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {excepting && (
        <NoteDialog title={`Grant exception: ${excepting.student_name ?? excepting.student_id}`} description={`Clears them for exams despite a ${formatKsh(excepting.balance)} balance. Recorded under your name.`}
          confirmLabel="Grant" busy={grant.isPending} onCancel={() => setExcepting(null)} onConfirm={(note) => grant.mutate({ id: excepting.id, note })} />
      )}
      <ErrorNote error={grant.error} />
    </>
  );
}

// ── Exam periods ─────────────────────────────────────────────

const periodSchema = z.object({
  title: z.string().trim().min(3, 'Required'),
  academicYear: z.string().trim().regex(/^\d{4}\/\d{4}$/, 'Use the format 2026/2027'),
  semester: z.string().trim().min(1, 'Required'),
  applicationOpen: z.string().min(1, 'Required'),
  applicationClose: z.string().min(1, 'Required'),
  examStartDate: z.string().min(1, 'Required'),
  examEndDate: z.string().min(1, 'Required'),
}).refine((p) => p.applicationClose >= p.applicationOpen, { message: 'Must be on/after the open date', path: ['applicationClose'] })
  .refine((p) => p.examEndDate >= p.examStartDate, { message: 'Must be on/after the start date', path: ['examEndDate'] });
type PeriodValues = z.infer<typeof periodSchema>;

export function ExamPeriodsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['periods'], queryFn: () => api.get<{ periods: ExamPeriod[] }>('/exam-periods') });
  const { register, handleSubmit, reset, formState: { errors } } = useForm<PeriodValues>({ resolver: zodResolver(periodSchema) });
  const create = useMutation({
    mutationFn: (v: PeriodValues) => api.post('/exam-periods', { ...v, minPaymentPercent: 100, isActive: true }),
    onSuccess: () => { reset(); void qc.invalidateQueries({ queryKey: ['periods'] }); },
  });
  const toggle = useMutation({
    mutationFn: (p: ExamPeriod) => api.patch(`/exam-periods/${p.id}`, { isActive: !p.is_active }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['periods'] }); },
  });
  return (
    <>
      <PageHeader title="Exam Periods" subtitle="Windows in which students can apply for an exam card." />
      <form onSubmit={handleSubmit((v) => create.mutate(v))} className="card mb-6 space-y-3" noValidate>
        <div className="label">New exam period</div>
        <Field label="Title" error={errors.title?.message}><input className="input" {...register('title')} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Academic year" error={errors.academicYear?.message}><input className="input" placeholder="2026/2027" {...register('academicYear')} /></Field>
          <Field label="Semester" error={errors.semester?.message}><input className="input" placeholder="Semester 1" {...register('semester')} /></Field>
          <Field label="Applications open" error={errors.applicationOpen?.message}><input type="date" className="input" {...register('applicationOpen')} /></Field>
          <Field label="Applications close" error={errors.applicationClose?.message}><input type="date" className="input" {...register('applicationClose')} /></Field>
          <Field label="Exams start" error={errors.examStartDate?.message}><input type="date" className="input" {...register('examStartDate')} /></Field>
          <Field label="Exams end" error={errors.examEndDate?.message}><input type="date" className="input" {...register('examEndDate')} /></Field>
        </div>
        <ErrorNote error={create.error} />
        <Button type="submit" loading={create.isPending}>Create period</Button>
      </form>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} /> : (
        <div className="space-y-3">
          {q.data!.periods.map((p) => (
            <div key={p.id} className="card flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 font-bold">{p.title} <Badge color={p.is_active ? '#22C55E' : '#6B7280'}>{p.is_active ? 'ACTIVE' : 'INACTIVE'}</Badge></div>
                <div className="text-xs text-ink-muted">{p.semester}, {p.academic_year} · apply {formatDate(p.application_open)} – {formatDate(p.application_close)} · exams {formatDate(p.exam_start_date)} – {formatDate(p.exam_end_date)}</div>
              </div>
              <Button variant="secondary" loading={toggle.isPending} onClick={() => toggle.mutate(p)}>{p.is_active ? 'Deactivate' : 'Activate'}</Button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
