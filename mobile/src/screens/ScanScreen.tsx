import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Switch, Vibration, View } from 'react-native';
import { CardScanner } from '@/components/CardScanner';
import { AppText, Badge, Button, Card, Empty, ErrorNote, Header, Screen, Spinner, TextField } from '@/components/ui';
import { api } from '@/lib/api';
import { extractCode } from '@/lib/cards';
import { formatDateTime } from '@/lib/format';
import type { CardLookup, CardUnit, ExamUnit, SignResult, SignResultCode, UnitPeriod } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { FONTS, RADIUS, SPACING, type Palette } from '@/theme/theme';

// The scan screen, same rules as the web's Scan Cards page: one scan checks the card, shows the student's units and signs
// the unit you are invigilating. The server does the signing atomically, so a unit can only ever be signed once.

type Outcome =
  | { kind: 'sign'; data: SignResult }
  | { kind: 'card'; data: CardLookup; code: string }
  | { kind: 'error'; message: string };
interface Recent { at: number; student: string; unit: string; result: SignResultCode | 'looked_up' }

const REPEAT_MS = 4000; // the same card held in front of the camera is read many times a second
let rememberedUnit = ''; // kept while the app is open, so coming back to this screen keeps your unit

const TONE: Record<SignResultCode, keyof Palette> = {
  signed: 'accent_green', already_signed: 'accent_amber', not_registered: 'accent_red', barred: 'accent_red',
  not_your_unit: 'accent_red', card_invalid: 'accent_red', wrong_day: 'accent_amber', wrong_period: 'accent_red',
};
const TITLE: Record<SignResultCode, string> = {
  signed: 'SIGNED IN', already_signed: 'ALREADY SIGNED', not_registered: 'NOT REGISTERED', barred: 'NOT ALLOWED',
  not_your_unit: 'NOT YOUR UNIT', card_invalid: 'INVALID CARD', wrong_day: 'WRONG DAY', wrong_period: 'WRONG EXAM PERIOD',
};
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
const buzz = (ok: boolean) => { try { Vibration.vibrate(ok ? 120 : [0, 80, 60, 80]); } catch { /* not supported */ } };

export function ScanScreen() {
  const { colors } = useTheme();
  const qc = useQueryClient();
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const units = useQuery({ queryKey: ['scan-units'], queryFn: () => api.get<{ period: UnitPeriod | null; units: ExamUnit[] }>('/exam-units') });
  const [unitId, setUnitId] = useState(rememberedUnit);
  const [auto, setAuto] = useState(true);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [manual, setManual] = useState('');
  const [picking, setPicking] = useState(false);
  const last = useRef({ code: '', at: 0 });
  const locked = useRef(false);

  const list = units.data?.units ?? [];
  useEffect(() => {
    if (!units.data) return;
    if (unitId && !list.some((u) => u.id === unitId)) setUnitId('');
    else if (!unitId && list.length === 1) setUnitId(list[0]!.id);
  }, [units.data, unitId, list]);
  useEffect(() => { rememberedUnit = unitId; }, [unitId]);
  const unit = list.find((u) => u.id === unitId);

  const remember = (r: Recent) => setRecent((prev) => [r, ...prev].slice(0, 8));

  const sign = useCallback(async (raw: string, forUnit: string) => {
    const data = await api.post<SignResult>('/invigilation/sign', { code: raw, unitId: forUnit });
    setOutcome({ kind: 'sign', data });
    buzz(data.ok);
    remember({ at: Date.now(), student: data.student?.name ?? 'Unknown card', unit: data.unit?.unit_code ?? '', result: data.result });
    void qc.invalidateQueries({ queryKey: ['scan-units'] });
  }, [qc]);

  const handle = useCallback(async (raw: string) => {
    const code = extractCode(raw);
    if (!code) { setOutcome({ kind: 'error', message: 'That is not a Finesse exam-card code.' }); buzz(false); return; }
    const now = Date.now();
    if (locked.current || (last.current.code === code && now - last.current.at < REPEAT_MS)) return;
    last.current = { code, at: now };
    if (auto && !unitId) { setOutcome({ kind: 'error', message: 'Choose the unit you are invigilating first.' }); buzz(false); return; }
    locked.current = true;
    setBusy(true);
    try {
      if (auto) {
        await sign(raw, unitId);
      } else {
        const data = await api.get<CardLookup>(`/invigilation/card/${encodeURIComponent(code)}`);
        setOutcome({ kind: 'card', data, code });
        buzz(data.valid);
        remember({ at: now, student: data.student?.name ?? 'Unknown card', unit: '', result: 'looked_up' });
      }
    } catch (e) {
      setOutcome({ kind: 'error', message: errorMessage(e) });
      buzz(false);
      last.current = { code: '', at: 0 }; // a network error should not block an immediate retry
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }, [auto, unitId, sign]);

  // A code can arrive as a link parameter (/scan?code=…); handle it once the unit is known.
  const handledParam = useRef(false);
  useEffect(() => {
    if (!params.code || handledParam.current || !units.data) return;
    if (auto && !unitId) return;
    handledParam.current = true;
    void handle(params.code);
    router.setParams({ code: undefined as never });
  }, [params.code, units.data, auto, unitId, handle, router]);

  async function signFromCard(o: Extract<Outcome, { kind: 'card' }>, u: CardUnit) {
    setBusy(true);
    try { await sign(o.code, u.id); } catch (e) { setOutcome({ kind: 'error', message: errorMessage(e) }); } finally { setBusy(false); }
  }

  const period = units.data?.period;
  return (
    <Screen onRefresh={() => void units.refetch()} refreshing={units.isRefetching}>
      <Header
        title="Scan exam cards"
        subtitle={period ? `${period.title} · ${period.academic_year}, ${period.semester}` : 'Scan a card to check it and sign the unit.'}
      />
      {units.isLoading ? <Spinner /> : units.isError ? <ErrorNote error={units.error} /> : list.length === 0 ? (
        <Empty>No units are set up for you in the current exam period. Ask the finance office to assign your unit.</Empty>
      ) : (
        <View style={{ gap: SPACING.md }}>
          <Card style={{ gap: SPACING.sm }}>
            <AppText variant="label">Unit you are invigilating</AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Unit you are invigilating"
              onPress={() => setPicking(true)}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg_input, borderRadius: RADIUS.md, paddingHorizontal: 12, minHeight: 46 }}
            >
              <AppText variant={unit ? 'bold' : 'muted'} numberOfLines={1} style={{ flex: 1 }}>
                {unit ? `${unit.unit_code} · ${unit.unit_name || 'Unit'} (${unit.signed}/${unit.registered} signed)` : 'Choose a unit…'}
              </AppText>
              <Ionicons name="chevron-down" size={18} color={colors.text_muted} />
            </Pressable>
            {unit ? <AppText variant="muted">{[unit.exam_date, unit.start_time?.slice(0, 5), unit.venue].filter(Boolean).join(' · ') || 'No date or venue set'}</AppText> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <AppText variant="muted" style={{ flex: 1 }}>Sign automatically when a card is scanned</AppText>
              <Switch value={auto} onValueChange={setAuto} accessibilityLabel="Sign automatically" trackColor={{ true: colors.accent_teal, false: colors.border }} />
            </View>
          </Card>

          <CardScanner onCode={(t) => void handle(t)} paused={busy} />

          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <TextField label="Or paste the card code / link" value={manual} onChangeText={setManual} autoCapitalize="characters" autoCorrect={false} accessibilityLabel="Card code" />
            </View>
            <Button
              title="Check" variant="secondary" loading={busy} style={{ marginBottom: SPACING.md }}
              onPress={() => { const v = manual; setManual(''); last.current = { code: '', at: 0 }; void handle(v); }}
            />
          </View>

          {outcome ? <OutcomeView outcome={outcome} busy={busy} onSign={signFromCard} /> : (
            <Card><AppText variant="muted">Point the camera at a student's exam-card QR code. {auto ? 'The unit is signed as soon as the card is read.' : 'You will see their units first, then tap the one to sign.'}</AppText></Card>
          )}

          {recent.length > 0 ? (
            <Card>
              <AppText variant="label" style={{ marginBottom: 6 }}>This session</AppText>
              {recent.map((r) => (
                <View key={r.at} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: 7, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <AppText variant="bold" numberOfLines={1} style={{ flex: 1, fontSize: 13 }}>{r.student}</AppText>
                  <AppText variant="muted">{r.unit}</AppText>
                  <Badge color={r.result === 'looked_up' ? 'accent_teal_lt' : TONE[r.result]}>{r.result === 'looked_up' ? 'CHECKED' : TITLE[r.result]}</Badge>
                </View>
              ))}
            </Card>
          ) : null}
        </View>
      )}

      <UnitPicker visible={picking} units={list} selected={unitId} onClose={() => setPicking(false)} onPick={(id) => { setUnitId(id); setPicking(false); }} />
    </Screen>
  );
}

function UnitPicker({ visible, units, selected, onClose, onPick }: { visible: boolean; units: ExamUnit[]; selected: string; onClose: () => void; onPick: (id: string) => void }) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" onPress={onClose} style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' }}>
        <Pressable style={{ backgroundColor: colors.bg_secondary, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '70%', paddingTop: SPACING.md }}>
          <AppText variant="heading" style={{ paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm }}>Choose your unit</AppText>
          <ScrollView contentContainerStyle={{ paddingBottom: SPACING.xl }}>
            {units.map((u) => (
              <Pressable key={u.id} accessibilityRole="button" accessibilityLabel={u.unit_code} onPress={() => onPick(u.id)}
                style={{ paddingHorizontal: SPACING.lg, paddingVertical: 14, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: u.id === selected ? colors.bg_tertiary : 'transparent' }}>
                <AppText variant="bold">{u.unit_code} <AppText variant="muted">{u.unit_name}</AppText></AppText>
                <AppText variant="muted">{u.signed}/{u.registered} signed{u.venue ? ` · ${u.venue}` : ''}</AppText>
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function StudentLine({ s }: { s: NonNullable<SignResult['student']> }) {
  return (
    <View>
      <AppText style={{ fontFamily: FONTS.heading, fontSize: 17 }}>{s.name}</AppText>
      <AppText variant="muted">{[s.student_id, s.course, s.year_of_study && `Year ${s.year_of_study}`].filter(Boolean).join(' · ')}</AppText>
    </View>
  );
}

function UnitRows({ units, current, signable, busy, onSign }: { units: CardUnit[]; current?: string; signable?: boolean; busy?: boolean; onSign?: (u: CardUnit) => void }) {
  const { colors } = useTheme();
  if (units.length === 0) return <AppText variant="muted">This student has no registered units in this exam period.</AppText>;
  return (
    <View style={{ gap: 6 }}>
      {units.map((u) => (
        <View key={u.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderWidth: 1, borderColor: u.id === current ? colors.border_active : colors.border, backgroundColor: u.id === current ? colors.bg_tertiary : 'transparent', borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 9 }}>
          <AppText style={{ flex: 1, fontSize: 13 }}><AppText variant="bold" style={{ fontSize: 13 }}>{u.unit_code}</AppText> {u.unit_name}</AppText>
          {u.signed_at ? <Badge color="accent_green">SIGNED</Badge>
            : !u.allowed ? <Badge color="accent_red">{signable && u.block_reason ? `NOT ALLOWED: ${u.block_reason}` : 'NOT ALLOWED'}</Badge>
              : signable ? (u.can_sign ? <Button title="Sign" size="sm" loading={busy} onPress={() => onSign?.(u)} /> : <Badge color="text_muted">NOT YOURS</Badge>)
                : <Badge color="text_muted">NOT YET</Badge>}
        </View>
      ))}
    </View>
  );
}

function OutcomeView({ outcome, busy, onSign }: { outcome: Outcome; busy: boolean; onSign: (o: Extract<Outcome, { kind: 'card' }>, u: CardUnit) => void }) {
  const { colors } = useTheme();
  if (outcome.kind === 'error') {
    return (
      <Card accessibilityRole="alert" style={{ borderColor: colors.accent_red, flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        <Ionicons name="close-circle" size={26} color={colors.accent_red} />
        <AppText style={{ flex: 1 }}>{outcome.message}</AppText>
      </Card>
    );
  }

  if (outcome.kind === 'sign') {
    const d = outcome.data;
    const color = colors[TONE[d.result]];
    const icon = d.ok ? 'checkmark-circle' : d.result === 'already_signed' || d.result === 'wrong_day' ? 'time' : 'shield-half';
    return (
      <Card accessibilityLabel={`${TITLE[d.result]}. ${d.message}`} style={{ borderColor: color, gap: SPACING.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Ionicons name={icon as never} size={38} color={color} />
          <View style={{ flex: 1 }}>
            <AppText style={{ fontFamily: FONTS.heading, fontSize: 17, color }}>{TITLE[d.result]}</AppText>
            <AppText style={{ color }}>{d.message}</AppText>
          </View>
        </View>
        {d.student ? <StudentLine s={d.student} /> : null}
        {d.provisional ? (
          <View style={{ flexDirection: 'row', gap: 8, borderWidth: 1, borderColor: colors.accent_amber, borderRadius: RADIUS.md, padding: 10 }}>
            <Ionicons name="warning-outline" size={16} color={colors.accent_amber} />
            <AppText variant="muted" style={{ flex: 1, color: colors.accent_amber }}>This card is provisional: the fee statement is still being verified by the finance office.</AppText>
          </View>
        ) : null}
        {d.result === 'already_signed' && d.signed_at ? <AppText variant="muted">Signed by <AppText variant="bold">{d.signed_by_name}</AppText> on {formatDateTime(d.signed_at)}.</AppText> : null}
        {d.ok && d.signed_at ? <AppText variant="muted">{formatDateTime(d.signed_at)}</AppText> : null}
        {d.units.length > 0 ? <View><AppText variant="label" style={{ marginBottom: 6 }}>Their units</AppText><UnitRows units={d.units} current={d.unit?.id} /></View> : null}
      </Card>
    );
  }

  const d = outcome.data;
  const color = d.state === 'valid' ? colors.accent_green : d.state === 'provisional' ? colors.accent_amber : colors.accent_red;
  const title = d.state === 'valid' ? 'GENUINE CARD' : d.state === 'provisional' ? 'PROVISIONAL CARD' : d.state === 'revoked' ? 'CARD REVOKED' : d.state === 'expired' ? 'CARD EXPIRED' : 'NOT RECOGNISED';
  return (
    <Card style={{ borderColor: color, gap: SPACING.md }}>
      <AppText style={{ fontFamily: FONTS.heading, fontSize: 17, color }}>{title}</AppText>
      {d.student ? <StudentLine s={d.student} /> : null}
      {d.message ? <AppText>{d.message}</AppText> : null}
      {d.valid ? (
        <View>
          <AppText variant="label" style={{ marginBottom: 6 }}>Units this student may sit</AppText>
          <UnitRows units={d.units ?? []} signable busy={busy} onSign={(u) => onSign(outcome, u)} />
        </View>
      ) : null}
    </Card>
  );
}
