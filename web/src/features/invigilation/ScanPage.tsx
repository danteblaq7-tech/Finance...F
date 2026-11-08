import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, ShieldAlert, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge, Button, Empty, ErrorNote, PageHeader, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { TONE } from '@/lib/constants';
import type { CardLookup, CardUnit, ExamUnit, SignResult, SignResultCode, UnitPeriod } from '@/lib/types';
import { clock, cn, extractCode, formatDateTime } from '@/lib/utils';
import { QrScanner } from './QrScanner';

type Outcome =
  | { kind: 'sign'; data: SignResult }
  | { kind: 'card'; data: CardLookup; code: string }
  | { kind: 'error'; message: string };

interface Recent { at: number; student: string; unit: string; result: SignResultCode | 'looked_up' }

const UNIT_KEY = 'finesse_scan_unit';
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
const REPEAT_MS = 4000; // the same card held in front of the camera is read many times a second

const TONE_OF: Record<SignResultCode, string> = {
  signed: TONE.green, already_signed: TONE.amber, not_registered: TONE.red, barred: TONE.red,
  not_your_unit: TONE.red, card_invalid: TONE.red, wrong_day: TONE.amber, wrong_period: TONE.red,
};
const TITLE_OF: Record<SignResultCode, string> = {
  signed: 'SIGNED IN', already_signed: 'ALREADY SIGNED', not_registered: 'NOT REGISTERED', barred: 'NOT ALLOWED',
  not_your_unit: 'NOT YOUR UNIT', card_invalid: 'INVALID CARD', wrong_day: 'WRONG DAY', wrong_period: 'WRONG EXAM PERIOD',
};

function buzz(ok: boolean) {
  try { navigator.vibrate?.(ok ? 120 : [80, 60, 80]); } catch { /* not supported */ }
}

export function ScanPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const units = useQuery({ queryKey: ['scan-units'], queryFn: () => api.get<{ period: UnitPeriod | null; units: ExamUnit[] }>('/exam-units') });
  const [unitId, setUnitId] = useState(() => sessionStorage.getItem(UNIT_KEY) ?? '');
  const [auto, setAuto] = useState(true);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [manual, setManual] = useState('');
  const last = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const locked = useRef(false);

  const list = units.data?.units ?? [];
  // Keep a valid selection: forget a stale one, and pick the only unit automatically.
  useEffect(() => {
    if (!units.data) return;
    if (unitId && !list.some((u) => u.id === unitId)) setUnitId('');
    else if (!unitId && list.length === 1) setUnitId(list[0]!.id);
  }, [units.data, unitId, list]);
  useEffect(() => { if (unitId) sessionStorage.setItem(UNIT_KEY, unitId); }, [unitId]);
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
    if (!code) {
      setOutcome({ kind: 'error', message: 'That is not a Finesse exam-card code.' });
      buzz(false);
      return;
    }
    const now = Date.now();
    if (locked.current || (last.current.code === code && now - last.current.at < REPEAT_MS)) return;
    last.current = { code, at: now };
    if (auto && !unitId) {
      setOutcome({ kind: 'error', message: 'Choose the unit you are invigilating first.' });
      buzz(false);
      return;
    }
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

  // A staff member's phone camera app opens /verify/<code>; its "Open in scanner" button lands here with ?code=
  const fromLink = params.get('code');
  const handledLink = useRef(false);
  useEffect(() => {
    if (!fromLink || handledLink.current || !units.data) return;
    // With several units, wait until the lecturer has chosen one (the link stays in the address bar meanwhile).
    if (auto && !unitId) return;
    handledLink.current = true;
    void handle(fromLink);
    setParams({}, { replace: true });
  }, [fromLink, units.data, auto, unitId, handle, setParams]);

  async function signFromCard(o: Extract<Outcome, { kind: 'card' }>, u: CardUnit) {
    setBusy(true);
    try { await sign(o.code, u.id); } catch (e) { setOutcome({ kind: 'error', message: errorMessage(e) }); } finally { setBusy(false); }
  }

  return (
    <div>
      <PageHeader
        title="Scan exam cards"
        subtitle={units.data?.period ? `${units.data.period.title} · ${units.data.period.academic_year}, ${units.data.period.semester}` : 'Scan a card to check it and sign the unit.'}
      />
      {units.isLoading ? <Spinner /> : units.isError ? <ErrorNote error={units.error} /> : list.length === 0 ? (
        <Empty>No units are set up for you in the current exam period. Ask the finance office to assign your unit.</Empty>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="space-y-4">
            <div className="card space-y-3">
              <label className="block">
                <span className="label">Unit you are invigilating</span>
                <select className="input mt-1" value={unitId} onChange={(e) => setUnitId(e.target.value)} aria-label="Unit you are invigilating">
                  <option value="">Choose a unit…</option>
                  {list.map((u) => (
                    <option key={u.id} value={u.id}>{u.unit_code} · {u.unit_name || 'Unit'} ({u.signed}/{u.registered} signed)</option>
                  ))}
                </select>
              </label>
              {unit && (
                <p className="text-xs text-ink-secondary">
                  {[unit.exam_date, unit.start_time && clock(unit.start_time), unit.venue].filter(Boolean).join(' · ') || 'No date or venue set'}
                </p>
              )}
              <label className="flex items-center gap-2 text-xs text-ink-secondary">
                <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
                Sign automatically when a card is scanned
              </label>
            </div>
            <QrScanner onCode={(t) => void handle(t)} paused={busy} />
            <form
              className="flex gap-2"
              onSubmit={(e) => { e.preventDefault(); const v = manual; setManual(''); last.current = { code: '', at: 0 }; void handle(v); }}
            >
              <input className="input flex-1" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Or paste the card code / link" aria-label="Card code" autoComplete="off" />
              <Button type="submit" variant="secondary" loading={busy}>Check</Button>
            </form>
          </div>

          <div className="space-y-4">
            {outcome ? <OutcomeView outcome={outcome} busy={busy} onSign={signFromCard} /> : (
              <div className="card text-ink-secondary">Point the camera at a student's exam-card QR code. {auto ? 'The unit is signed as soon as the card is read.' : 'You will see their units first, then tap the one to sign.'}</div>
            )}
            {recent.length > 0 && (
              <div className="card">
                <h2 className="label mb-2">This session</h2>
                <ul className="divide-y divide-line">
                  {recent.map((r) => (
                    <li key={r.at} className="flex items-center justify-between gap-3 py-2 text-xs">
                      <span className="truncate font-bold">{r.student}</span>
                      <span className="flex shrink-0 items-center gap-2 text-ink-secondary">
                        {r.unit}
                        <Badge color={r.result === 'looked_up' ? TONE.teal : TONE_OF[r.result]}>{r.result === 'looked_up' ? 'CHECKED' : TITLE_OF[r.result]}</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StudentLine({ s }: { s: NonNullable<SignResult['student']> }) {
  return (
    <div>
      <div className="text-xl font-bold">{s.name}</div>
      <div className="text-ink-secondary">{[s.student_id, s.course, s.year_of_study && `Year ${s.year_of_study}`].filter(Boolean).join(' · ')}</div>
    </div>
  );
}

function UnitChips({ units, current }: { units: CardUnit[]; current?: string }) {
  if (units.length === 0) return <p className="text-ink-secondary">This student has no registered units in this exam period.</p>;
  return (
    <ul className="space-y-1.5">
      {units.map((u) => (
        <li key={u.id} className={cn('flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2 text-xs', u.id === current && 'border-line-active bg-bg-tertiary')}>
          <span><span className="font-bold">{u.unit_code}</span> <span className="text-ink-secondary">{u.unit_name}</span></span>
          {u.signed_at ? <Badge color={TONE.green}>SIGNED</Badge> : !u.allowed ? <Badge color={TONE.red}>NOT ALLOWED</Badge> : <Badge color={TONE.gray}>NOT YET</Badge>}
        </li>
      ))}
    </ul>
  );
}

function OutcomeView({ outcome, busy, onSign }: { outcome: Outcome; busy: boolean; onSign: (o: Extract<Outcome, { kind: 'card' }>, u: CardUnit) => void }) {
  if (outcome.kind === 'error') {
    return <div role="alert" className="card flex items-start gap-3 border-brand-red"><XCircle className="h-6 w-6 shrink-0 text-brand-red" aria-hidden /><p>{outcome.message}</p></div>;
  }

  if (outcome.kind === 'sign') {
    const d = outcome.data;
    const color = TONE_OF[d.result];
    const Icon = d.ok ? CheckCircle2 : d.result === 'already_signed' || d.result === 'wrong_day' ? Clock : ShieldAlert;
    return (
      <div className="card space-y-4" style={{ borderColor: color }} role="status" aria-live="polite">
        <div className="flex items-center gap-3" style={{ color }}>
          <Icon className="h-9 w-9 shrink-0" aria-hidden />
          <div>
            <div className="font-display text-lg font-black tracking-wide">{TITLE_OF[d.result]}</div>
            <div className="text-sm font-medium">{d.message}</div>
          </div>
        </div>
        {d.student && <StudentLine s={d.student} />}
        {d.provisional && (
          <p className="flex items-start gap-2 rounded-md border border-brand-amber px-3 py-2 text-xs text-brand-amber">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> This card is provisional: the fee statement is still being verified by the finance office.
          </p>
        )}
        {d.result === 'already_signed' && d.signed_at && (
          <p className="text-ink-secondary">Signed by <b>{d.signed_by_name}</b> on {formatDateTime(d.signed_at)}.</p>
        )}
        {d.ok && d.signed_at && <p className="text-ink-secondary">{formatDateTime(d.signed_at)}</p>}
        {d.units.length > 0 && <div><h3 className="label mb-2">Their units</h3><UnitChips units={d.units} current={d.unit?.id} /></div>}
      </div>
    );
  }

  const d = outcome.data;
  const color = d.state === 'valid' ? TONE.green : d.state === 'provisional' ? TONE.amber : TONE.red;
  return (
    <div className="card space-y-4" style={{ borderColor: color }}>
      <div className="font-display text-lg font-black tracking-wide" style={{ color }}>
        {d.state === 'valid' ? 'GENUINE CARD' : d.state === 'provisional' ? 'PROVISIONAL CARD' : d.state === 'revoked' ? 'CARD REVOKED' : d.state === 'expired' ? 'CARD EXPIRED' : 'NOT RECOGNISED'}
      </div>
      {d.student && <StudentLine s={d.student} />}
      {d.message && <p>{d.message}</p>}
      {d.valid && (
        <div>
          <h3 className="label mb-2">Units this student may sit</h3>
          {(d.units ?? []).length === 0 ? <p className="text-ink-secondary">No registered units in this exam period.</p> : (
            <ul className="space-y-1.5">
              {d.units!.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2 text-xs">
                  <span><span className="font-bold">{u.unit_code}</span> <span className="text-ink-secondary">{u.unit_name}</span></span>
                  {u.signed_at ? <Badge color={TONE.green}>SIGNED</Badge>
                    : !u.allowed ? <Badge color={TONE.red}>{u.block_reason ? `NOT ALLOWED: ${u.block_reason}` : 'NOT ALLOWED'}</Badge>
                      : u.can_sign ? <Button className="!px-3 !py-1" loading={busy} onClick={() => onSign(outcome, u)}>Sign</Button>
                        : <Badge color={TONE.gray}>NOT YOURS</Badge>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
