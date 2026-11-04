import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { Badge, Button, Empty, ErrorNote, Field, PageHeader, Spinner } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { api } from '@/lib/api';
import { ISSUE_LABELS, ISSUE_TYPES, TICKET_STATUS } from '@/lib/constants';
import type { Slot, SlotDate, Ticket, TicketPriority, TicketStatus } from '@/lib/types';
import { cn, formatDate, formatDateTime, formatTime } from '@/lib/utils';

const REFRESH_MS = 15_000; // tickets & slots poll so staff updates show up without a reload

function TicketRow({ t, staff }: { t: Ticket; staff?: boolean }) {
  const s = TICKET_STATUS[t.status];
  return (
    <Link to={`/tickets/${t.id}`} className="card flex items-center gap-3 hover:border-line-active">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold">{ISSUE_LABELS[t.issue_type] ?? t.issue_type}</span>
          <Badge color={s.color}>{s.label}</Badge>
          {t.priority === 'high' && <Badge color="#EF4444">HIGH</Badge>}
        </div>
        <p className="mt-1 truncate text-ink-secondary">{t.description}</p>
        <p className="mt-1 text-xs text-ink-muted">
          {staff && <>{t.student_name} · {t.student_number} · </>}
          {formatDateTime(t.created_at)}
          {t.appointment_slot && <> · <CalendarCheck className="inline h-3 w-3" /> {formatDateTime(t.appointment_slot)}</>}
        </p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
    </Link>
  );
}

export function MyTicketsPage() {
  const q = useQuery({ queryKey: ['tickets'], queryFn: () => api.get<{ tickets: Ticket[] }>('/tickets'), refetchInterval: REFRESH_MS });
  return (
    <>
      <PageHeader title="My Tickets" subtitle="Your finance support requests" action={<Link to="/tickets/new"><Button>Raise ticket</Button></Link>} />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} /> : q.data!.tickets.length === 0 ? (
        <Empty>No tickets yet. Raise one if you need help from the finance office.</Empty>
      ) : (
        <div className="space-y-3">{q.data!.tickets.map((t) => <TicketRow key={t.id} t={t} />)}</div>
      )}
    </>
  );
}

const newTicketSchema = z.object({
  issueType: z.string().min(1, 'Choose an issue type'),
  priority: z.enum(['low', 'medium', 'high']),
  description: z.string().trim().min(10, 'Please describe the issue (at least 10 characters)').max(4000),
});
type NewTicketValues = z.infer<typeof newTicketSchema>;

export function NewTicketPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm<NewTicketValues>({
    resolver: zodResolver(newTicketSchema), defaultValues: { issueType: '', priority: 'medium', description: '' },
  });
  const create = useMutation({
    mutationFn: (v: NewTicketValues) => api.post<{ ticket: Ticket }>('/tickets', v),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['tickets'] }); navigate(`/tickets/${r.ticket.id}`); },
  });
  return (
    <>
      <PageHeader title="Raise a Ticket" subtitle="Tell the finance office what you need" />
      <form onSubmit={handleSubmit((v) => create.mutate(v))} className="card max-w-2xl space-y-4" noValidate>
        <Field label="Issue type" error={errors.issueType?.message}>
          <select className="input" {...register('issueType')}>
            <option value="">Select…</option>
            {ISSUE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select className="input" {...register('priority')}>
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
          </select>
        </Field>
        <Field label="Description" error={errors.description?.message}>
          <textarea rows={6} className="input" {...register('description')} />
        </Field>
        <ErrorNote error={create.error} />
        <Button type="submit" loading={create.isPending}>Submit ticket</Button>
      </form>
    </>
  );
}

function BookingPanel({ ticket }: { ticket: Ticket }) {
  const qc = useQueryClient();
  const [date, setDate] = useState<string | null>(null);
  const dates = useQuery({ queryKey: ['slot-dates'], queryFn: () => api.get<{ dates: SlotDate[] }>('/slots/dates?days=14'), refetchInterval: REFRESH_MS });
  const active = date ?? dates.data?.dates.find((d) => d.free > 0)?.date ?? null;
  const slots = useQuery({
    queryKey: ['slots', active], enabled: !!active, refetchInterval: REFRESH_MS,
    queryFn: () => api.get<{ slots: Slot[] }>(`/slots?date=${active}`),
  });
  const refresh = () => { for (const k of ['ticket', 'tickets', 'slots', 'slot-dates']) void qc.invalidateQueries({ queryKey: [k] }); };
  const book = useMutation({ mutationFn: (slotId: string) => api.post(`/tickets/${ticket.id}/book`, { slotId }), onSuccess: refresh, onError: refresh });
  const cancel = useMutation({ mutationFn: () => api.del(`/tickets/${ticket.id}/booking`), onSuccess: refresh });

  if (ticket.appointment_slot) {
    return (
      <div className="card flex flex-wrap items-center justify-between gap-3">
        <div><div className="label">Appointment</div><div className="font-bold">{formatDateTime(ticket.appointment_slot)}</div></div>
        {['pending', 'in_review'].includes(ticket.status) && <Button variant="secondary" loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel appointment</Button>}
        <ErrorNote error={cancel.error} />
      </div>
    );
  }
  if (!['pending', 'in_review'].includes(ticket.status)) return null;
  return (
    <div className="card space-y-3">
      <div className="label">Book an in-person appointment (optional)</div>
      {dates.isLoading ? <Spinner /> : !dates.data?.dates.length ? <p className="text-ink-muted">No appointment slots are available yet.</p> : (
        <>
          <div className="flex flex-wrap gap-2">
            {dates.data.dates.map((d) => (
              <button key={d.date} disabled={d.free === 0} onClick={() => setDate(d.date)}
                className={cn('rounded-md border px-3 py-1 text-xs disabled:opacity-40', d.date === active ? 'border-brand-teal-lt bg-brand-teal/20' : 'border-line')}>
                {formatDate(d.date)} · {d.free} free
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {slots.data?.slots.map((s) => (
              <button key={s.id} disabled={s.is_booked || book.isPending} onClick={() => book.mutate(s.id)}
                className="rounded-md border border-line px-2 py-2 text-xs hover:border-line-active disabled:cursor-not-allowed disabled:opacity-30">
                {formatTime(s.start_time)}
              </button>
            ))}
          </div>
        </>
      )}
      <ErrorNote error={book.error} />
    </div>
  );
}

function StaffControls({ ticket }: { ticket: Ticket }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const [priority, setPriority] = useState<TicketPriority>(ticket.priority);
  const [notes, setNotes] = useState(ticket.staff_notes);
  const save = useMutation({
    mutationFn: () => api.patch(`/tickets/${ticket.id}`, { status, priority, staffNotes: notes }),
    onSuccess: () => { for (const k of ['ticket', 'tickets']) void qc.invalidateQueries({ queryKey: [k] }); },
  });
  return (
    <div className="card space-y-3">
      <div className="label">Staff controls</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Status">
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as TicketStatus)}>
            {Object.entries(TICKET_STATUS).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)}>
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
          </select>
        </Field>
      </div>
      <Field label="Notes to student" hint="Shown to the student on their ticket.">
        <textarea rows={4} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <ErrorNote error={save.error} />
      <Button loading={save.isPending} onClick={() => save.mutate()}>{save.isSuccess ? 'Saved ✓' : 'Save changes'}</Button>
    </div>
  );
}

export function TicketDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const staff = user?.role !== 'student';
  const q = useQuery({ queryKey: ['ticket', id], queryFn: () => api.get<{ ticket: Ticket }>(`/tickets/${id}`), refetchInterval: REFRESH_MS });
  const cancel = useMutation({
    mutationFn: () => api.patch(`/tickets/${id}`, { status: 'cancelled' }),
    onSuccess: () => { for (const k of ['ticket', 'tickets', 'slots', 'slot-dates']) void qc.invalidateQueries({ queryKey: [k] }); },
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} />;
  const t = q.data!.ticket;
  const s = TICKET_STATUS[t.status];
  return (
    <>
      <Link to={staff ? '/staff/queue' : '/tickets'} className="mb-4 inline-block text-xs text-brand-teal-lt underline">← Back</Link>
      <PageHeader title={ISSUE_LABELS[t.issue_type] ?? t.issue_type} subtitle={`${t.student_name}${t.student_number ? ` · ${t.student_number}` : ''} · raised ${formatDateTime(t.created_at)}`} action={<Badge color={s.color}>{s.label}</Badge>} />
      <div className="space-y-4">
        <div className="card"><div className="label">Description</div><p className="whitespace-pre-wrap">{t.description}</p></div>
        {!staff && t.staff_notes && <div className="card border-brand-teal-lt/50"><div className="label">Response from the finance office</div><p className="whitespace-pre-wrap">{t.staff_notes}</p></div>}
        {staff ? <StaffControls key={t.updated_at} ticket={t} /> : <BookingPanel ticket={t} />}
        {staff && t.appointment_slot && <div className="card"><div className="label">Appointment</div>{formatDateTime(t.appointment_slot)}</div>}
        {!staff && ['pending', 'in_review'].includes(t.status) && (
          <>
            <ErrorNote error={cancel.error} />
            <Button variant="danger" loading={cancel.isPending} onClick={() => { if (confirm('Cancel this ticket?')) cancel.mutate(); }}>Cancel ticket</Button>
          </>
        )}
      </div>
    </>
  );
}

export function StaffQueuePage() {
  const [filter, setFilter] = useState<'open' | TicketStatus | 'all'>('open');
  const q = useQuery({ queryKey: ['tickets', 'staff'], queryFn: () => api.get<{ tickets: Ticket[] }>('/tickets'), refetchInterval: REFRESH_MS });
  const tickets = (q.data?.tickets ?? []).filter((t) => (filter === 'all' ? true : filter === 'open' ? ['pending', 'in_review'].includes(t.status) : t.status === filter));
  const tabs: Array<['open' | TicketStatus | 'all', string]> = [['open', 'Open'], ['pending', 'Pending'], ['in_review', 'In review'], ['resolved', 'Resolved'], ['cancelled', 'Cancelled'], ['all', 'All']];
  return (
    <>
      <PageHeader title="Ticket Queue" subtitle="Highest priority first" />
      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map(([v, label]) => (
          <button key={v} onClick={() => setFilter(v)} className={cn('rounded-md border px-3 py-1 text-xs font-bold uppercase', filter === v ? 'border-brand-teal-lt bg-brand-teal/20' : 'border-line text-ink-secondary')}>{label}</button>
        ))}
      </div>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} /> : tickets.length === 0 ? <Empty>Nothing here.</Empty> : (
        <div className="space-y-3">{tickets.map((t) => <TicketRow key={t.id} t={t} staff />)}</div>
      )}
    </>
  );
}
