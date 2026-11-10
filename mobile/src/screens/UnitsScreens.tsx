import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { ListScreen } from '@/components/ListScreen';
import { AppText, Badge, Button, Card, ChipGroup, ErrorNote, Header, NoteModal, TextField } from '@/components/ui';
import { useAuth } from '@/context/AuthProvider';
import { api } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import type { ExamPeriod, ExamUnit, UnitPeriod, UnitRegisterRow } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { SPACING } from '@/theme/theme';

const isStaff = (role?: string) => role === 'staff' || role === 'admin';
const when = (u: Pick<ExamUnit, 'exam_date' | 'start_time' | 'end_time' | 'venue'>) =>
  [u.exam_date && formatDate(u.exam_date), u.start_time && `${u.start_time.slice(0, 5)}${u.end_time ? `–${u.end_time.slice(0, 5)}` : ''}`, u.venue].filter(Boolean).join(' · ') || 'No date or venue set';

function Progress({ signed, registered }: { signed: number; registered: number }) {
  const { colors } = useTheme();
  const pct = registered ? Math.round((Number(signed) / Number(registered)) * 100) : 0;
  return (
    <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }} style={{ height: 8, borderRadius: 4, backgroundColor: colors.bg_tertiary, overflow: 'hidden' }}>
      <View style={{ height: 8, width: `${pct}%`, backgroundColor: colors.accent_green, borderRadius: 4 }} />
    </View>
  );
}

// ── The units of an exam period ──────────────────────────────

export function UnitsScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const staff = isStaff(user?.role);
  const [periodId, setPeriodId] = useState('');
  const periods = useQuery({ queryKey: ['periods'], enabled: staff, queryFn: () => api.get<{ periods: ExamPeriod[] }>('/exam-periods') });
  const q = useQuery({
    queryKey: ['units', periodId],
    queryFn: () => api.get<{ period: UnitPeriod | null; units: ExamUnit[] }>(`/exam-units${periodId ? `?periodId=${periodId}` : ''}`),
    refetchInterval: 15_000,
  });
  const period = q.data?.period;
  return (
    <ListScreen
      header={(
        <View>
          <Header
            title={staff ? 'Exam units' : 'My units'}
            subtitle={staff ? 'Who sits which unit, who signs it, and who has already signed in.' : 'The units you invigilate and who has signed in.'}
          />
          {staff && (periods.data?.periods.length ?? 0) > 1 ? (
            <View style={{ marginBottom: SPACING.md }}>
              <AppText variant="label" style={{ marginBottom: 6 }}>Exam period</AppText>
              <ChipGroup options={periods.data!.periods.map((p) => ({ label: p.title, value: p.id }))} value={periodId || period?.id || ''} onChange={setPeriodId} />
            </View>
          ) : null}
        </View>
      )}
      data={q.data?.units}
      keyExtractor={(u) => u.id}
      renderItem={(u) => (
        <Card onPress={() => router.push(`/units/${u.id}`)} accessibilityLabel={`${u.unit_code} ${u.unit_name}`}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <AppText variant="bold">{u.unit_code} <AppText variant="muted">{u.unit_name}</AppText></AppText>
              <AppText variant="muted" style={{ marginTop: 2 }}>{when(u)}</AppText>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <AppText style={{ fontFamily: 'Orbitron_900Black', fontSize: 18 }}>{u.signed}<AppText variant="muted">/{u.registered}</AppText></AppText>
              <AppText variant="label" style={{ marginBottom: 0 }}>signed in</AppText>
            </View>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: SPACING.sm }}>
            {u.lecturers.length === 0 ? <Badge color="accent_amber">NO LECTURER ASSIGNED</Badge> : u.lecturers.map((l) => <Badge key={l.id} color="accent_teal_lt">{l.name}</Badge>)}
          </View>
          <Progress signed={u.signed} registered={u.registered} />
        </Card>
      )}
      loading={q.isLoading}
      error={q.error}
      emptyText={period ? (staff ? 'No units yet. Import the student registrations from the web app (Exam Units).' : 'No units are assigned to you in this exam period. Ask the finance office.') : 'There is no active exam period.'}
      refreshing={q.isRefetching}
      onRefresh={() => void q.refetch()}
    />
  );
}

// ── The register of one unit ─────────────────────────────────

type Filter = 'all' | 'signed' | 'waiting' | 'barred';

export function UnitRegisterScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const staff = isStaff(user?.role);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [undoing, setUndoing] = useState<UnitRegisterRow | null>(null);
  const [barring, setBarring] = useState<UnitRegisterRow | null>(null);
  const [studentId, setStudentId] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const reg = useQuery({
    queryKey: ['register', id],
    queryFn: () => api.get<{ unit: ExamUnit; rows: UnitRegisterRow[] }>(`/exam-units/${id}/register`),
    refetchInterval: 5000, // the hall fills up while you watch
  });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['register', id] }); void qc.invalidateQueries({ queryKey: ['units'] }); };
  const undo = useMutation({ mutationFn: ({ rid, reason }: { rid: string; reason: string }) => api.post(`/exam-units/registrations/${rid}/reset`, { reason }), onSuccess: () => { setUndoing(null); refresh(); } });
  const bar = useMutation({ mutationFn: ({ rid, allowed, reason }: { rid: string; allowed: boolean; reason: string }) => api.patch(`/exam-units/registrations/${rid}`, { allowed, reason }), onSuccess: () => { setBarring(null); refresh(); } });
  const remove = useMutation({ mutationFn: (rid: string) => api.del(`/exam-units/registrations/${rid}`), onSuccess: refresh });
  const add = useMutation({
    mutationFn: (sid: string) => api.post<{ added: number }>('/exam-units/registrations/import', { periodId: reg.data!.unit.exam_period_id, rows: [{ student_id: sid, unit_code: reg.data!.unit.unit_code }] }),
    onSuccess: (r, sid) => { setNote(r.added ? `${sid.toUpperCase()} added.` : `${sid.toUpperCase()} is already on this register.`); setStudentId(''); refresh(); },
  });

  const all = reg.data?.rows ?? [];
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return all.filter((r) => {
      if (filter === 'signed' && !r.signed_at) return false;
      if (filter === 'waiting' && (r.signed_at || !r.allowed)) return false;
      if (filter === 'barred' && r.allowed) return false;
      return !needle || r.student_id.toLowerCase().includes(needle) || r.student_name.toLowerCase().includes(needle);
    });
  }, [all, filter, search]);

  const unit = reg.data?.unit;
  const counts = { signed: all.filter((r) => r.signed_at).length, waiting: all.filter((r) => !r.signed_at && r.allowed).length, barred: all.filter((r) => !r.allowed).length };
  return (
    <>
      <ListScreen
        header={(
          <View>
            <Header title={unit ? unit.unit_code : 'Register'} subtitle={unit ? `${unit.unit_name}${unit.unit_name ? ' · ' : ''}${when(unit)}` : undefined} />
            {unit ? (
              <View style={{ marginBottom: SPACING.md, gap: 6 }}>
                <AppText variant="bold">{counts.signed} of {all.length} signed in</AppText>
                <Progress signed={counts.signed} registered={all.length} />
              </View>
            ) : null}
            <ChipGroup<Filter>
              options={[{ label: `All ${all.length}`, value: 'all' }, { label: `Signed ${counts.signed}`, value: 'signed' }, { label: `Not yet ${counts.waiting}`, value: 'waiting' }, { label: `Barred ${counts.barred}`, value: 'barred' }]}
              value={filter} onChange={setFilter}
            />
            <View style={{ height: SPACING.md }} />
            <TextField label="Search" value={search} onChangeText={setSearch} placeholder="Name or student ID" autoCapitalize="none" autoCorrect={false} />
            {staff && unit ? (
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
                <View style={{ flex: 1 }}>
                  <TextField label="Add a student by ID" value={studentId} onChangeText={(t) => { setStudentId(t); setNote(null); }} placeholder="e.g. COM/072/23" autoCapitalize="characters" autoCorrect={false} accessibilityLabel="Add a student by ID" />
                </View>
                <Button title="Add" variant="secondary" icon="person-add-outline" loading={add.isPending} disabled={!studentId.trim()} style={{ marginBottom: SPACING.md }} onPress={() => add.mutate(studentId.trim())} />
              </View>
            ) : null}
            {note ? <AppText variant="muted" style={{ color: colors.accent_green, marginBottom: SPACING.sm }}>{note}</AppText> : null}
            {add.isError ? <ErrorNote error={add.error} /> : null}
            {remove.isError || bar.isError ? <ErrorNote error={remove.error ?? bar.error} /> : null}
          </View>
        )}
        data={rows}
        keyExtractor={(r) => r.id}
        renderItem={(r) => (
          <Card accessibilityLabel={`${r.student_name || r.student_id}, ${r.signed_at ? 'signed' : r.allowed ? 'not yet' : 'not allowed'}`}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <AppText variant="bold">{r.student_name || '—'}</AppText>
                <AppText variant="muted">{r.student_id}</AppText>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                {r.signed_at ? <Badge color="accent_green">SIGNED</Badge> : r.allowed ? <Badge color="text_muted">NOT YET</Badge> : <Badge color="accent_red">NOT ALLOWED</Badge>}
                {r.has_card ? <Badge color="accent_green">CARD ISSUED</Badge> : <Badge color="accent_amber">NO CARD</Badge>}
              </View>
            </View>
            {r.signed_at ? <AppText variant="muted" style={{ marginTop: 6 }}>{formatDateTime(r.signed_at)} · {r.signed_by_name}</AppText> : null}
            {!r.allowed && r.block_reason ? <AppText variant="muted" style={{ marginTop: 6 }}>{r.block_reason}</AppText> : null}
            {staff ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: SPACING.sm + 4, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: SPACING.sm + 4 }}>
                {r.signed_at ? <Button title="Undo" size="sm" variant="secondary" onPress={() => setUndoing(r)} /> : (
                  <>
                    {r.allowed ? <Button title="Bar" size="sm" variant="secondary" onPress={() => setBarring(r)} /> : <Button title="Allow" size="sm" variant="secondary" onPress={() => bar.mutate({ rid: r.id, allowed: true, reason: '' })} />}
                    <Button title="Remove" size="sm" variant="ghost" onPress={() => Alert.alert(`Remove ${r.student_id}?`, `They will no longer be registered for ${unit?.unit_code}.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => remove.mutate(r.id) }])} />
                  </>
                )}
              </View>
            ) : null}
          </Card>
        )}
        loading={reg.isLoading}
        error={reg.error}
        emptyText="No students match."
        refreshing={reg.isRefetching}
        onRefresh={() => void reg.refetch()}
      />
      <NoteModal visible={!!undoing} title="Undo this signature?" description={`${undoing?.student_name || undoing?.student_id} will be marked as not yet signed in. Your reason is kept in the audit log.`} confirmLabel="Undo signature" busy={undo.isPending} onCancel={() => setUndoing(null)} onConfirm={(reason) => undoing && undo.mutate({ rid: undoing.id, reason })} />
      <NoteModal visible={!!barring} title="Bar from this unit?" description={`${barring?.student_name || barring?.student_id} will be refused at the door for ${unit?.unit_code}.`} confirmLabel="Bar student" busy={bar.isPending} onCancel={() => setBarring(null)} onConfirm={(reason) => barring && bar.mutate({ rid: barring.id, allowed: false, reason })} />
    </>
  );
}

