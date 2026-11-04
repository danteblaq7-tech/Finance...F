import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { z } from 'zod';
import { FormTextField } from '@/components/forms';
import { ListScreen } from '@/components/ListScreen';
import { AppText, Badge, Button, Card, ChipGroup, ErrorNote, Field, Header, Screen, Spinner, TextField } from '@/components/ui';
import { useAuth } from '@/context/AuthProvider';
import { api } from '@/lib/api';
import { ISSUE_LABELS, ISSUE_TYPES, TICKET_STATUS } from '@/lib/constants';
import { formatDateTime, formatDay, formatTime } from '@/lib/format';
import type { Slot, SlotDate, Ticket, TicketPriority, TicketStatus } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { FONTS, RADIUS, SPACING } from '@/theme/theme';

const REFRESH_MS = 15_000; // poll so staff updates show up without leaving the screen
const invalidate = (qc: ReturnType<typeof useQueryClient>, keys: string[]) => keys.forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));

function TicketRow({ t, staff, onPress }: { t: Ticket; staff?: boolean; onPress: () => void }) {
  const s = TICKET_STATUS[t.status];
  return (
    <Card onPress={onPress}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <AppText variant="bold">{ISSUE_LABELS[t.issue_type] ?? t.issue_type}</AppText>
        <Badge color={s.color}>{s.label}</Badge>
        {t.priority === 'high' ? <Badge color="#EF4444">HIGH</Badge> : null}
      </View>
      <AppText variant="muted" numberOfLines={2} style={{ marginTop: 6 }}>{t.description}</AppText>
      <AppText variant="muted" style={{ marginTop: 6, fontSize: 11 }}>
        {staff ? `${t.student_name} · ${t.student_number ?? ''} · ` : ''}
        {formatDateTime(t.created_at)}
        {t.appointment_slot ? `  ·  📅 ${formatDateTime(t.appointment_slot)}` : ''}
      </AppText>
    </Card>
  );
}

// ── Student: my tickets ──────────────────────────────────────

export function MyTicketsScreen() {
  const router = useRouter();
  const q = useQuery({ queryKey: ['tickets'], queryFn: () => api.get<{ tickets: Ticket[] }>('/tickets'), refetchInterval: REFRESH_MS });
  return (
    <ListScreen
      header={<Header title="My Tickets" subtitle="Your finance support requests" right={<Button title="New" onPress={() => router.push('/tickets/new')} />} />}
      data={q.data?.tickets}
      keyExtractor={(t) => t.id}
      renderItem={(t) => <TicketRow t={t} onPress={() => router.push(`/tickets/${t.id}`)} />}
      loading={q.isLoading}
      error={q.error}
      emptyText="No tickets yet. Tap New if you need help from the finance office."
      refreshing={q.isRefetching}
      onRefresh={() => void q.refetch()}
    />
  );
}

// ── Student: raise a ticket ──────────────────────────────────

const newTicketSchema = z.object({
  description: z.string().trim().min(10, 'Please describe the issue (at least 10 characters)').max(4000),
});

export function NewTicketScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const [issueType, setIssueType] = useState<string>('');
  const [priority, setPriority] = useState<TicketPriority>('medium');
  const [typeError, setTypeError] = useState<string>();
  const { control, handleSubmit } = useForm<{ description: string }>({ resolver: zodResolver(newTicketSchema), defaultValues: { description: '' } });

  const create = useMutation({
    mutationFn: (v: { issueType: string; priority: TicketPriority; description: string }) => api.post<{ ticket: Ticket }>('/tickets', v),
    onSuccess: (r) => {
      invalidate(qc, ['tickets']);
      router.replace(`/tickets/${r.ticket.id}`);
    },
  });

  // Check the issue type up front so BOTH errors show at once (handleSubmit stops at the description otherwise).
  const submit = () => {
    setTypeError(issueType ? undefined : 'Choose an issue type');
    void handleSubmit((v) => {
      if (!issueType) return;
      create.mutate({ issueType, priority, description: v.description });
    })();
  };

  return (
    <Screen edges={[]}>
      <Card>
        <Field label="Issue type" error={typeError}>
          <ChipGroup options={ISSUE_TYPES.map((t) => ({ label: t.label, value: t.value as string }))} value={issueType} onChange={(v) => { setIssueType(v); setTypeError(undefined); }} />
        </Field>
        <Field label="Priority">
          <ChipGroup<TicketPriority> options={[{ label: 'Low', value: 'low' }, { label: 'Medium', value: 'medium' }, { label: 'High', value: 'high' }]} value={priority} onChange={setPriority} />
        </Field>
        <FormTextField control={control} name="description" label="Description" multiline numberOfLines={6} placeholder="What do you need help with?" />
        <ErrorNote error={create.error} />
        <Button title="Submit ticket" loading={create.isPending} onPress={submit} />
      </Card>
    </Screen>
  );
}

// ── Appointment booking (students) ───────────────────────────

function BookingPanel({ ticket }: { ticket: Ticket }) {
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [date, setDate] = useState<string | null>(null);
  const dates = useQuery({ queryKey: ['slot-dates'], queryFn: () => api.get<{ dates: SlotDate[] }>('/slots/dates?days=14'), refetchInterval: REFRESH_MS });
  const active = date ?? dates.data?.dates.find((d) => d.free > 0)?.date ?? null;
  const slots = useQuery({
    queryKey: ['slots', active], enabled: !!active, refetchInterval: REFRESH_MS,
    queryFn: () => api.get<{ slots: Slot[] }>(`/slots?date=${active}`),
  });
  const refresh = () => invalidate(qc, ['ticket', 'tickets', 'slots', 'slot-dates']);
  const book = useMutation({ mutationFn: (slotId: string) => api.post(`/tickets/${ticket.id}/book`, { slotId }), onSuccess: refresh, onError: refresh });
  const cancel = useMutation({ mutationFn: () => api.del(`/tickets/${ticket.id}/booking`), onSuccess: refresh });

  if (ticket.appointment_slot) {
    return (
      <Card>
        <AppText variant="label">Appointment</AppText>
        <AppText variant="heading" style={{ marginVertical: 6 }}>{formatDateTime(ticket.appointment_slot)}</AppText>
        <ErrorNote error={cancel.error} />
        {['pending', 'in_review'].includes(ticket.status) ? <Button title="Cancel appointment" variant="secondary" loading={cancel.isPending} onPress={() => cancel.mutate()} /> : null}
      </Card>
    );
  }
  if (!['pending', 'in_review'].includes(ticket.status)) return null;

  return (
    <Card>
      <AppText variant="label" style={{ marginBottom: SPACING.sm }}>Book an in-person appointment (optional)</AppText>
      {dates.isLoading ? <Spinner /> : !dates.data?.dates.length ? (
        <AppText variant="muted">No appointment slots are available yet.</AppText>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: SPACING.sm }}>
            {dates.data.dates.map((d) => {
              const on = d.date === active;
              return (
                <Pressable key={d.date} disabled={d.free === 0} onPress={() => setDate(d.date)} accessibilityRole="button" accessibilityState={{ selected: on, disabled: d.free === 0 }}
                  style={{ borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 8, opacity: d.free === 0 ? 0.35 : 1, borderColor: on ? colors.border_active : colors.border, backgroundColor: on ? `${colors.accent_teal}33` : colors.bg_tertiary }}>
                  <Text style={{ color: on ? colors.accent_teal_lt : colors.text_primary, fontFamily: FONTS.bold, fontSize: 12 }}>{formatDay(d.date)}</Text>
                  <Text style={{ color: colors.text_muted, fontFamily: FONTS.body, fontSize: 10 }}>{d.free} free</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: SPACING.sm }}>
            {slots.data?.slots.map((s) => (
              <Pressable key={s.id} disabled={s.is_booked || book.isPending} accessibilityRole="button" accessibilityLabel={`Book ${formatTime(s.start_time)}`}
                onPress={() => Alert.alert('Book appointment', `${formatDay(s.start_time)} at ${formatTime(s.start_time)}?`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Book', onPress: () => book.mutate(s.id) }])}
                style={{ borderWidth: 1, borderColor: colors.border, borderRadius: RADIUS.sm, paddingHorizontal: 10, paddingVertical: 8, opacity: s.is_booked ? 0.3 : 1, backgroundColor: colors.bg_tertiary }}>
                <Text style={{ color: colors.text_primary, fontFamily: FONTS.body, fontSize: 12, textDecorationLine: s.is_booked ? 'line-through' : 'none' }}>{formatTime(s.start_time)}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
      <View style={{ marginTop: SPACING.md }}><ErrorNote error={book.error} /></View>
    </Card>
  );
}

// ── Staff controls ───────────────────────────────────────────

function StaffControls({ ticket }: { ticket: Ticket }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const [priority, setPriority] = useState<TicketPriority>(ticket.priority);
  const [notes, setNotes] = useState(ticket.staff_notes);
  const save = useMutation({
    mutationFn: () => api.patch(`/tickets/${ticket.id}`, { status, priority, staffNotes: notes }),
    onSuccess: () => invalidate(qc, ['ticket', 'tickets']),
  });
  return (
    <Card>
      <AppText variant="label" style={{ marginBottom: SPACING.sm }}>Staff controls</AppText>
      <Field label="Status">
        <ChipGroup<TicketStatus> options={(Object.keys(TICKET_STATUS) as TicketStatus[]).map((v) => ({ label: TICKET_STATUS[v].label, value: v }))} value={status} onChange={setStatus} />
      </Field>
      <Field label="Priority">
        <ChipGroup<TicketPriority> options={[{ label: 'Low', value: 'low' }, { label: 'Medium', value: 'medium' }, { label: 'High', value: 'high' }]} value={priority} onChange={setPriority} />
      </Field>
      <TextField label="Notes to student" hint="Shown to the student on their ticket." value={notes} onChangeText={setNotes} multiline />
      <ErrorNote error={save.error} />
      <Button title={save.isSuccess ? 'Saved ✓' : 'Save changes'} loading={save.isPending} onPress={() => save.mutate()} />
    </Card>
  );
}

// ── Ticket detail (students and staff) ───────────────────────

export function TicketDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();
  const staff = user?.role !== 'student';
  const q = useQuery({ queryKey: ['ticket', id], queryFn: () => api.get<{ ticket: Ticket }>(`/tickets/${id}`), refetchInterval: REFRESH_MS, enabled: !!id });
  const cancel = useMutation({
    mutationFn: () => api.patch(`/tickets/${id}`, { status: 'cancelled' }),
    onSuccess: () => invalidate(qc, ['ticket', 'tickets', 'slots', 'slot-dates']),
  });

  if (q.isLoading) return <Screen edges={[]}><Spinner /></Screen>;
  if (q.error) return <Screen edges={[]}><ErrorNote error={q.error} /></Screen>;
  const t = q.data!.ticket;
  const s = TICKET_STATUS[t.status];

  return (
    <Screen edges={[]} onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <View style={{ gap: SPACING.md }}>
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <AppText variant="heading">{ISSUE_LABELS[t.issue_type] ?? t.issue_type}</AppText>
            <Badge color={s.color}>{s.label}</Badge>
          </View>
          <AppText variant="muted" style={{ marginTop: 4 }}>{t.student_name}{t.student_number ? ` · ${t.student_number}` : ''} · {formatDateTime(t.created_at)}</AppText>
        </View>
        <Card><AppText variant="label" style={{ marginBottom: 6 }}>Description</AppText><AppText selectable>{t.description}</AppText></Card>
        {!staff && t.staff_notes ? (
          <Card><AppText variant="label" style={{ marginBottom: 6 }}>Response from the finance office</AppText><AppText selectable>{t.staff_notes}</AppText></Card>
        ) : null}
        {staff ? <StaffControls key={t.updated_at} ticket={t} /> : <BookingPanel ticket={t} />}
        {staff && t.appointment_slot ? <Card><AppText variant="label">Appointment</AppText><AppText variant="bold" style={{ marginTop: 4 }}>{formatDateTime(t.appointment_slot)}</AppText></Card> : null}
        {!staff && ['pending', 'in_review'].includes(t.status) ? (
          <>
            <ErrorNote error={cancel.error} />
            <Button title="Cancel ticket" variant="danger" loading={cancel.isPending}
              onPress={() => Alert.alert('Cancel this ticket?', 'This also releases any appointment you booked.', [{ text: 'Keep it', style: 'cancel' }, { text: 'Cancel ticket', style: 'destructive', onPress: () => cancel.mutate() }])} />
          </>
        ) : null}
      </View>
    </Screen>
  );
}

// ── Staff: queue ─────────────────────────────────────────────

type Filter = 'open' | TicketStatus | 'all';

export function QueueScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [filter, setFilter] = useState<Filter>('open');
  const q = useQuery({ queryKey: ['tickets', 'staff'], queryFn: () => api.get<{ tickets: Ticket[] }>('/tickets'), refetchInterval: REFRESH_MS });
  const rows = (q.data?.tickets ?? []).filter((t) => (filter === 'all' ? true : filter === 'open' ? ['pending', 'in_review'].includes(t.status) : t.status === filter));
  const tabs: { label: string; value: Filter }[] = [
    { label: 'Open', value: 'open' }, { label: 'Pending', value: 'pending' }, { label: 'In review', value: 'in_review' },
    { label: 'Resolved', value: 'resolved' }, { label: 'Cancelled', value: 'cancelled' }, { label: 'All', value: 'all' },
  ];
  return (
    <ListScreen
      header={
        <View>
          <Header title="Ticket Queue" subtitle={`Highest priority first · ${rows.length} shown`} />
          <View style={{ marginBottom: SPACING.md }}><ChipGroup<Filter> options={tabs} value={filter} onChange={setFilter} /></View>
          <View style={{ height: 1, backgroundColor: colors.border, marginBottom: SPACING.md }} />
        </View>
      }
      data={rows}
      keyExtractor={(t) => t.id}
      renderItem={(t) => <TicketRow t={t} staff onPress={() => router.push(`/queue/${t.id}`)} />}
      loading={q.isLoading}
      error={q.error}
      emptyText="Nothing here."
      refreshing={q.isRefetching}
      onRefresh={() => void q.refetch()}
    />
  );
}
