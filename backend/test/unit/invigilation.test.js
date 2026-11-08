// Rules for exam-hall sign-in (no database). Run: npm run test:unit
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { cardState, decideSign, extractCode } from '../../src/services/invigilation.js';

describe('extractCode', () => {
  test('reads the code from the QR link, a pasted link, or the bare code', () => {
    assert.equal(extractCode('https://finesse.ac.ke/verify/ab12cd34ef56'), 'AB12CD34EF56');
    assert.equal(extractCode('http://localhost:5173/verify/AB12CD34EF56/'), 'AB12CD34EF56');
    assert.equal(extractCode('https://x.ke/verify/AB12CD34EF56?from=qr#top'), 'AB12CD34EF56');
    assert.equal(extractCode('  ab12cd34ef56 '), 'AB12CD34EF56');
  });
  test('rejects anything that cannot be a code', () => {
    for (const bad of ['', '   ', null, undefined, 'short', 'has spaces in it', 'https://x.ke/other/AB12CD34EF56', 'AB12-CD34-EF56', 'A'.repeat(40)]) {
      assert.equal(extractCode(bad), null, String(bad));
    }
  });
});

describe('cardState', () => {
  const base = { today: '2026-11-25', exam_end_date: '2026-12-11', revoked_at: null, decision_source: 'fee_record', manually_approved_by: null };
  test('valid, provisional, expired, revoked (in that order of precedence: revoked first)', () => {
    assert.equal(cardState(base), 'valid');
    assert.equal(cardState({ ...base, decision_source: 'statement' }), 'provisional');
    assert.equal(cardState({ ...base, decision_source: 'statement', manually_approved_by: 'u1' }), 'valid');
    assert.equal(cardState({ ...base, today: '2026-12-12' }), 'expired');
    assert.equal(cardState({ ...base, today: '2026-12-11' }), 'valid', 'the last exam day still counts');
    assert.equal(cardState({ ...base, revoked_at: '2026-11-01', today: '2026-12-12' }), 'revoked');
  });
});

describe('decideSign', () => {
  const card = { student_name: 'Amina Hassan', exam_period_id: 'P1' };
  const unit = { id: 'U1', unit_code: 'CSC101', exam_period_id: 'P1', exam_date: null };
  const reg = { allowed: true, block_reason: null, signed_at: null };
  const lecturer = { role: 'lecturer' };
  const ok = { state: 'valid', card, unit, reg, user: lecturer, isAssigned: true, today: '2026-11-25' };
  const result = (over) => decideSign({ ...ok, ...over }).result;

  test('the happy path signs', () => {
    assert.deepEqual(decideSign(ok), { ok: true, result: 'signed', message: 'Amina Hassan signed in for CSC101.' });
    assert.equal(result({ state: 'provisional' }), 'signed', 'a provisional card may still sit (the screen warns about it)');
  });
  test('refusals, each with its own result code', () => {
    assert.equal(result({ state: 'revoked' }), 'card_invalid');
    assert.equal(result({ state: 'expired' }), 'card_invalid');
    assert.equal(result({ state: 'not_found' }), 'card_invalid');
    assert.equal(result({ unit: { ...unit, exam_period_id: 'P2' } }), 'wrong_period');
    assert.equal(result({ isAssigned: false }), 'not_your_unit');
    assert.equal(result({ reg: null }), 'not_registered');
    assert.equal(result({ reg: { ...reg, allowed: false, block_reason: 'Missing CAT marks' } }), 'barred');
    assert.match(decideSign({ ...ok, reg: { ...reg, allowed: false, block_reason: 'Missing CAT marks' } }).message, /Missing CAT marks/);
    assert.equal(result({ reg: { ...reg, signed_at: new Date() } }), 'already_signed');
    assert.equal(result({ unit: { ...unit, exam_date: '2026-11-26' } }), 'wrong_day');
    assert.equal(result({ unit: { ...unit, exam_date: '2026-11-25' } }), 'signed', 'right day');
  });
  test('staff and admins may sign any unit; lecturers only their own', () => {
    assert.equal(result({ user: { role: 'staff' }, isAssigned: false }), 'signed');
    assert.equal(result({ user: { role: 'admin' }, isAssigned: false }), 'signed');
    assert.equal(result({ user: lecturer, isAssigned: false }), 'not_your_unit');
  });
  test('the first failing rule wins: a revoked card beats "not registered"; "already signed" beats "wrong day"', () => {
    assert.equal(result({ state: 'revoked', reg: null }), 'card_invalid');
    assert.equal(result({ isAssigned: false, reg: null }), 'not_your_unit');
    assert.equal(result({ reg: { ...reg, signed_at: new Date() }, unit: { ...unit, exam_date: '2030-01-01' } }), 'already_signed');
  });
});
