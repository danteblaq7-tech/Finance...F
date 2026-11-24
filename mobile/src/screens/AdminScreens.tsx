import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { View } from 'react-native';
import { z } from 'zod';
import DateTimePicker from '@react-native-community/datetimepicker';
import { FormDateField, FormSelectField, FormTextField } from '@/components/forms';
import { AppText, Badge, Button, Card, Empty, ErrorNote, Field, Header, Screen, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, formatTime, toDateString } from '@/lib/format';
import type { ExamPeriod, Slot } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { RADIUS, SPACING } from '@/theme/theme';

// Staff screens the web app has and mobile did not: Exam Periods and Appointment Slots (same rules as the web).

const date = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD').refine((value) => {
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}, 'Enter a real calendar date.');
const academicYear = z.string().trim().regex(/^\d{4}\/\d{4}$/, 'Use the format YYYY/YYYY').refine((value) => {
  const [start, end] = value.split('/').map(Number);
  return end === start + 1;
}, 'The end year must be one year after the start year.');
const currentYear = new Date().getFullYear();
const academicYears = Array.from({ length: 11 }, (_, i) => `${currentYear - 5 + i}/${currentYear - 4 + i}`);
const currentAcademicYear = `${currentYear}/${currentYear + 1}`;
const periodSchema = z.object({
  title: z.string().trim().min(3, 'Required').max(150),
  academicYear,
  semester: z.string().trim().min(1, 'Required').max(20),
  applicationOpen: date,
  applicationClose: date,
  examStartDate: date,
  examEndDate: date,
  minPaymentPercent: z.string().regex(/^\d{1,3}$/, 'Enter 1 to 100').refine((v) => Number(v) >= 1 && Number(v) <= 100, 'Enter 1 to 100'),
}).refine((p) => p.applicationClose >= p.applicationOpen, { message: 'Must be on/after the open date', path: ['applicationClose'] })
  .refine((p) => p.examEndDate >= p.examStartDate, { message: 'Must be on/after the start date', path: ['examEndDate'] });
type PeriodValues = z.infer<typeof periodSchema>;
const EMPTY: PeriodValues = { title: '', academicYear: currentAcademicYear, semester: '', applicationOpen: '', applicationClose: '', examStartDate: '', examEndDate: '', minPaymentPercent: '100' };

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
        <FormSelectField control={control} name="academicYear" label="Academic year" options={academicYears.map((year) => ({ label: year, value: year }))} />
        <FormTextField control={control} name="semester" label="Semester" placeholder="Semester 1" />
        <FormDateField control={control} name="applicationOpen" label="Applications open" />
        <FormDateField control={control} name="applicationClose" label="Applications close" />
        <FormDateField control={control} name="examStartDate" label="Exams start" />
        <FormDateField control={control} name="examEndDate" label="Exams end" />
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
  const [time, setTime] = useState('09:00');
  const [now, setNow] = useState(() => new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const valid = date.safeParse(day).success;
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  const maxDay = new Date(now.getTime() + 60 * 86_400_000);
  const selectedDateTime = new Date(year, month - 1, dayOfMonth, Number(time.slice(0, 2)), Number(time.slice(3, 5)));
  const isFuture = valid && selectedDateTime.getTime() > now.getTime();
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const q = useQuery({ queryKey: ['slots', day], enabled: valid, queryFn: () => api.get<{ slots: Slot[] }>(`/slots?date=${day}`), refetchInterval: 15_000 });
  const gen = useMutation({
    mutationFn: () => api.post('/slots/generate', { date: day, startTime: time }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['slots'] }); void qc.invalidateQueries({ queryKey: ['slot-dates'] }); },
  });
  return (
    <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Header title="Appointment Slots" subtitle="Add a future 30-minute in-person slot within the next 60 days for students to choose when raising a ticket." />
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}>
          <Field label="Date">
            <Button title={day} variant="secondary" onPress={() => setShowPicker(true)} />
          </Field>
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Start time (30 minutes)">
            <Button title={time} variant="secondary" onPress={() => setShowTimePicker(true)} />
          </Field>
        </View>
        <Button title="Add slot" loading={gen.isPending} disabled={!isFuture} style={{ marginBottom: valid ? SPACING.md : 40 }} onPress={() => gen.mutate()} />
      </View>
      {showPicker ? <DateTimePicker value={new Date(year, month - 1, dayOfMonth, 12)} minimumDate={now} maximumDate={maxDay} mode="date" onChange={(event, selected) => {
        setShowPicker(false);
        if (event.type === 'set' && selected) setDay(toDateString(selected));
      }} /> : null}
      {showTimePicker ? <DateTimePicker value={selectedDateTime} mode="time" onChange={(event, selected) => {
        setShowTimePicker(false);
        if (event.type === 'set' && selected) {
          setTime(`${String(selected.getHours()).padStart(2, '0')}:${String(selected.getMinutes()).padStart(2, '0')}`);
        }
      }} /> : null}
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
