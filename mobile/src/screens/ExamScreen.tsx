import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { View } from 'react-native';
import { Badge, Button, Card, Empty, ErrorNote, Header, Screen, Spinner, AppText } from '@/components/ui';
import { useAuth } from '@/context/AuthProvider';
import { api } from '@/lib/api';
import { EXAM_STATUS } from '@/lib/constants';
import { cardNumber, formatDate, formatDateTime, formatKsh, toDateString } from '@/lib/format';
import type { Application, ExamPeriod, FeeRecord } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { FONTS, SPACING } from '@/theme/theme';

function CardView({ app }: { app: Application }) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const row = (label: string, value: string) => (
    <View style={{ width: '50%', marginBottom: SPACING.sm + 2 }}>
      <AppText variant="label">{label}</AppText>
      <AppText variant="bold">{value}</AppText>
    </View>
  );
  return (
    <View accessibilityLabel="Examination card" style={{ borderWidth: 2, borderColor: colors.accent_teal_lt, borderRadius: 16, padding: SPACING.md, marginTop: SPACING.md, backgroundColor: colors.bg_tertiary }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.md }}>
        <View>
          <AppText style={{ fontFamily: FONTS.display, fontSize: 20, letterSpacing: 3, color: colors.accent_teal_lt }}>FINESSE</AppText>
          <AppText variant="label">Examination Card</AppText>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <AppText variant="label">Card No.</AppText>
          <AppText variant="bold">{cardNumber(app.id)}</AppText>
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {row('Student', app.student_name)}
        {row('Student ID', app.student_id)}
        {row('Course', app.course ?? user?.course ?? '—')}
        {row('Year', app.year_of_study ?? '—')}
        {row('Semester', `${app.semester}, ${app.academic_year}`)}
        {row('Exam dates', `${formatDate(app.exam_start_date)} – ${formatDate(app.exam_end_date)}`)}
      </View>
      <AppText variant="muted" style={{ fontSize: 11 }}>
        Issued {formatDateTime(app.card_issued_at)}. Show this card, with your student ID, at every examination.
      </AppText>
    </View>
  );
}

function PeriodCard({ period, app, fee }: { period: ExamPeriod; app?: Application; fee?: FeeRecord }) {
  const { colors } = useTheme();
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['applications'] });
  const apply = useMutation({ mutationFn: () => api.post('/applications', { examPeriodId: period.id }), onSuccess: refresh });
  const issue = useMutation({ mutationFn: () => api.post(`/applications/${app!.id}/issue`), onSuccess: refresh });
  const today = toDateString(new Date());
  const open = today >= period.application_open.slice(0, 10) && today <= period.application_close.slice(0, 10);
  const canApply = open && (!app || app.status === 'rejected');
  const st = app ? EXAM_STATUS[app.status] : null;

  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <AppText variant="heading">{period.title}</AppText>
          <AppText variant="muted">{period.semester}, {period.academic_year}</AppText>
        </View>
        {st ? <Badge color={st.color}>{st.label}</Badge> : null}
      </View>
      <AppText variant="muted" style={{ marginVertical: SPACING.sm, fontSize: 11 }}>
        Applications {formatDate(period.application_open)} – {formatDate(period.application_close)}{'\n'}
        Exams {formatDate(period.exam_start_date)} – {formatDate(period.exam_end_date)}
      </AppText>
      {fee ? (
        <View style={{ flexDirection: 'row', backgroundColor: colors.bg_tertiary, borderRadius: 12, padding: SPACING.sm + 4, marginBottom: SPACING.md }}>
          {([['Total', formatKsh(fee.total_fee), colors.text_primary], ['Paid', formatKsh(fee.amount_paid), colors.text_primary], ['Balance', formatKsh(fee.balance), fee.balance > 0 ? colors.accent_red : colors.accent_green]] as const).map(([l, v, c]) => (
            <View key={l} style={{ flex: 1, alignItems: 'center' }}>
              <AppText variant="label">{l}</AppText>
              <AppText variant="bold" style={{ color: c, fontSize: 12 }}>{v}</AppText>
            </View>
          ))}
        </View>
      ) : null}
      {app?.status === 'rejected' ? (
        <View style={{ borderColor: `${colors.accent_red}66`, backgroundColor: `${colors.accent_red}1A`, borderWidth: 1, borderRadius: 12, padding: SPACING.sm + 4, marginBottom: SPACING.md }}>
          <AppText style={{ color: colors.accent_red }}>{app.rejection_reason}</AppText>
        </View>
      ) : null}
      {app?.manual_approval_note ? <AppText variant="muted" style={{ marginBottom: SPACING.sm }}>Finance office note: {app.manual_approval_note}</AppText> : null}
      <ErrorNote error={apply.error ?? issue.error} />
      {canApply ? <Button title={app ? 'Re-apply' : 'Apply for exam card'} loading={apply.isPending} onPress={() => apply.mutate()} /> : null}
      {!open && !app ? <AppText variant="muted">Applications are not open right now.</AppText> : null}
      {app?.status === 'approved' ? <Button title="Generate & email my card" loading={issue.isPending} onPress={() => issue.mutate()} /> : null}
      {app?.status === 'issued' ? <CardView app={app} /> : null}
    </Card>
  );
}

export function ExamScreen() {
  const periods = useQuery({ queryKey: ['periods'], queryFn: () => api.get<{ periods: ExamPeriod[] }>('/exam-periods') });
  const apps = useQuery({ queryKey: ['applications'], queryFn: () => api.get<{ applications: Application[] }>('/applications') });
  const fees = useQuery({ queryKey: ['fees', 'mine'], queryFn: () => api.get<{ feeRecords: FeeRecord[] }>('/fee-records/mine') });
  const refetch = () => void Promise.all([periods.refetch(), apps.refetch(), fees.refetch()]);
  const active = periods.data?.periods.filter((p) => p.is_active) ?? [];

  return (
    <Screen onRefresh={refetch} refreshing={periods.isRefetching || apps.isRefetching}>
      <Header title="Exam Card" subtitle="Apply for your card. Your fee record decides the outcome automatically." />
      {periods.isLoading || apps.isLoading ? <Spinner /> : periods.error || apps.error ? <ErrorNote error={periods.error ?? apps.error} /> : active.length === 0 ? (
        <Empty>There is no exam period open for applications.</Empty>
      ) : (
        <View style={{ gap: SPACING.md }}>
          {active.map((p) => (
            <PeriodCard key={p.id} period={p} app={apps.data?.applications.find((a) => a.exam_period_id === p.id)}
              fee={fees.data?.feeRecords.find((f) => f.academic_year === p.academic_year && f.semester === p.semester)} />
          ))}
        </View>
      )}
    </Screen>
  );
}
