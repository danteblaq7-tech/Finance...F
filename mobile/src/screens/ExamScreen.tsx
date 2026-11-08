import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { Badge, Button, Card, Empty, ErrorNote, Header, Screen, Spinner, AppText } from '@/components/ui';
import { UnitChecklist } from '@/components/UnitChecklist';
import { useAuth } from '@/context/AuthProvider';
import { api } from '@/lib/api';
import { EXAM_STATUS } from '@/lib/constants';
import { cardNumber, formatDate, formatDateTime, formatKsh, toDateString } from '@/lib/format';
import type { Application, ExamPeriod, FeeRecord, FeeStatement, MyUnit } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { FONTS, SPACING } from '@/theme/theme';

const MAX_MB = 5;

/** Approved from an uploaded statement that nobody at the finance office has verified yet. */
const isProvisional = (a: Application) => a.decision_source === 'statement' && !a.manually_approved_by;

function CardView({ app }: { app: Application }) {
  const { colors } = useTheme();
  const { user } = useAuth();
  // The student's units, ticked off live as lecturers sign them (lib/realtime.ts), with polling as a safety net.
  const myUnits = useQuery({
    queryKey: ['my-units', app.exam_period_id],
    queryFn: () => api.get<{ units?: MyUnit[] }>(`/exam-units/mine?periodId=${app.exam_period_id}`),
    retry: false,
    refetchInterval: 15_000,
  });
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
      {isProvisional(app) ? (
        <AppText style={{ color: colors.accent_amber, textAlign: 'center', marginBottom: SPACING.sm, fontSize: 11 }}>PROVISIONAL: subject to verification by the finance office</AppText>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {row('Student', app.student_name)}
        {row('Student ID', app.student_id)}
        {row('Course', app.course ?? user?.course ?? '—')}
        {row('Year', app.year_of_study ?? '—')}
        {row('Semester', `${app.semester}, ${app.academic_year}`)}
        {row('Exam dates', `${formatDate(app.exam_start_date)} – ${formatDate(app.exam_end_date)}`)}
      </View>
      {app.verification_code ? (
        <View style={{ alignItems: 'center', marginBottom: SPACING.sm }}>
          <AppText variant="label">Verification code</AppText>
          <AppText selectable style={{ fontFamily: FONTS.display, fontSize: 18, letterSpacing: 3 }}>{app.verification_code}</AppText>
        </View>
      ) : null}
      {Array.isArray(myUnits.data?.units) ? <UnitChecklist units={myUnits.data.units} /> : null}
      <AppText variant="muted" style={{ fontSize: 11 }}>
        Issued {formatDateTime(app.card_issued_at)}. Show this card, with your student ID, at every examination. Invigilators can confirm it with the verification code.
      </AppText>
    </View>
  );
}

/** Pick your fee statement; the figures on it decide the outcome (or send it to the finance office). */
function StatementUpload({ period, replacing }: { period: ExamPeriod; replacing: boolean }) {
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [localError, setLocalError] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: (file: { uri: string; name: string; mimeType?: string | null }) =>
      api.upload<{ application: Application; statement: FeeStatement }>(`/fee-statements?examPeriodId=${period.id}`, file),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['applications'] });
      void qc.invalidateQueries({ queryKey: ['statements'] });
    },
  });

  const choose = async () => {
    setLocalError(null);
    // Loaded on demand: the native picker module is only needed on this button press.
    const DocumentPicker = await import('expo-document-picker');
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'text/csv', 'text/plain', 'image/png', 'image/jpeg'],
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const file = result.assets[0];
    if (!file) return;
    if (file.size !== undefined && file.size > MAX_MB * 1024 * 1024) return setLocalError(`That file is larger than ${MAX_MB} MB.`);
    if (file.size === 0) return setLocalError('That file is empty.');
    upload.mutate({ uri: file.uri, name: file.name, mimeType: file.mimeType });
  };

  return (
    <View style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: 12, padding: SPACING.sm + 4, marginTop: SPACING.sm, gap: SPACING.sm }}>
      <AppText variant="bold">{replacing ? 'Upload a newer fee statement' : 'Upload your fee statement'}</AppText>
      <AppText variant="muted" style={{ fontSize: 11 }}>
        A PDF or CSV from your student portal works best (a clear photo is checked by a person). It must show your student ID. The figures on it decide your exam card.
      </AppText>
      <Button title={upload.isPending ? 'Reading your statement…' : 'Choose statement file'} variant="secondary" loading={upload.isPending} onPress={() => void choose().catch((e: unknown) => setLocalError(e instanceof Error ? e.message : 'Could not open the file picker.'))} />
      {localError ? <View accessibilityRole="alert"><AppText style={{ color: colors.accent_red }}>{localError}</AppText></View> : null}
      <ErrorNote error={upload.error} />
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
  const awaitingReview = app?.status === 'pending' && app.decision_source === 'statement';
  const canRetry = open && (!app || app.status === 'rejected' || awaitingReview);
  const st = app ? EXAM_STATUS[app.status] : null;
  const fromStatement = Boolean(app?.statement_id) && app?.decision_source !== 'fee_record';

  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <AppText variant="heading">{period.title}</AppText>
          <AppText variant="muted">{period.semester}, {period.academic_year}</AppText>
        </View>
        {app?.revoked_at ? <Badge color="text_muted">REVOKED</Badge> : awaitingReview ? <Badge color="accent_amber">AWAITING VERIFICATION</Badge> : st ? <Badge color={st.color}>{st.label}</Badge> : null}
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
      {!fee && app && fromStatement ? (
        <View style={{ backgroundColor: colors.bg_tertiary, borderRadius: 12, padding: SPACING.sm + 4, marginBottom: SPACING.md }}>
          <AppText variant="label" style={{ textAlign: 'center', marginBottom: 4 }}>Read from your uploaded statement</AppText>
          <View style={{ flexDirection: 'row' }}>
            {([['Total', formatKsh(app.total_fee), colors.text_primary], ['Paid', formatKsh(app.amount_paid), colors.text_primary], ['Balance', formatKsh(app.balance), app.balance > 0 ? colors.accent_red : colors.accent_green]] as const).map(([l, v, c]) => (
              <View key={l} style={{ flex: 1, alignItems: 'center' }}>
                <AppText variant="label">{l}</AppText>
                <AppText variant="bold" style={{ color: c, fontSize: 12 }}>{v}</AppText>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      {app?.status === 'rejected' ? (
        <View style={{ borderColor: `${colors.accent_red}66`, backgroundColor: `${colors.accent_red}1A`, borderWidth: 1, borderRadius: 12, padding: SPACING.sm + 4, marginBottom: SPACING.md }}>
          <AppText style={{ color: colors.accent_red }}>{app.rejection_reason}</AppText>
        </View>
      ) : null}
      {app?.status_note && app.status !== 'rejected' ? (
        <View style={{ borderColor: `${colors.accent_amber}66`, backgroundColor: `${colors.accent_amber}1A`, borderWidth: 1, borderRadius: 12, padding: SPACING.sm + 4, marginBottom: SPACING.md }}>
          <AppText>{app.status_note}</AppText>
        </View>
      ) : null}
      {app?.revoked_at ? (
        <View style={{ borderColor: `${colors.accent_red}66`, backgroundColor: `${colors.accent_red}1A`, borderWidth: 1, borderRadius: 12, padding: SPACING.sm + 4, marginBottom: SPACING.md }}>
          <AppText style={{ color: colors.accent_red }}>This card was revoked on {formatDate(app.revoked_at)}. Please visit the finance office.</AppText>
        </View>
      ) : null}
      {app?.manual_approval_note ? <AppText variant="muted" style={{ marginBottom: SPACING.sm }}>Finance office note: {app.manual_approval_note}</AppText> : null}
      <ErrorNote error={apply.error ?? issue.error} />
      {fee && canRetry ? <Button title={app ? 'Re-apply' : 'Apply for exam card'} loading={apply.isPending} onPress={() => apply.mutate()} /> : null}
      {!open && !app ? <AppText variant="muted">Applications are not open right now.</AppText> : null}
      {app?.status === 'approved' && !app.revoked_at ? <Button title="Generate & email my card" loading={issue.isPending} onPress={() => issue.mutate()} /> : null}
      {canRetry && (!fee || app) ? <StatementUpload period={period} replacing={Boolean(app)} /> : null}
      {app?.status === 'issued' && !app.revoked_at ? <CardView app={app} /> : null}
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
      <Header title="Exam Card" subtitle="Upload your fee statement. If your fees are cleared you get your exam card." />
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
