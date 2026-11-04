import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { ListScreen } from '@/components/ListScreen';
import { AppText, Badge, Button, Card, ChipGroup, ErrorNote, Header, NoteModal, TextField } from '@/components/ui';
import { api } from '@/lib/api';
import { EXAM_STATUS } from '@/lib/constants';
import { formatDateTime, formatKsh } from '@/lib/format';
import type { Application, ExamCardStatus, FeeRecord } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { SPACING } from '@/theme/theme';

// ── Exam applications ────────────────────────────────────────

type AppFilter = ExamCardStatus | 'all';

export function ApplicationsScreen() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<AppFilter>('all');
  const [approving, setApproving] = useState<Application | null>(null);
  const q = useQuery({ queryKey: ['applications', 'staff'], queryFn: () => api.get<{ applications: Application[] }>('/applications'), refetchInterval: 15_000 });
  const approve = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => api.post(`/applications/${id}/approve`, { note }),
    onSuccess: () => {
      setApproving(null);
      void qc.invalidateQueries({ queryKey: ['applications'] });
    },
  });
  const rows = (q.data?.applications ?? []).filter((a) => filter === 'all' || a.status === filter);
  const filters: { label: string; value: AppFilter }[] = [
    { label: 'All', value: 'all' }, { label: 'Pending', value: 'pending' }, { label: 'Approved', value: 'approved' },
    { label: 'Rejected', value: 'rejected' }, { label: 'Issued', value: 'issued' },
  ];
  return (
    <>
      <ListScreen
        header={
          <View>
            <Header title="Exam Applications" subtitle="Decided automatically from fee records. Override with a recorded reason." />
            <View style={{ marginBottom: SPACING.md }}><ChipGroup<AppFilter> options={filters} value={filter} onChange={setFilter} /></View>
            <ErrorNote error={approve.error} />
          </View>
        }
        data={rows}
        keyExtractor={(a) => a.id}
        renderItem={(a) => (
          <Card>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <AppText variant="bold">{a.student_name}</AppText>
              <Badge color={EXAM_STATUS[a.status].color}>{EXAM_STATUS[a.status].label}</Badge>
            </View>
            <AppText variant="muted" style={{ marginTop: 4, fontSize: 11 }}>{a.student_id} · {a.course ?? '—'}</AppText>
            <AppText variant="muted" style={{ fontSize: 11 }}>{a.period_title} · applied {formatDateTime(a.created_at)}</AppText>
            <AppText style={{ marginTop: 6, fontSize: 12 }}>Paid {formatKsh(a.amount_paid)} of {formatKsh(a.total_fee)} · balance {formatKsh(a.balance)}</AppText>
            {a.manual_approval_note ? <AppText variant="muted" style={{ marginTop: 4 }}>Override: {a.manual_approval_note}</AppText> : null}
            {['rejected', 'pending'].includes(a.status) ? <Button title="Approve manually" variant="secondary" style={{ marginTop: SPACING.sm + 4 }} onPress={() => setApproving(a)} /> : null}
          </Card>
        )}
        loading={q.isLoading}
        error={q.error}
        emptyText="No applications."
        refreshing={q.isRefetching}
        onRefresh={() => void q.refetch()}
      />
      <NoteModal
        visible={!!approving}
        title={`Approve ${approving?.student_name ?? ''}?`}
        description="This overrides the automatic decision. Your name and reason are recorded."
        confirmLabel="Approve"
        busy={approve.isPending}
        onCancel={() => setApproving(null)}
        onConfirm={(note) => approving && approve.mutate({ id: approving.id, note })}
      />
    </>
  );
}

// ── Fee records ──────────────────────────────────────────────

export function FeesScreen() {
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [excepting, setExcepting] = useState<FeeRecord | null>(null);
  const q = useQuery({ queryKey: ['fees', 'staff', search], queryFn: () => api.get<{ feeRecords: FeeRecord[] }>(`/fee-records?search=${encodeURIComponent(search)}`) });
  const grant = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => api.post(`/fee-records/${id}/exception`, { note }),
    onSuccess: () => {
      setExcepting(null);
      void qc.invalidateQueries({ queryKey: ['fees'] });
    },
  });
  return (
    <>
      <ListScreen
        header={
          <View>
            <Header title="Fee Records" subtitle="Import CSVs from the web app. Grant exceptions here." />
            <TextField label="Search" value={search} onChangeText={setSearch} placeholder="Student ID or name" autoCapitalize="none" autoCorrect={false} />
            <ErrorNote error={grant.error} />
          </View>
        }
        data={q.data?.feeRecords}
        keyExtractor={(f) => f.id}
        renderItem={(f) => (
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <AppText variant="bold">{f.student_name || '—'}</AppText>
                <AppText variant="muted" style={{ fontSize: 11 }}>{f.student_id} · {f.semester}, {f.academic_year}</AppText>
              </View>
              {f.is_cleared_for_exam ? <Badge color="#22C55E">CLEARED</Badge> : <Badge color="#EF4444">NOT CLEARED</Badge>}
            </View>
            <View style={{ flexDirection: 'row', marginTop: SPACING.sm + 2 }}>
              {([['Total', formatKsh(f.total_fee), colors.text_primary], ['Paid', formatKsh(f.amount_paid), colors.text_primary], ['Balance', formatKsh(f.balance), f.balance > 0 ? colors.accent_red : colors.accent_green]] as const).map(([l, v, c]) => (
                <View key={l} style={{ flex: 1 }}><AppText variant="label">{l}</AppText><AppText variant="bold" style={{ color: c, fontSize: 12 }}>{v}</AppText></View>
              ))}
            </View>
            {f.exception_note ? <AppText variant="muted" style={{ marginTop: 6 }}>Exception: {f.exception_note}</AppText> : null}
            {!f.is_cleared_for_exam ? <Button title="Grant exception" variant="secondary" style={{ marginTop: SPACING.sm + 4 }} onPress={() => setExcepting(f)} /> : null}
          </Card>
        )}
        loading={q.isLoading}
        error={q.error}
        emptyText="No fee records."
        refreshing={q.isRefetching}
        onRefresh={() => void q.refetch()}
      />
      <NoteModal
        visible={!!excepting}
        title={`Grant exception: ${excepting?.student_name ?? excepting?.student_id ?? ''}`}
        description={`Clears them for exams despite a ${formatKsh(excepting?.balance ?? 0)} balance. Recorded under your name.`}
        confirmLabel="Grant"
        busy={grant.isPending}
        onCancel={() => setExcepting(null)}
        onConfirm={(note) => excepting && grant.mutate({ id: excepting.id, note })}
      />
    </>
  );
}
