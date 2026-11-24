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
import { ISSUE_LABELS, ISSUE_TYPES, TICKET_STATUS, TONE } from '@/lib/constants';
import type { Slot, SlotDate, Ticket, TicketPriority, TicketStatus } from '@/lib/types';
import { cn, formatDate, formatDateTime, formatTime, isStaffRole } from '@/lib/utils';

const REFRESH_MS = 15_000; // tickets & slots poll so staff updates show up without a reload

function TicketRow({ t, staff }: { t: Ticket; staff?: boolean }) {
  const s = TICKET_STATUS[t.status];
  return (
    <Link to={`/tickets/${t.id}`} className="card flex items-center gap-3 hover:border-line-active">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold">{ISSUE_LABELS[t.issue_type] ?? t.issue_type}</span>
          <Badge color={s.color}>{s.label}</Badge>
          {t.priority === 'high' && <Badge color={TONE.red}>HIGH</Badge>}
        </div>
        <p className="mt-1 truncate text-ink-secondary">{t.description}</p>
        <p className="mt-1 text-xs text-ink-muted">
          {staff && <>{t.student_name} · {t.student_number} · </>}
          {formatDateTime(t.created_at)}
          {t.appointment_slot && <> · <CalendarCheck className="inline h-3 w-3" /> {formatDateTime(t.appointment_slot)}</>}
          {staff && t.assigned_staff_name && <> · Assigned to {t.assigned_staff_name}</>}
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
  const [appointmentDate, setAppointmentDate] = useState<string | null>(null);
  const [appointmentSlotId, setAppointmentSlotId] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors } } = useForm<NewTicketValues>({
    resolver: zodResolver(newTicketSchema), defaultValues: { issueType: '', priority: 'medium', description: '' },
  });
  const dates = useQuery({
    queryKey: ['slot-dates'],
    queryFn: () => api.get<{ dates: SlotDate[] }>('/slots/dates?days=60'),
    refetchInterval: REFRESH_MS,
  });
  const activeDate = appointmentDate ?? dates.data?.dates[0]?.date ?? null;
  const slots = useQuery({
    queryKey: ['slots', activeDate],
    enabled: !!activeDate,
    queryFn: () => api.get<{ slots: Slot[] }>(`/slots?date=${activeDate}`),
    refetchInterval: REFRESH_MS,
  });
  const selectedSlot = slots.data?.slots.find((slot) => slot.id === appointmentSlotId);
  const create = useMutation({
    mutationFn: (v: NewTicketValues) => api.post<{ ticket: Ticket }>('/tickets', {
      ...v,
      ...(appointmentSlotId ? { slotId: appointmentSlotId } : {}),
    }),
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
        <section className="space-y-3 rounded-lg border border-line p-4" aria-label="Optional in-person appointment">
          <div>
            <h2 className="font-bold">In-person appointment (optional)</h2>
            <p className="text-sm text-ink-secondary">Choose an available time if you need to visit the Finance Office.</p>
          </div>
          {dates.isLoading ? <Spinner /> : dates.error ? <ErrorNote error={dates.error} /> : !dates.data?.dates.length ? (
            <p className="text-sm text-ink-muted">No future appointment slots are available. You can still submit your ticket.</p>
          ) : (
            <>
              <Field label="Appointment date">
                <select
                  className="input"
                  value={activeDate ?? ''}
                  onChange={(event) => {
                    setAppointmentDate(event.target.value);
                    setAppointmentSlotId(null);
                  }}
                >
                  {dates.data.dates.map((item) => <option key={item.date} value={item.date}>{formatDate(item.date)} · {item.free} available</option>)}
                </select>
              </Field>
              {slots.isLoading ? <Spinner /> : <div className="flex flex-wrap gap-2">
                {slots.data?.slots.filter((slot) => !slot.is_booked).map((slot) => (
                  <button
                    key={slot.id}
                    type="button"
                    aria-pressed={appointmentSlotId === slot.id}
                    onClick={() => setAppointmentSlotId(appointmentSlotId === slot.id ? null : slot.id)}
                    className={cn(
                      'rounded-md border px-3 py-2 text-sm',
                      appointmentSlotId === slot.id ? 'border-brand-teal-lt bg-brand-teal/20' : 'border-line',
                    )}
                  >
                    {formatTime(slot.start_time)}
                  </button>
                ))}
                {!slots.isLoading && !slots.data?.slots.some((slot) => !slot.is_booked) && (
                  <p className="text-sm text-ink-muted">No future times remain on this date.</p>
                )}
              </div>}
            </>
          )}
          {selectedSlot && <p className="text-sm text-brand-teal-lt">Selected: {formatDate(activeDate)} at {formatTime(selectedSlot.start_time)}</p>}
        </section>
        <ErrorNote error={create.error} />
        <Button type="submit" loading={create.isPending}>Submit ticket</Button>
      </form>
    </>
  );
}

function BookingPanel({ ticket }: { ticket: Ticket }) {
  const qc = useQueryClient();
  const [date, setDate] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const dates = useQuery({ queryKey: ['slot-dates'], queryFn: () => api.get<{ dates: SlotDate[] }>('/slots/dates?days=60'), refetchInterval: REFRESH_MS });
  const active = date ?? dates.data?.dates.find((d) => d.free > 0)?.date ?? null;
  const slots = useQuery({
    queryKey: ['slots', active], enabled: !!active, refetchInterval: REFRESH_MS,
    queryFn: () => api.get<{ slots: Slot[] }>(`/slots?date=${active}`),
  });
  const refresh = () => { for (const k of ['ticket', 'tickets', 'slots', 'slot-dates']) void qc.invalidateQueries({ queryKey: [k] }); };
  const book = useMutation({
    mutationFn: (slotId: string) => changing
      ? api.patch(`/tickets/${ticket.id}/booking`, { slotId })
      : api.post(`/tickets/${ticket.id}/book`, { slotId }),
    onSuccess: () => { setChanging(false); refresh(); },
    onError: refresh,
  });
  const cancel = useMutation({ mutationFn: () => api.del(`/tickets/${ticket.id}/booking`), onSuccess: refresh });

  if (ticket.appointment_slot && !changing) {
    return (
      <div className="card flex flex-wrap items-center justify-between gap-3">
        <div><div className="label">Appointment</div><div className="font-bold">{formatDateTime(ticket.appointment_slot)}</div></div>
        {['pending', 'in_review'].includes(ticket.status) && (
          <>
            <Button variant="secondary" onClick={() => setChanging(true)}>Change appointment</Button>
            <Button variant="secondary" loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel appointment</Button>
          </>
        )}
        <ErrorNote error={cancel.error} />
      </div>
    );
  }
  if (!['pending', 'in_review'].includes(ticket.status)) return null;
  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="label">{changing ? 'Choose a new appointment time' : 'Book an in-person appointment (optional)'}</div>
        {changing && <Button variant="secondary" onClick={() => setChanging(false)}>Keep current appointment</Button>}
      </div>
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
  const [issueType, setIssueType] = useState(ticket.issue_type);
  const [priority, setPriority] = useState<TicketPriority>(ticket.priority);
  const [response, setResponse] = useState('');
  const save = useMutation({
    mutationFn: () => api.patch(`/tickets/${ticket.id}`, { issueType, status, priority, ...(response.trim() ? { response: response.trim() } : {}) }),
    onSuccess: () => {
      setResponse('');
      for (const k of ['ticket', 'tickets']) void qc.invalidateQueries({ queryKey: [k] });
    },
  });
  return (
    <div className="card space-y-3">
      <div className="label">Staff controls</div>
      {ticket.classification && (
        <div className="rounded border border-line p-3 text-sm">
          <div className="font-bold">Classifier suggestion · {ticket.classification.provider_name}</div>
          <p className="mt-1">{ISSUE_LABELS[ticket.classification.suggested_category] ?? ticket.classification.suggested_category} · {ticket.classification.suggested_priority}</p>
          <p className="mt-1 text-ink-secondary">{ticket.classification.rationale}</p>
          <p className="mt-1 text-xs text-ink-muted">{formatDateTime(ticket.classification.timestamp)}</p>
          <Button variant="secondary" className="mt-2" onClick={() => {
            setIssueType(ticket.classification!.suggested_category);
            setPriority(ticket.classification!.suggested_priority);
          }}>Use suggestion</Button>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Issue category">
          <select className="input" value={issueType} onChange={(e) => setIssueType(e.target.value)}>
            {ISSUE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select className="input" value={status} onChange={(e) => {
            const next = e.target.value as TicketStatus;
            setStatus(next);
            if (next === 'cancelled') setResponse('');
          }}>
            {Object.entries(TICKET_STATUS).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)}>
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
          </select>
        </Field>
      </div>
      <Field label="New Finance Office response" hint="Added to the ticket history; previous responses are kept.">
        <textarea rows={4} className="input" value={response} onChange={(e) => setResponse(e.target.value)} />
      </Field>
      <ErrorNote error={save.error} />
      <Button loading={save.isPending} onClick={() => save.mutate()}>{save.isSuccess ? 'Saved ✓' : 'Save changes'}</Button>
    </div>
  );
}

function AdminAssignmentControl({ ticket }: { ticket: Ticket }) {
  const qc = useQueryClient();
  const staff = useQuery({
    queryKey: ['admin-staff', 'ticket-assignment'],
    queryFn: () => api.get<{ staff: { id: string; name: string; role: string; is_active: boolean }[] }>('/admin/staff'),
  });
  const assign = useMutation({
    mutationFn: (assignedStaffId: string | null) => api.patch(`/tickets/${ticket.id}`, { assignedStaffId }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['ticket', ticket.id] }); void qc.invalidateQueries({ queryKey: ['tickets'] }); },
  });
  const available = staff.data?.staff.filter((person) => person.role === 'staff' && person.is_active) ?? [];
  const current = staff.data?.staff.find((person) => person.id === ticket.assigned_staff_id);
  const options = current && !available.some((person) => person.id === current.id) ? [current, ...available] : available;

  return (
    <div className="card space-y-3">
      <Field label="Assigned finance staff">
        <select
          className="input"
          value={ticket.assigned_staff_id ?? ''}
          disabled={staff.isLoading || assign.isPending}
          onChange={(event) => assign.mutate(event.target.value || null)}
        >
          <option value="">Unassigned</option>
          {options.map((person) => (
            <option key={person.id} value={person.id} disabled={!person.is_active || person.role !== 'staff'}>
              {person.name}{person.is_active ? '' : ' (inactive)'}
            </option>
          ))}
        </select>
      </Field>
      <ErrorNote error={staff.error ?? assign.error} />
    </div>
  );
}

export function TicketDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const staff = isStaffRole(user?.role);
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
        {!!t.responses?.length && (
          <section aria-label="Finance Office response history" className="space-y-3">
            <div className="label">Finance Office response history</div>
            {t.responses.map((r) => (
              <div key={r.id} className="card border-brand-teal-lt/50">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="label">{r.author_name || 'Finance Office'}</div>
                  <time className="text-xs text-ink-muted">{formatDateTime(r.created_at)}</time>
                </div>
                <p className="mt-2 whitespace-pre-wrap">{r.body}</p>
              </div>
            ))}
          </section>
        )}
        {staff && t.status !== 'cancelled' ? <StaffControls key={t.updated_at} ticket={t} /> : !staff && <BookingPanel ticket={t} />}
        {user?.role === 'admin' && t.status !== 'cancelled' && <AdminAssignmentControl ticket={t} />}
        {staff && t.appointment_slot && <div className="card"><div className="label">Appointment</div>{formatDateTime(t.appointment_slot)}</div>}
        {!staff && ['pending', 'in_review'].includes(t.status) && (
          <>
            <ErrorNote error={cancel.error} />
            <Button variant="danger" loading={cancel.isPending} onClick={() => { if (confirm('Cancel this ticket?')) cancel.mutate(); }}>Cancel ticket</Button>
          </>
        )}
        {t.attended_by_name && <div className="card text-sm text-ink-secondary">Attended by {t.attended_by_name.trim().split(/\s+/)[0]}</div>}
      </div>
    </>
  );
}

export function StaffQueuePage() {
  const [filter, setFilter] = useState<'open' | 'my' | TicketStatus | 'all'>('open');
  const q = useQuery({
    queryKey: ['tickets', 'staff', filter],
    queryFn: () => api.get<{ tickets: Ticket[] }>(filter === 'my' ? '/tickets?assignedTo=me' : '/tickets'),
    refetchInterval: REFRESH_MS,
  });
  const tickets = (q.data?.tickets ?? []).filter((t) => (filter === 'all' || filter === 'my' ? true : filter === 'open' ? ['pending', 'in_review'].includes(t.status) : t.status === filter));
  const tabs: Array<['open' | 'my' | TicketStatus | 'all', string]> = [['open', 'Open'], ['my', 'My tickets'], ['pending', 'Pending'], ['in_review', 'In review'], ['resolved', 'Resolved'], ['cancelled', 'Cancelled'], ['all', 'All']];
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
