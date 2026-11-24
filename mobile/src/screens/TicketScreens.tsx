import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { z } from 'zod';
import { FormTextField } from '@/components/forms';
import { ListScreen } from '@/components/ListScreen';
import { AppText, Badge, Button, Card, ChipGroup, ErrorNote, Field, Header, Screen, Spinner, TextField } from '@/components/ui';
import { useAuth } from '@/context/AuthProvider';
import { api } from '@/lib/api';
import { ISSUE_LABELS, ISSUE_TYPES, TICKET_STATUS } from '@/lib/constants';
import { firstName, formatDateTime, formatDay, formatTime } from '@/lib/format';
import type { Slot, SlotDate, Ticket, TicketAttachment, TicketPriority, TicketStatus } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { FONTS, RADIUS, SPACING } from '@/theme/theme';

const REFRESH_MS = 15_000; // poll so staff updates show up without leaving the screen
const invalidate = (qc: ReturnType<typeof useQueryClient>, keys: string[]) => keys.forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
const MAX_EVIDENCE_FILES = 3;
const EVIDENCE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);

function evidenceError(files: DocumentPicker.DocumentPickerAsset[], existingCount = 0): string | null {
  if (existingCount + files.length > MAX_EVIDENCE_FILES) return 'Attach no more than 3 files to a ticket.';
  if (files.some((file) => file.size !== undefined && file.size > MAX_EVIDENCE_BYTES)) return 'Each evidence file must be 5 MB or smaller.';
  if (files.some((file) => file.mimeType && !EVIDENCE_TYPES.has(file.mimeType))) return 'Evidence must be a PDF, PNG, or JPEG image.';
  return null;
}

async function uploadEvidence(ticketId: string, files: DocumentPicker.DocumentPickerAsset[]) {
  for (const file of files) {
    await api.upload(`/tickets/${ticketId}/attachments`, {
      uri: file.uri,
      name: file.name,
      mimeType: file.mimeType,
    });
  }
}

function TicketRow({ t, staff, onPress }: { t: Ticket; staff?: boolean; onPress: () => void }) {
  const s = TICKET_STATUS[t.status];
  return (
    <Card onPress={onPress}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <AppText variant="bold">{ISSUE_LABELS[t.issue_type] ?? t.issue_type}</AppText>
        <Badge color={s.color}>{s.label}</Badge>
        {t.priority === 'high' ? <Badge color="accent_red">HIGH</Badge> : null}
      </View>
      <AppText variant="muted" numberOfLines={2} style={{ marginTop: 6 }}>{t.description}</AppText>
      <AppText variant="muted" style={{ marginTop: 6, fontSize: 11 }}>
        {staff ? `${t.student_name} · ${t.student_number ?? ''} · ` : ''}
        {formatDateTime(t.created_at)}
        {t.appointment_slot ? `  ·  📅 ${formatDateTime(t.appointment_slot)}` : ''}
        {staff && t.assigned_staff_name ? `  ·  Assigned to ${t.assigned_staff_name}` : ''}
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
  const { colors } = useTheme();
  const [issueType, setIssueType] = useState<string>('');
  const [priority, setPriority] = useState<TicketPriority>('medium');
  const [appointmentDate, setAppointmentDate] = useState<string | null>(null);
  const [appointmentSlotId, setAppointmentSlotId] = useState<string | null>(null);
  const [typeError, setTypeError] = useState<string>();
  const [evidence, setEvidence] = useState<DocumentPicker.DocumentPickerAsset[]>([]);
  const [evidenceErrorText, setEvidenceErrorText] = useState<string | null>(null);
  const { control, handleSubmit } = useForm<{ description: string }>({ resolver: zodResolver(newTicketSchema), defaultValues: { description: '' } });
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
    mutationFn: async (v: { issueType: string; priority: TicketPriority; description: string }) => {
      const { ticket } = await api.post<{ ticket: Ticket }>('/tickets', {
        ...v,
        ...(appointmentSlotId ? { slotId: appointmentSlotId } : {}),
      });
      let uploadError: string | null = null;
      try {
        await uploadEvidence(ticket.id, evidence);
      } catch (error) {
        uploadError = error instanceof Error ? error.message : 'One or more evidence files could not be uploaded.';
      }
      return { ticket, uploadError };
    },
    onSuccess: ({ ticket, uploadError }) => {
      invalidate(qc, ['tickets']);
      if (uploadError) Alert.alert('Ticket created', `Your ticket was created, but evidence upload did not finish: ${uploadError}. You can retry from the ticket details.`);
      router.replace(`/tickets/${ticket.id}`);
    },
  });

  // Check the issue type up front so BOTH errors show at once (handleSubmit stops at the description otherwise).
  const submit = () => {
    setTypeError(issueType ? undefined : 'Choose an issue type');
    void handleSubmit((v) => {
      if (!issueType || evidenceErrorText) return;
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
        <Field label="Evidence files (optional)" hint="Attach up to 3 PDFs or images, 5 MB each.">
          <Button title={evidence.length ? 'Choose different evidence files' : 'Choose evidence files'} variant="secondary" onPress={() => {
            void DocumentPicker.getDocumentAsync({
              type: ['application/pdf', 'image/png', 'image/jpeg'],
              copyToCacheDirectory: true,
              multiple: true,
            }).then((result) => {
              if (result.canceled) return;
              const next = result.assets ?? [];
              const error = evidenceError(next);
              setEvidenceErrorText(error);
              setEvidence(error ? [] : next);
            }).catch((error: unknown) => setEvidenceErrorText(error instanceof Error ? error.message : 'Could not open the file picker.'));
          }} />
          {evidence.map((file) => <AppText key={`${file.uri}-${file.name}`} variant="muted">{file.name}</AppText>)}
          {evidenceErrorText ? <View accessibilityRole="alert"><AppText>{evidenceErrorText}</AppText></View> : null}
        </Field>
        <Card>
          <AppText variant="label">In-person appointment (optional)</AppText>
          <AppText variant="muted" style={{ marginTop: 4, marginBottom: SPACING.sm }}>Choose an available time if you need to visit the Finance Office.</AppText>
          {dates.isLoading ? <Spinner /> : dates.error ? <ErrorNote error={dates.error} /> : !dates.data?.dates.length ? (
            <AppText variant="muted">No future appointment slots are available. You can still submit your ticket.</AppText>
          ) : (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: SPACING.xs }}>
                {dates.data.dates.map((item) => (
                  <Pressable
                    key={item.date}
                    accessibilityRole="button"
                    accessibilityState={{ selected: item.date === activeDate }}
                    onPress={() => {
                      setAppointmentDate(item.date);
                      setAppointmentSlotId(null);
                    }}
                    style={{ borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 8, borderColor: item.date === activeDate ? colors.border_active : colors.border, backgroundColor: item.date === activeDate ? `${colors.accent_teal}33` : colors.bg_tertiary }}
                  >
                    <AppText variant="bold">{formatDay(item.date)}</AppText>
                    <AppText variant="muted">{item.free} available</AppText>
                  </Pressable>
                ))}
              </ScrollView>
              {slots.isLoading ? <Spinner /> : slots.error ? <ErrorNote error={slots.error} /> : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: SPACING.sm }}>
                  {slots.data?.slots.filter((slot) => !slot.is_booked).map((slot) => (
                    <Pressable
                      key={slot.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Select appointment at ${formatTime(slot.start_time)}`}
                      accessibilityState={{ selected: appointmentSlotId === slot.id }}
                      onPress={() => setAppointmentSlotId(appointmentSlotId === slot.id ? null : slot.id)}
                      style={{ borderWidth: 1, borderColor: appointmentSlotId === slot.id ? colors.border_active : colors.border, borderRadius: RADIUS.sm, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: appointmentSlotId === slot.id ? `${colors.accent_teal}33` : colors.bg_tertiary }}
                    >
                      <AppText variant="bold">{formatTime(slot.start_time)}</AppText>
                    </Pressable>
                  ))}
                  {!slots.data?.slots.some((slot) => !slot.is_booked) && <AppText variant="muted">No future times remain on this date.</AppText>}
                </View>
              )}
              {selectedSlot && activeDate ? <AppText variant="muted" style={{ marginTop: SPACING.sm }}>Selected appointment: {formatDay(activeDate)} at {formatTime(selectedSlot.start_time)}</AppText> : null}
            </>
          )}
        </Card>
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
  const [changing, setChanging] = useState(false);
  const dates = useQuery({ queryKey: ['slot-dates'], queryFn: () => api.get<{ dates: SlotDate[] }>('/slots/dates?days=60'), refetchInterval: REFRESH_MS });
  const active = date ?? dates.data?.dates.find((d) => d.free > 0)?.date ?? null;
  const slots = useQuery({
    queryKey: ['slots', active], enabled: !!active, refetchInterval: REFRESH_MS,
    queryFn: () => api.get<{ slots: Slot[] }>(`/slots?date=${active}`),
  });
  const refresh = () => invalidate(qc, ['ticket', 'tickets', 'slots', 'slot-dates']);
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
      <Card>
        <AppText variant="label">Appointment</AppText>
        <AppText variant="heading" style={{ marginVertical: 6 }}>{formatDateTime(ticket.appointment_slot)}</AppText>
        <ErrorNote error={cancel.error} />
        {['pending', 'in_review'].includes(ticket.status) ? (
          <>
            <Button title="Change appointment" variant="secondary" onPress={() => setChanging(true)} />
            <Button title="Cancel appointment" variant="secondary" loading={cancel.isPending} onPress={() => cancel.mutate()} />
          </>
        ) : null}
      </Card>
    );
  }
  if (!['pending', 'in_review'].includes(ticket.status)) return null;

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.sm, marginBottom: SPACING.sm }}>
        <AppText variant="label">{changing ? 'Choose a new appointment time' : 'Book an in-person appointment (optional)'}</AppText>
        {changing ? <Button title="Keep current" variant="secondary" onPress={() => setChanging(false)} /> : null}
      </View>
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
                  <Text style={{ color: on ? colors.accent_teal_lt : colors.text_primary, fontFamily: FONTS.button, fontSize: 11 }}>{formatDay(d.date)}</Text>
                  <Text style={{ color: colors.text_muted, fontFamily: FONTS.body, fontSize: 10 }}>{d.free} free</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: SPACING.sm }}>
            {slots.data?.slots.map((s) => (
              <Pressable key={s.id} disabled={s.is_booked || book.isPending} accessibilityRole="button" accessibilityLabel={`Book ${formatTime(s.start_time)}`}
                onPress={() => Alert.alert(changing ? 'Change appointment' : 'Book appointment', `${formatDay(s.start_time)} at ${formatTime(s.start_time)}?`, [{ text: 'Cancel', style: 'cancel' }, { text: changing ? 'Change' : 'Book', onPress: () => book.mutate(s.id) }])}
                style={{ borderWidth: 1, borderColor: colors.border, borderRadius: RADIUS.sm, paddingHorizontal: 10, paddingVertical: 8, opacity: s.is_booked ? 0.3 : 1, backgroundColor: colors.bg_tertiary }}>
                <Text style={{ color: colors.text_primary, fontFamily: FONTS.button, fontSize: 11, textDecorationLine: s.is_booked ? 'line-through' : 'none' }}>{formatTime(s.start_time)}</Text>
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
  const [issueType, setIssueType] = useState(ticket.issue_type);
  const [priority, setPriority] = useState<TicketPriority>(ticket.priority);
  const [response, setResponse] = useState('');
  const save = useMutation({
    mutationFn: () => api.patch(`/tickets/${ticket.id}`, { issueType, status, priority, ...(response.trim() ? { response: response.trim() } : {}) }),
    onSuccess: () => {
      setResponse('');
      invalidate(qc, ['ticket', 'tickets']);
    },
  });
  return (
    <Card>
      <AppText variant="label" style={{ marginBottom: SPACING.sm }}>Staff controls</AppText>
      {ticket.classification ? (
        <View style={{ marginBottom: SPACING.md }}>
          <AppText variant="bold">Classifier suggestion · {ticket.classification.provider_name}</AppText>
          <AppText variant="muted" style={{ marginTop: 4 }}>
            {ISSUE_LABELS[ticket.classification.suggested_category] ?? ticket.classification.suggested_category} · {ticket.classification.suggested_priority}
          </AppText>
          <AppText variant="muted" style={{ marginTop: 4 }}>{ticket.classification.rationale}</AppText>
          <AppText variant="muted" style={{ fontSize: 11 }}>{formatDateTime(ticket.classification.timestamp)}</AppText>
          <Button title="Use suggestion" variant="secondary" onPress={() => {
            setIssueType(ticket.classification!.suggested_category);
            setPriority(ticket.classification!.suggested_priority);
          }} />
        </View>
      ) : null}
      <Field label="Issue category">
        <ChipGroup options={ISSUE_TYPES.map((type) => ({ label: type.label, value: type.value as string }))} value={issueType} onChange={setIssueType} />
      </Field>
      <Field label="Status">
        <ChipGroup<TicketStatus> options={(Object.keys(TICKET_STATUS) as TicketStatus[]).map((v) => ({ label: TICKET_STATUS[v].label, value: v }))} value={status} onChange={(next) => {
          setStatus(next);
          if (next === 'cancelled') setResponse('');
        }} />
      </Field>
      <Field label="Priority">
        <ChipGroup<TicketPriority> options={[{ label: 'Low', value: 'low' }, { label: 'Medium', value: 'medium' }, { label: 'High', value: 'high' }]} value={priority} onChange={setPriority} />
      </Field>
      <TextField label="New Finance Office response" hint="Added to the ticket history; previous responses are kept." value={response} onChangeText={setResponse} multiline />
      <ErrorNote error={save.error} />
      <Button title={save.isSuccess ? 'Saved ✓' : 'Save changes'} loading={save.isPending} onPress={() => save.mutate()} />
    </Card>
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
    onSuccess: () => invalidate(qc, ['ticket', 'tickets']),
  });
  const available = staff.data?.staff.filter((person) => person.role === 'staff' && person.is_active) ?? [];
  const current = staff.data?.staff.find((person) => person.id === ticket.assigned_staff_id);
  const options = current && !available.some((person) => person.id === current.id) ? [current, ...available] : available;
  const disabled = options.filter((person) => !person.is_active || person.role !== 'staff').map((person) => person.id);

  return (
    <Card>
      <Field label="Assigned finance staff">
        <ChipGroup<string>
          options={[{ label: 'Unassigned', value: '' }, ...options.map((person) => ({
            label: `${person.name}${person.is_active ? '' : ' (inactive)'}`,
            value: person.id,
          }))]}
          value={ticket.assigned_staff_id ?? ''}
          disabledValues={disabled}
          onChange={(value) => assign.mutate(value || null)}
        />
      </Field>
      <ErrorNote error={staff.error ?? assign.error} />
    </Card>
  );
}

function TicketEvidencePanel({ ticket, canUpload }: { ticket: Ticket; canUpload: boolean }) {
  const qc = useQueryClient();
  const [files, setFiles] = useState<DocumentPicker.DocumentPickerAsset[]>([]);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const attachments = useQuery({
    queryKey: ['ticket-attachments', ticket.id],
    queryFn: () => api.get<{ attachments: TicketAttachment[] }>(`/tickets/${ticket.id}/attachments`),
    staleTime: 4 * 60_000,
  });
  const upload = useMutation({
    mutationFn: () => uploadEvidence(ticket.id, files),
    onSuccess: () => {
      setFiles([]);
      setSelectionError(null);
      void qc.invalidateQueries({ queryKey: ['ticket-attachments', ticket.id] });
    },
  });
  const saved = attachments.data?.attachments ?? [];
  const choose = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/png', 'image/jpeg'],
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (result.canceled) return;
      const next = result.assets ?? [];
      const error = evidenceError(next, saved.length);
      setSelectionError(error);
      setFiles(error ? [] : next);
    } catch (error) {
      setSelectionError(error instanceof Error ? error.message : 'Could not open the file picker.');
    }
  };
  return (
    <Card>
      <AppText variant="label" style={{ marginBottom: SPACING.sm }}>Attachments</AppText>
      <AppText variant="muted" style={{ marginBottom: SPACING.sm }}>Private file links expire after 5 minutes.</AppText>
      {attachments.isLoading ? <Spinner /> : attachments.error ? <ErrorNote error={attachments.error} /> : saved.length ? (
        <View style={{ gap: SPACING.xs }}>
          {saved.map((file) => (
            <Button
              key={file.id}
              title={`Open ${file.fileName}`}
              variant="secondary"
              onPress={() => { void Linking.openURL(file.url).catch(() => Alert.alert('Could not open evidence', 'Please try again.')); }}
            />
          ))}
        </View>
      ) : <AppText variant="muted">No files attached.</AppText>}
      {canUpload && saved.length < MAX_EVIDENCE_FILES ? (
        <View style={{ marginTop: SPACING.sm }}>
          <AppText variant="muted" style={{ marginBottom: SPACING.xs }}>
            Add up to {MAX_EVIDENCE_FILES - saved.length} more PDF or image files (5 MB each).
          </AppText>
          <Button title={files.length ? 'Choose different evidence files' : 'Add evidence'} variant="secondary" onPress={() => { void choose(); }} />
          {files.map((file) => <AppText key={`${file.uri}-${file.name}`} variant="muted">{file.name}</AppText>)}
          {selectionError ? <View accessibilityRole="alert"><AppText>{selectionError}</AppText></View> : null}
          <ErrorNote error={upload.error} />
          <Button title="Upload evidence" loading={upload.isPending} disabled={!files.length || Boolean(selectionError)} onPress={() => upload.mutate()} />
        </View>
      ) : null}
    </Card>
  );
}

// ── Ticket detail (students and staff) ───────────────────────

export function TicketDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();
  const staff = user?.role === 'staff' || user?.role === 'admin';
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
        <TicketEvidencePanel ticket={t} canUpload={!staff && t.status === 'pending'} />
        {!!t.responses?.length ? (
          <View accessibilityLabel="Finance Office response history" style={{ gap: SPACING.sm }}>
            <AppText variant="label">Finance Office response history</AppText>
            {t.responses.map((r) => (
              <Card key={r.id}>
                <AppText variant="label">{firstName(r.author_name) || 'Finance Office'}</AppText>
                <AppText variant="muted" style={{ marginTop: 4, fontSize: 11 }}>{formatDateTime(r.created_at)}</AppText>
                <AppText selectable style={{ marginTop: 8 }}>{r.body}</AppText>
              </Card>
            ))}
          </View>
        ) : null}
        {staff && t.status !== 'cancelled' ? <StaffControls key={t.updated_at} ticket={t} /> : !staff ? <BookingPanel ticket={t} /> : null}
        {user?.role === 'admin' && t.status !== 'cancelled' ? <AdminAssignmentControl ticket={t} /> : null}
        {staff && t.appointment_slot ? <Card><AppText variant="label">Appointment</AppText><AppText variant="bold" style={{ marginTop: 4 }}>{formatDateTime(t.appointment_slot)}</AppText></Card> : null}
        {!staff && ['pending', 'in_review'].includes(t.status) ? (
          <>
            <ErrorNote error={cancel.error} />
            <Button title="Cancel ticket" variant="danger" loading={cancel.isPending}
              onPress={() => Alert.alert('Cancel this ticket?', 'This also releases any appointment you booked.', [{ text: 'Keep it', style: 'cancel' }, { text: 'Cancel ticket', style: 'destructive', onPress: () => cancel.mutate() }])} />
          </>
        ) : null}
        {t.attended_by_name ? <Card><AppText variant="muted">Attended by {firstName(t.attended_by_name)}</AppText></Card> : null}
      </View>
    </Screen>
  );
}

// ── Staff: queue ─────────────────────────────────────────────

type Filter = 'open' | 'my' | TicketStatus | 'all';

export function QueueScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [filter, setFilter] = useState<Filter>('open');
  const q = useQuery({
    queryKey: ['tickets', 'staff', filter],
    queryFn: () => api.get<{ tickets: Ticket[] }>(filter === 'my' ? '/tickets?assignedTo=me' : '/tickets'),
    refetchInterval: REFRESH_MS,
  });
  const rows = (q.data?.tickets ?? []).filter((t) => (filter === 'all' || filter === 'my' ? true : filter === 'open' ? ['pending', 'in_review'].includes(t.status) : t.status === filter));
  const tabs: { label: string; value: Filter }[] = [
    { label: 'Open', value: 'open' }, { label: 'My tickets', value: 'my' }, { label: 'Pending', value: 'pending' }, { label: 'In review', value: 'in_review' },
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
