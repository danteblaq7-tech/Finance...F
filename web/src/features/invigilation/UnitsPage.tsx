import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Upload, UserPlus } from 'lucide-react';
import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useAuth } from '@/features/auth/AuthProvider';
import { Badge, Button, Empty, ErrorNote, Field, NoteDialog, PageHeader, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { TONE } from '@/lib/constants';
import { downloadCsv, parseRegistrationsCsv, parseUnitsCsv, type ImportResult } from '@/lib/csv';
import type { ExamPeriod, ExamUnit, Lecturer, UnitPeriod, UnitRegisterRow } from '@/lib/types';
import { clock, cn, formatDateTime, isStaffRole } from '@/lib/utils';

const BATCH = 5000; // rows per request (the server's limit)

export function UnitsPage() {
  const { user } = useAuth();
  const staff = isStaffRole(user?.role);
  const [periodId, setPeriodId] = useState('');
  const [openUnit, setOpenUnit] = useState<string | null>(null);

  const periods = useQuery({ queryKey: ['periods'], enabled: staff, queryFn: () => api.get<{ periods: ExamPeriod[] }>('/exam-periods') });
  const units = useQuery({
    queryKey: ['units', periodId],
    queryFn: () => api.get<{ period: UnitPeriod | null; units: ExamUnit[] }>(`/exam-units${periodId ? `?periodId=${periodId}` : ''}`),
  });
  const period = units.data?.period;
  const list = units.data?.units ?? [];

  return (
    <div>
      <PageHeader
        title={staff ? 'Exam units' : 'My units'}
        subtitle={staff ? 'Who sits which unit, who signs it, and who has already signed in.' : 'The units you invigilate and who has signed in.'}
        action={staff && (periods.data?.periods.length ?? 0) > 0 ? (
          <select className="input" aria-label="Exam period" value={periodId || period?.id || ''} onChange={(e) => { setPeriodId(e.target.value); setOpenUnit(null); }}>
            {periods.data!.periods.map((p) => <option key={p.id} value={p.id}>{p.title} · {p.academic_year}, {p.semester}</option>)}
          </select>
        ) : undefined}
      />

      {units.isLoading ? <Spinner /> : units.isError ? <ErrorNote error={units.error} /> : !period ? (
        <Empty>{staff ? 'No active exam period yet. Create one under Exam Periods first.' : 'There is no active exam period.'}</Empty>
      ) : (
        <div className="space-y-8">
          {staff && <SetupPanel periodId={period.id} />}

          {list.length === 0 ? (
            <Empty>{staff ? 'No units yet. Import the student registrations above.' : 'No units are assigned to you in this exam period. Ask the finance office.'}</Empty>
          ) : (
            <ul className="space-y-4">
              {list.map((u) => (
                <UnitCard key={u.id} unit={u} staff={staff} open={openUnit === u.id} onToggle={() => setOpenUnit(openUnit === u.id ? null : u.id)} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function UnitCard({ unit: u, staff, open, onToggle }: { unit: ExamUnit; staff: boolean; open: boolean; onToggle: () => void }) {
  const pct = u.registered ? Math.round((Number(u.signed) / Number(u.registered)) * 100) : 0;
  return (
    <li className="card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-base font-bold">{u.unit_code} <span className="font-normal text-ink-secondary">{u.unit_name}</span></div>
          <div className="mt-1 text-xs text-ink-secondary">
            {[u.exam_date, u.start_time && `${clock(u.start_time)}${u.end_time ? `–${clock(u.end_time)}` : ''}`, u.venue].filter(Boolean).join(' · ') || 'No date or venue set'}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {u.lecturers.length === 0 ? <Badge color={TONE.amber}>NO LECTURER ASSIGNED</Badge> : u.lecturers.map((l) => <Badge key={l.id} color={TONE.teal}>{l.name}</Badge>)}
          </div>
        </div>
        <div className="w-48 text-right">
          <div className="font-display text-xl font-black">{u.signed}<span className="text-ink-secondary">/{u.registered}</span></div>
          <div className="label">signed in</div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-bg-tertiary" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${u.unit_code} signed in`}>
            <div className="h-full rounded-full bg-brand-green" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onToggle} aria-expanded={open}>{open ? 'Hide register' : 'Show register'}</Button>
        {staff && <LecturerAssign unit={u} />}
      </div>
      {open && <Register unit={u} staff={staff} />}
    </li>
  );
}

// ── the register of one unit ─────────────────────────────────

type Filter = 'all' | 'signed' | 'waiting' | 'barred';

function Register({ unit, staff }: { unit: ExamUnit; staff: boolean }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [resetting, setResetting] = useState<UnitRegisterRow | null>(null);
  const [barring, setBarring] = useState<UnitRegisterRow | null>(null);
  const reg = useQuery({
    queryKey: ['register', unit.id],
    queryFn: () => api.get<{ unit: ExamUnit; rows: UnitRegisterRow[] }>(`/exam-units/${unit.id}/register`),
    refetchInterval: 5000, // the hall fills up while you watch
  });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['register', unit.id] }); void qc.invalidateQueries({ queryKey: ['units'] }); };

  const reset = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/exam-units/registrations/${id}/reset`, { reason }),
    onSuccess: () => { setResetting(null); refresh(); },
  });
  const bar = useMutation({
    mutationFn: ({ id, allowed, reason }: { id: string; allowed: boolean; reason: string }) => api.patch(`/exam-units/registrations/${id}`, { allowed, reason }),
    onSuccess: () => { setBarring(null); refresh(); },
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/exam-units/registrations/${id}`), onSuccess: refresh });

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (reg.data?.rows ?? []).filter((r) => {
      if (filter === 'signed' && !r.signed_at) return false;
      if (filter === 'waiting' && (r.signed_at || !r.allowed)) return false;
      if (filter === 'barred' && r.allowed) return false;
      return !needle || r.student_id.toLowerCase().includes(needle) || r.student_name.toLowerCase().includes(needle);
    });
  }, [reg.data, filter, q]);

  if (reg.isLoading) return <div className="mt-4"><Spinner /></div>;
  if (reg.isError) return <div className="mt-4"><ErrorNote error={reg.error} /></div>;

  const all = reg.data!.rows;
  const exportCsv = () => downloadCsv(`${unit.unit_code.replace(/\W+/g, '_')}_register.csv`, [
    ['Student ID', 'Name', 'Status', 'Signed at', 'Signed by', 'Note'],
    ...all.map((r) => [r.student_id, r.student_name, r.signed_at ? 'SIGNED' : r.allowed ? 'NOT YET' : 'NOT ALLOWED', r.signed_at ?? '', r.signed_by_name ?? '', r.block_reason ?? '']),
  ]);

  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(['all', 'signed', 'waiting', 'barred'] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={cn('rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wider', filter === f ? 'border-line-active bg-bg-tertiary' : 'border-line text-ink-secondary')}>
            {f === 'all' ? `All ${all.length}` : f === 'signed' ? `Signed ${all.filter((r) => r.signed_at).length}` : f === 'waiting' ? `Not yet ${all.filter((r) => !r.signed_at && r.allowed).length}` : `Barred ${all.filter((r) => !r.allowed).length}`}
          </button>
        ))}
        <input className="input ml-auto w-48" placeholder="Search name or ID" aria-label="Search the register" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button variant="secondary" onClick={exportCsv}><Download className="h-4 w-4" aria-hidden /> CSV</Button>
      </div>

      {rows.length === 0 ? <p className="py-4 text-ink-secondary">No students match.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[11px] font-bold uppercase tracking-widest text-ink-label"><tr><th className="py-2 pr-3 font-bold">Student</th><th className="pr-3 font-bold">Status</th><th className="pr-3 font-bold">Card</th>{staff && <th aria-label="Actions" />}</tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2.5 pr-3"><div className="font-bold">{r.student_name || '—'}</div><div className="text-ink-secondary">{r.student_id}</div></td>
                  <td className="pr-3">
                    {r.signed_at ? <><Badge color={TONE.green}>SIGNED</Badge><div className="mt-1 text-ink-secondary">{formatDateTime(r.signed_at)} · {r.signed_by_name}</div></>
                      : r.allowed ? <Badge color={TONE.gray}>NOT YET</Badge>
                        : <><Badge color={TONE.red}>NOT ALLOWED</Badge>{r.block_reason && <div className="mt-1 text-ink-secondary">{r.block_reason}</div>}</>}
                  </td>
                  <td className="pr-3">{r.has_card ? <Badge color={TONE.green}>ISSUED</Badge> : <Badge color={TONE.amber}>NO CARD</Badge>}</td>
                  {staff && (
                    <td className="space-x-1 whitespace-nowrap text-right">
                      {r.signed_at ? <Button variant="ghost" onClick={() => setResetting(r)}>Undo</Button> : (
                        <>
                          {r.allowed ? <Button variant="ghost" onClick={() => setBarring(r)}>Bar</Button> : <Button variant="ghost" onClick={() => bar.mutate({ id: r.id, allowed: true, reason: '' })}>Allow</Button>}
                          <Button variant="ghost" onClick={() => { if (window.confirm(`Remove ${r.student_id} from ${unit.unit_code}?`)) remove.mutate(r.id); }}>Remove</Button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(remove.isError || bar.isError) && <div className="mt-3"><ErrorNote error={remove.error ?? bar.error} /></div>}
      {resetting && (
        <NoteDialog title="Undo this signature?" description={`${resetting.student_name || resetting.student_id} will be marked as not yet signed in. Your reason is kept in the audit log.`}
          confirmLabel="Undo signature" busy={reset.isPending} onCancel={() => setResetting(null)} onConfirm={(reason) => reset.mutate({ id: resetting.id, reason })} />
      )}
      {barring && (
        <NoteDialog title="Bar from this unit?" description={`${barring.student_name || barring.student_id} will be refused at the door for ${unit.unit_code}.`}
          confirmLabel="Bar student" busy={bar.isPending} onCancel={() => setBarring(null)} onConfirm={(reason) => bar.mutate({ id: barring.id, allowed: false, reason })} />
      )}
      {reset.isError && <div className="mt-3"><ErrorNote error={reset.error} /></div>}
    </div>
  );
}

// ── assigning lecturers to a unit ────────────────────────────

function LecturerAssign({ unit }: { unit: ExamUnit }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string[]>(unit.lecturers.map((l) => l.id));
  const lecturers = useQuery({ queryKey: ['lecturers'], enabled: open, queryFn: () => api.get<{ lecturers: Lecturer[] }>('/lecturers') });
  const save = useMutation({
    mutationFn: () => api.put(`/exam-units/${unit.id}/lecturers`, { lecturerIds: chosen }),
    onSuccess: () => { setOpen(false); void qc.invalidateQueries({ queryKey: ['units'] }); },
  });
  if (!open) return <Button variant="ghost" onClick={() => { setChosen(unit.lecturers.map((l) => l.id)); setOpen(true); }}>Lecturers</Button>;
  return (
    <div className="w-full rounded-md border border-line p-3">
      <h3 className="label mb-2">Who may sign {unit.unit_code}</h3>
      {lecturers.isLoading ? <Spinner /> : (lecturers.data?.lecturers.length ?? 0) === 0 ? (
        <p className="text-ink-secondary">No lecturer accounts yet. Add one under "Lecturers" in the set-up panel.</p>
      ) : (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {lecturers.data!.lecturers.map((l) => (
            <label key={l.id} className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={chosen.includes(l.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, l.id] : chosen.filter((x) => x !== l.id))} />
              {l.name} <span className="text-ink-secondary">{l.email}</span>
            </label>
          ))}
        </div>
      )}
      {save.isError && <div className="mt-2"><ErrorNote error={save.error} /></div>}
      <div className="mt-3 flex gap-2"><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
    </div>
  );
}

// ── set-up (staff / admin): the two imports and lecturer accounts ─────

function SetupPanel({ periodId }: { periodId: string }) {
  const { user } = useAuth();
  return (
    <details className="card" open>
      <summary className="cursor-pointer text-sm font-bold uppercase tracking-wider">Set up this exam period</summary>
      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <ImportBox
          title="1. Student registrations"
          help="Who sits which unit. Columns: student_id, unit_code (optional: unit_name, allowed yes/no, reason). Units that do not exist yet are created."
          template={[['student_id', 'unit_code', 'unit_name', 'allowed', 'reason'], ['COM/072/23', 'CSC101', 'Introduction to Programming', '', ''], ['COM/073/23', 'CSC101', '', 'no', 'Missing CAT marks']]}
          templateName="registrations_template.csv"
          parse={parseRegistrationsCsv}
          send={async (rows) => {
            let added = 0; let created = 0;
            for (let i = 0; i < rows.length; i += BATCH) {
              const r = await api.post<{ added: number; unitsCreated: number }>('/exam-units/registrations/import', { periodId, rows: rows.slice(i, i + BATCH) });
              added += r.added; created += r.unitsCreated;
            }
            return `${rows.length} rows read: ${added} new registrations, ${created} new units.`;
          }}
          periodId={periodId}
        />
        <ImportBox
          title="2. Unit dates, venues and lecturers"
          help="Optional but recommended. Columns: unit_code (unit_name, exam_date, start_time, end_time, venue, lecturers = e-mails separated by ;). Lecturers must have an account first (below)."
          template={[['unit_code', 'unit_name', 'exam_date', 'start_time', 'end_time', 'venue', 'lecturers'], ['CSC101', 'Introduction to Programming', '2026-11-23', '09:00', '11:00', 'Main Hall', 'lecturer@campus.ac.ke']]}
          templateName="units_template.csv"
          parse={parseUnitsCsv}
          send={async (rows) => {
            let created = 0; let linked = 0; const unknown = new Set<string>();
            for (let i = 0; i < rows.length; i += BATCH) {
              const r = await api.post<{ created: number; lecturersLinked: number; unknownLecturers: string[] }>('/exam-units/import', { periodId, rows: rows.slice(i, i + BATCH) });
              created += r.created; linked += r.lecturersLinked; r.unknownLecturers.forEach((e) => unknown.add(e));
            }
            return `${rows.length} units read: ${created} new, ${linked} lecturer links.${unknown.size ? ` No lecturer account for: ${[...unknown].join(', ')}.` : ''}`;
          }}
          periodId={periodId}
        />
      </div>
      <LecturerAccounts canCreate={user?.role === 'admin'} />
    </details>
  );
}

function ImportBox<T>({ title, help, template, templateName, parse, send, periodId }: {
  title: string; help: string; template: string[][]; templateName: string; periodId: string;
  parse: (text: string) => ImportResult<T>; send: (rows: T[]) => Promise<string>;
}) {
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<{ name: string; result: ImportResult<T> } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () => send(parsed!.result.rows),
    onSuccess: (m) => { setMessage(m); setParsed(null); if (file.current) file.current.value = ''; void qc.invalidateQueries({ queryKey: ['units'] }); void qc.invalidateQueries({ queryKey: ['register'] }); },
  });

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setMessage(null);
    run.reset();
    if (!f) return setParsed(null);
    setParsed({ name: f.name, result: parse(await f.text()) });
  }

  return (
    <div key={periodId} className="rounded-md border border-line p-4">
      <h3 className="text-sm font-bold">{title}</h3>
      <p className="mt-1 text-xs text-ink-secondary">{help}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-line bg-bg-tertiary px-4 py-2 text-xs font-bold uppercase tracking-wider hover:border-line-active">
          <Upload className="h-4 w-4" aria-hidden /> Choose CSV
          <input ref={file} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void pick(e)} aria-label={`${title} file`} />
        </label>
        <Button variant="ghost" onClick={() => downloadCsv(templateName, template)}><Download className="h-4 w-4" aria-hidden /> Template</Button>
      </div>
      {parsed && (
        <div className="mt-3 space-y-2 text-xs">
          <p><b>{parsed.name}</b>: {parsed.result.rows.length} usable rows{parsed.result.errors.length > 0 && <span className="text-brand-amber">, {parsed.result.errors.length} skipped</span>}.</p>
          {parsed.result.errors.length > 0 && (
            <ul className="max-h-28 overflow-auto rounded border border-line p-2 text-brand-amber">
              {parsed.result.errors.slice(0, 50).map((er) => <li key={er.line}>Line {er.line}: {er.message}</li>)}
            </ul>
          )}
          <Button loading={run.isPending} disabled={parsed.result.rows.length === 0} onClick={() => run.mutate()}>Import {parsed.result.rows.length} rows</Button>
        </div>
      )}
      {message && <p role="status" className="mt-3 text-xs text-brand-green">{message}</p>}
      {run.isError && <div className="mt-3"><ErrorNote error={run.error} /></div>}
    </div>
  );
}

function LecturerAccounts({ canCreate }: { canCreate: boolean }) {
  const qc = useQueryClient();
  const lecturers = useQuery({ queryKey: ['lecturers'], queryFn: () => api.get<{ lecturers: Lecturer[] }>('/lecturers') });
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const create = useMutation({
    mutationFn: () => api.post('/lecturers', form),
    onSuccess: () => { setForm({ name: '', email: '', password: '' }); void qc.invalidateQueries({ queryKey: ['lecturers'] }); },
  });
  return (
    <div className="mt-6 rounded-md border border-line p-4">
      <h3 className="text-sm font-bold">3. Lecturers</h3>
      <p className="mt-1 text-xs text-ink-secondary">Lecturers sign in with their own login and can only scan cards and see their own units. {canCreate ? 'Give them a temporary password; they can change it after signing in.' : 'Only an admin can create lecturer logins.'}</p>
      {lecturers.isError && <div className="mt-2"><ErrorNote error={lecturers.error} /></div>}
      {(lecturers.data?.lecturers.length ?? 0) > 0 && (
        <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {lecturers.data!.lecturers.map((l) => <li key={l.id} className="text-xs"><b>{l.name}</b> <span className="text-ink-secondary">{l.email} · {l.units} unit{Number(l.units) === 1 ? '' : 's'}</span></li>)}
        </ul>
      )}
      {canCreate && (
        <form className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <Field label="Name"><input className="input" required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Email"><input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Temporary password"><input className="input" type="text" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="off" /></Field>
          <Button type="submit" loading={create.isPending}><UserPlus className="h-4 w-4" aria-hidden /> Add</Button>
        </form>
      )}
      {create.isError && <div className="mt-3"><ErrorNote error={create.error} /></div>}
      {create.isSuccess && <p role="status" className="mt-3 text-xs text-brand-green">Lecturer added. Share the email and temporary password with them.</p>}
    </div>
  );
}
