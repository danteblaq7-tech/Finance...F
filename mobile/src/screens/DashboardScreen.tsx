import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { AppText, Card, ChipGroup, ErrorNote, Header, Screen, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { formatKsh } from '@/lib/format';
import type { DailyStat, StatsOverview } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { SPACING } from '@/theme/theme';

type Range = '7' | '14' | '30';

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });

export function hoursLabel(h: number | null): string {
  if (h === null) return '—';
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} days`;
}

function Kpi({ label, value, hint, color }: { label: string; value: string | number; hint?: string; color?: string }) {
  return (
    <Card style={{ flexBasis: '47%', flexGrow: 1 }}>
      <AppText variant="label">{label}</AppText>
      <AppText variant="heading" style={color ? { color } : undefined}>{value}</AppText>
      {hint ? <AppText variant="muted" style={{ fontSize: 11 }}>{hint}</AppText> : null}
    </Card>
  );
}

/** One horizontal bar per day: easy to read on a phone, no chart library needed. */
function DayBars({ title, days, pick, color, color2, pick2, legend }: {
  title: string; days: DailyStat[]; pick: (d: DailyStat) => number; color: string; pick2?: (d: DailyStat) => number; color2?: string; legend?: [string, string];
}) {
  const { colors } = useTheme();
  const max = Math.max(1, ...days.flatMap((d) => [pick(d), pick2 ? pick2(d) : 0]));
  return (
    <Card>
      <AppText variant="bold" style={{ marginBottom: SPACING.sm }}>{title}</AppText>
      {legend ? (
        <View style={{ flexDirection: 'row', gap: 12, marginBottom: SPACING.sm }}>
          <AppText variant="muted" style={{ fontSize: 11, color }}>■ {legend[0]}</AppText>
          <AppText variant="muted" style={{ fontSize: 11, color: color2 }}>■ {legend[1]}</AppText>
        </View>
      ) : null}
      {[...days].reverse().map((d) => (
        <View key={d.day} accessibilityLabel={`${dayLabel(d.day)}: ${pick(d)}${pick2 ? ` and ${pick2(d)}` : ''}`} style={{ marginBottom: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <AppText variant="muted" style={{ width: 52, fontSize: 11 }}>{dayLabel(d.day)}</AppText>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: color, width: `${Math.max((pick(d) / max) * 100, pick(d) > 0 ? 2 : 0)}%` }} />
              {pick2 && color2 ? <View style={{ height: 8, borderRadius: 4, backgroundColor: color2, width: `${Math.max((pick2(d) / max) * 100, pick2(d) > 0 ? 2 : 0)}%` }} /> : null}
            </View>
            <AppText style={{ width: pick2 ? 52 : 28, fontSize: 11, textAlign: 'right', color: colors.text_secondary }}>{pick(d)}{pick2 ? ` / ${pick2(d)}` : ''}</AppText>
          </View>
        </View>
      ))}
    </Card>
  );
}

export function DashboardScreen() {
  const { colors } = useTheme();
  const [range, setRange] = useState<Range>('7');
  const overview = useQuery({ queryKey: ['stats', 'overview'], queryFn: () => api.get<StatsOverview>('/stats/overview'), refetchInterval: 30_000 });
  const daily = useQuery({ queryKey: ['stats', 'daily', range], queryFn: () => api.get<{ days: DailyStat[] }>(`/stats/daily?days=${range}`), refetchInterval: 60_000 });
  const refetch = () => void Promise.all([overview.refetch(), daily.refetch()]);
  const o = overview.data;
  const days = daily.data?.days ?? [];

  return (
    <Screen onRefresh={refetch} refreshing={overview.isRefetching || daily.isRefetching}>
      <Header title="Dashboard" subtitle="Live activity across the finance office." />
      {overview.isLoading || daily.isLoading ? <Spinner /> : overview.error || daily.error ? <ErrorNote error={overview.error ?? daily.error} /> : o ? (
        <View style={{ gap: SPACING.md }}>
          <AppText variant="label">Students</AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm }}>
            <Kpi label="Active today" value={o.people.active_today} hint={`of ${o.people.students_total} students`} />
            <Kpi label="Online now" value={o.people.online_now} hint="last 5 minutes" color={colors.accent_green} />
            <Kpi label="Active (7 days)" value={o.people.active_7d} hint={`${o.people.active_30d} in 30 days`} />
            <Kpi label="New today" value={o.people.new_students_today} />
          </View>

          <AppText variant="label">Tickets</AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm }}>
            <Kpi label="Awaiting attention" value={o.tickets.awaiting_attention} color={o.tickets.awaiting_attention > 0 ? colors.accent_orange : colors.accent_green}
              hint={o.tickets.oldest_waiting_hours !== null ? `oldest ${hoursLabel(o.tickets.oldest_waiting_hours)}` : 'nothing waiting'} />
            <Kpi label="Attended today" value={o.tickets.attended_today} hint={`${o.tickets.resolved_today} resolved`} color={colors.accent_green} />
            <Kpi label="Raised today" value={o.tickets.raised_today} />
            <Kpi label="Avg first response" value={hoursLabel(o.tickets.avg_first_response_hours)} hint="last 30 days" />
          </View>

          <AppText variant="label">Exam cards &amp; fees</AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm }}>
            <Kpi label="Needs verification" value={o.exams.awaiting_verification} color={o.exams.awaiting_verification > 0 ? colors.accent_orange : undefined} hint="uploaded statements" />
            <Kpi label="Cards issued" value={o.exams.issued} hint={`${o.exams.issued_today} today`} color={colors.accent_green} />
            <Kpi label="Not cleared" value={o.exams.rejected} />
            <Kpi label="Fees collected" value={o.fees.collectionRate === null ? '—' : `${o.fees.collectionRate}%`} hint={o.fees.students ? `${formatKsh(o.fees.outstanding)} outstanding` : 'no fee records yet'} />
          </View>

          <ChipGroup<Range> options={[{ label: '7 days', value: '7' }, { label: '14 days', value: '14' }, { label: '30 days', value: '30' }]} value={range} onChange={setRange} />
          <DayBars title="Active students per day" days={days} pick={(d) => d.active_students} color={colors.accent_teal_lt} />
          <DayBars title="Tickets per day" days={days} pick={(d) => d.tickets_raised} color={colors.accent_orange} pick2={(d) => d.tickets_attended} color2={colors.accent_green} legend={['Raised', 'Attended']} />
          <DayBars title="Pending tickets at end of day" days={days} pick={(d) => d.tickets_pending} color={colors.accent_red} />
        </View>
      ) : null}
    </Screen>
  );
}
