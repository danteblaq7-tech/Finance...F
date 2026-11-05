import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, LineChart, StackedBar } from '@/components/charts';
import { Button, ErrorNote, PageHeader, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import type { DailyStat, StatsOverview } from '@/lib/types';
import { cn, formatKsh } from '@/lib/utils';

const RANGES = [7, 14, 30, 90] as const;
const TEAL = '#2BA8BF';
const ORANGE = '#F59E0B';
const GREEN = '#22C55E';
const RED = '#EF4444';
const PURPLE = '#8B5CF6';

const shortDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });

export function hoursLabel(h: number | null): string {
  if (h === null) return '—';
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} days`;
}

function Kpi({ label, value, hint, tone, to }: { label: string; value: string | number; hint?: string; tone?: 'warn' | 'good'; to?: string }) {
  const body = (
    <div className={cn('card h-full', to && 'transition hover:border-line-active')}>
      <div className="label">{label}</div>
      <div className={cn('font-display text-2xl font-black', tone === 'warn' && 'text-brand-orange', tone === 'good' && 'text-brand-green')}>{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-muted">{hint}</div>}
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <h2 className="text-sm font-bold uppercase tracking-wider">{title}</h2>
      {note && <p className="mb-3 mt-1 text-xs text-ink-muted">{note}</p>}
      <div className={note ? '' : 'mt-3'}>{children}</div>
    </section>
  );
}

function downloadCsv(days: DailyStat[]) {
  const head = ['date', 'active_students', 'tickets_raised', 'tickets_attended', 'tickets_resolved', 'tickets_pending_end_of_day', 'exam_applications', 'cards_issued', 'statements_uploaded'];
  const rows = days.map((d) => [d.day, d.active_students, d.tickets_raised, d.tickets_attended, d.tickets_resolved, d.tickets_pending, d.applications, d.cards_issued, d.statements_uploaded]);
  const blob = new Blob([[head, ...rows].map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `finesse-daily-stats-${days.at(-1)?.day ?? 'export'}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function DashboardPage() {
  const [range, setRange] = useState<(typeof RANGES)[number]>(14);
  // Live: the realtime hook invalidates these on any change; polling is the safety net.
  const overview = useQuery({ queryKey: ['stats', 'overview'], queryFn: () => api.get<StatsOverview>('/stats/overview'), refetchInterval: 30_000 });
  const daily = useQuery({ queryKey: ['stats', 'daily', range], queryFn: () => api.get<{ days: DailyStat[] }>(`/stats/daily?days=${range}`), refetchInterval: 60_000 });

  if (overview.isLoading || daily.isLoading) return <Spinner label="Loading dashboard…" />;
  const err = overview.error ?? daily.error;
  if (err) return <ErrorNote error={err} />;
  const o = overview.data!;
  const days = daily.data!.days;
  const labels = days.map((d) => shortDay(d.day));
  const col = (k: keyof DailyStat) => days.map((d) => Number(d[k]));
  const pctActive = o.people.students_total > 0 ? Math.round((o.people.active_today / o.people.students_total) * 100) : 0;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`Live activity across the finance office. Updated ${new Date(o.generatedAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}.`}
        action={
          <div className="flex gap-1" role="group" aria-label="Time range">
            {RANGES.map((r) => (
              <button key={r} onClick={() => setRange(r)} aria-pressed={range === r} className={cn('rounded-md border px-3 py-1 text-xs font-bold', range === r ? 'border-brand-teal-lt bg-brand-teal/20' : 'border-line text-ink-secondary')}>{r}d</button>
            ))}
          </div>
        }
      />

      <h2 className="label">Students</h2>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Active today" value={o.people.active_today} hint={`${pctActive}% of ${o.people.students_total} students`} />
        <Kpi label="Online now" value={o.people.online_now} hint="seen in the last 5 minutes" tone="good" />
        <Kpi label="Active (7 days)" value={o.people.active_7d} hint={`${o.people.active_30d} in 30 days`} />
        <Kpi label="New sign-ups today" value={o.people.new_students_today} hint={`${o.people.students_total} registered`} />
      </div>

      <h2 className="label">Tickets</h2>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Awaiting attention" value={o.tickets.awaiting_attention} to="/staff/queue" tone={o.tickets.awaiting_attention > 0 ? 'warn' : 'good'} hint={o.tickets.oldest_waiting_hours !== null ? `oldest waiting ${hoursLabel(o.tickets.oldest_waiting_hours)}` : 'nothing waiting'} />
        <Kpi label="Attended today" value={o.tickets.attended_today} hint={`${o.tickets.resolved_today} resolved today`} tone="good" />
        <Kpi label="Raised today" value={o.tickets.raised_today} hint={`${o.tickets.total} all time`} />
        <Kpi label="Avg first response" value={hoursLabel(o.tickets.avg_first_response_hours)} hint="last 30 days" />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Panel title="Active students per day" note="Students who used the web or mobile app that day.">
          <BarChart title="Active students per day" labels={labels} series={[{ name: 'Active students', color: TEAL, values: col('active_students') }]} />
        </Panel>
        <Panel title="Tickets raised vs attended" note="Attended = a staff member picked the ticket up (or it was resolved).">
          <BarChart title="Tickets raised and attended per day" labels={labels} series={[{ name: 'Raised', color: ORANGE, values: col('tickets_raised') }, { name: 'Attended', color: GREEN, values: col('tickets_attended') }]} />
        </Panel>
        <Panel title="Tickets still pending" note="Open tickets nobody had attended yet when each day ended.">
          <LineChart title="Pending tickets at the end of each day" labels={labels} series={[{ name: 'Pending', color: RED, values: col('tickets_pending') }]} />
        </Panel>
        <Panel title="Exam activity per day" note="Card applications, cards issued and fee statements uploaded.">
          <BarChart title="Exam activity per day" labels={labels} series={[{ name: 'Applications', color: TEAL, values: col('applications') }, { name: 'Cards issued', color: GREEN, values: col('cards_issued') }, { name: 'Statements uploaded', color: PURPLE, values: col('statements_uploaded') }]} />
        </Panel>
      </div>

      <h2 className="label">Exams &amp; fees (active exam periods)</h2>
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Panel title="Exam card applications">
          <StackedBar title="Applications by status" segments={[
            { name: 'Awaiting verification', color: ORANGE, value: o.exams.awaiting_verification },
            { name: 'Processing', color: '#EAB308', value: o.exams.pending - o.exams.awaiting_verification },
            { name: 'Approved', color: TEAL, value: o.exams.approved },
            { name: 'Card issued', color: GREEN, value: o.exams.issued },
            { name: 'Not cleared', color: RED, value: o.exams.rejected },
            { name: 'Revoked', color: '#64748B', value: o.exams.revoked },
          ]} />
          <div className="mt-4 flex flex-wrap gap-4 text-xs">
            <Link to="/staff/applications" className="text-brand-teal-lt underline">{o.exams.awaiting_verification} statement(s) awaiting your verification</Link>
            <span className="text-ink-muted">{o.statements.needs_review} upload(s) the system could not read</span>
          </div>
        </Panel>
        <Panel title="Fee collection">
          {o.fees.students === 0 ? <p className="text-ink-muted">No fee records for an active exam period yet. Import them under Fee Records.</p> : (
            <>
              <div className="mb-1 flex items-baseline justify-between"><span className="font-display text-xl font-black">{o.fees.collectionRate ?? 0}%</span><span className="text-xs text-ink-muted">{formatKsh(o.fees.collected)} of {formatKsh(o.fees.billed)}</span></div>
              <div className="h-3 overflow-hidden rounded-full bg-bg-tertiary" role="img" aria-label={`${o.fees.collectionRate ?? 0}% of billed fees collected`}><div className="h-full bg-brand-green" style={{ width: `${Math.min(100, o.fees.collectionRate ?? 0)}%` }} /></div>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                <div><dt className="label">Cleared</dt><dd className="font-bold text-brand-green">{o.fees.cleared}</dd></div>
                <div><dt className="label">Not cleared</dt><dd className="font-bold text-brand-red">{o.fees.not_cleared}</dd></div>
                <div><dt className="label">Outstanding</dt><dd className="font-bold">{formatKsh(o.fees.outstanding)}</dd></div>
              </dl>
            </>
          )}
        </Panel>
      </div>

      <Panel title="Daily figures">
        <div className="mb-3 flex justify-end"><Button variant="secondary" onClick={() => downloadCsv(days)}><Download className="h-4 w-4" /> Export CSV</Button></div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-ink-label"><tr>{['Date', 'Active', 'Raised', 'Attended', 'Resolved', 'Pending', 'Applied', 'Cards', 'Uploads'].map((h) => <th key={h} className="px-2 py-1 font-bold uppercase tracking-wider">{h}</th>)}</tr></thead>
            <tbody>
              {[...days].reverse().map((d) => (
                <tr key={d.day} className="border-t border-line">
                  <td className="px-2 py-1">{shortDay(d.day)}</td><td className="px-2 py-1">{d.active_students}</td><td className="px-2 py-1">{d.tickets_raised}</td><td className="px-2 py-1">{d.tickets_attended}</td>
                  <td className="px-2 py-1">{d.tickets_resolved}</td><td className="px-2 py-1">{d.tickets_pending}</td><td className="px-2 py-1">{d.applications}</td><td className="px-2 py-1">{d.cards_issued}</td><td className="px-2 py-1">{d.statements_uploaded}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
