import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { View } from 'react-native';
import { z } from 'zod';
import { FormTextField } from '@/components/forms';
import { AppText, Badge, Button, Card, Empty, ErrorNote, Header, Screen, Spinner, TextField } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, formatTime, toDateString } from '@/lib/format';
import type { ExamPeriod, Slot } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { RADIUS, SPACING } from '@/theme/theme';

// Staff screens the web app has and mobile did not: Exam Periods and Appointment Slots (same rules as the web).

const date = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format 2026-11-23');
const periodSchema = z.object({
  title: z.string().trim().min(3, 'Required'),
  academicYear: z.string().trim().regex(/^\d{4}\/\d{4}$/, 'Use the format 2026/2027'),
  semester: z.string().trim().min(1, 'Required'),
  applicationOpen: date,
  applicationClose: date,
  examStartDate: date,
  examEndDate: date,
  minPaymentPercent: z.string().regex(/^\d{1,3}$/, 'Enter 1 to 100').refine((v) => Number(v) >= 1 && Number(v) <= 100, 'Enter 1 to 100'),
}).refine((p) => p.applicationClose >= p.applicationOpen, { message: 'Must be on/after the open date', path: ['applicationClose'] })
  .refine((p) => p.examEndDate >= p.examStartDate, { message: 'Must be on/after the start date', path: ['examEndDate'] });
type PeriodValues = z.infer<typeof periodSchema>;
const EMPTY: PeriodValues = { title: '', academicYear: '', semester: '', applicationOpen: '', applicationClose: '', examStartDate: '', examEndDate: '', minPaymentPercent: '100' };

export function PeriodsScreen() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['periods'], queryFn: () => api.get<{ periods: ExamPeriod[] }>('/exam-periods') });
  const { control, handleSubmit, reset } = useForm<PeriodValues>({ resolver: zodResolver(periodSchema), defaultValues: EMPTY });
  const create = useMutation({
    mutationFn: (v: PeriodValues) => api.post('/exam-periods', { ...v, minPaymentPercent: Number(v.minPaymentPercent), isActive: true }),
    onSuccess: () => { reset(EMPTY); void qc.invalidateQueries({ queryKey: ['periods'] }); },
  });
  const toggle = useMutation({
    mutationFn: (p: ExamPeriod) => api.patch(`/exam-periods/${p.id}`, { isActive: !p.is_active }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['periods'] }),
  });
  return (
    <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Header title="Exam Periods" subtitle="Windows in which students can apply for an exam card." />
      <Card style={{ marginBottom: SPACING.lg }}>
        <AppText variant="label" style={{ marginBottom: SPACING.md }}>New exam period</AppText>
        <FormTextField control={control} name="title" label="Title" />
        <FormTextField control={control} name="academicYear" label="Academic year" placeholder="2026/2027" autoCapitalize="none" />
        <FormTextField control={control} name="semester" label="Semester" placeholder="Semester 1" />
        <FormTextField control={control} name="applicationOpen" label="Applications open" placeholder="YYYY-MM-DD" autoCapitalize="none" />
        <FormTextField control={control} name="applicationClose" label="Applications close" placeholder="YYYY-MM-DD" autoCapitalize="none" />
        <FormTextField control={control} name="examStartDate" label="Exams start" placeholder="YYYY-MM-DD" autoCapitalize="none" />
        <FormTextField control={control} name="examEndDate" label="Exams end" placeholder="YYYY-MM-DD" autoCapitalize="none" />
        <FormTextField control={control} name="minPaymentPercent" label="Minimum fees paid (%)" hint="100 = fully cleared. 70 = students who paid at least 70% are cleared." keyboardType="number-pad" />
        <ErrorNote error={create.error} />
        <Button title="Create period" loading={create.isPending} onPress={() => void handleSubmit((v) => create.mutate(v))()} />
      </Card>

      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} /> : (
        <View style={{ gap: SPACING.sm + 4 }}>
          {q.data!.periods.map((p) => (
            <Card key={p.id} accessibilityLabel={p.title}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <AppText variant="bold">{p.title}</AppText>
                <Badge color={p.is_active ? 'accent_green' : 'text_muted'}>{p.is_active ? 'ACTIVE' : 'INACTIVE'}</Badge>
              </View>
              <AppText variant="muted" style={{ marginVertical: 6 }}>
                {p.semester}, {p.academic_year} · apply {formatDate(p.application_open)} – {formatDate(p.application_close)} · exams {formatDate(p.exam_start_date)} – {formatDate(p.exam_end_date)} · clears at {p.min_payment_percent}% paid
              </AppText>
              <Button title={p.is_active ? 'Deactivate' : 'Activate'} variant="secondary" size="sm" style={{ alignSelf: 'flex-start' }} loading={toggle.isPending && toggle.variables?.id === p.id} onPress={() => toggle.mutate(p)} />
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}

export function SlotsScreen() {
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [day, setDay] = useState(() => toDateString(new Date(Date.now() + 86_400_000)));
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(day);
  const q = useQuery({ queryKey: ['slots', day], enabled: valid, queryFn: () => api.get<{ slots: Slot[] }>(`/slots?date=${day}`), refetchInterval: 15_000 });
  const gen = useMutation({
    mutationFn: () => api.post('/slots/generate', { date: day }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['slots'] }); void qc.invalidateQueries({ queryKey: ['slot-dates'] }); },
  });
  return (
    <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Header title="Appointment Slots" subtitle="30-minute slots, 08:00–17:00. Generating a date that already has slots does nothing." />
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}>
          <TextField label="Date" value={day} onChangeText={setDay} placeholder="YYYY-MM-DD" autoCapitalize="none" error={valid ? undefined : 'Use the format 2026-11-23'} />
        </View>
        <Button title="Generate slots" loading={gen.isPending} disabled={!valid} style={{ marginBottom: valid ? SPACING.md : 40 }} onPress={() => gen.mutate()} />
      </View>
      <ErrorNote error={gen.error} />
      {!valid ? null : q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} /> : q.data!.slots.length === 0 ? <Empty>No slots for this date yet.</Empty> : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {q.data!.slots.map((s) => (
            <View
              key={s.id}
              accessibilityLabel={`${formatTime(s.start_time)}, ${s.is_booked ? 'booked' : 'free'}`}
              style={{ width: '31%', borderWidth: 1, borderRadius: RADIUS.md, padding: 10, borderColor: s.is_booked ? `${colors.accent_orange}80` : colors.border, backgroundColor: s.is_booked ? `${colors.accent_orange}1A` : 'transparent' }}
            >
              <AppText variant="bold" style={{ fontSize: 13 }}>{formatTime(s.start_time)}</AppText>
              <AppText variant="muted" style={{ fontSize: 11 }} numberOfLines={1}>{s.is_booked ? `Booked: ${s.booked_by_name ?? 'student'}` : 'Free'}</AppText>
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}
