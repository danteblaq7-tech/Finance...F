// Pure rules for exam-hall sign-in. No database or network in here, so they are easy to test (test/unit/invigilation.test.js).

export const CODE_RE = /^[A-Z0-9]{8,16}$/;

/**
 * The QR code on an exam card holds  https://<site>/verify/<CODE>.  Accept that, a pasted link, or the bare code.
 * Returns the upper-case code, or null when the text is not a plausible one.
 */
export function extractCode(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const fromUrl = s.match(/\/verify\/([A-Za-z0-9]{8,16})(?:[/?#].*)?$/);
  const code = (fromUrl ? fromUrl[1] : s).toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

/**
 * State of an ISSUED card: revoked → expired → provisional (statement not yet verified by finance) → valid.
 * `today` and `exam_end_date` are "YYYY-MM-DD" strings, so plain string comparison is correct.
 */
export function cardState(a) {
  if (a.revoked_at) return 'revoked';
  if (a.today > a.exam_end_date) return 'expired';
  return a.decision_source === 'statement' && !a.manually_approved_by ? 'provisional' : 'valid';
}

const no = (result, message) => ({ ok: false, result, message });

/**
 * Should this scan sign this unit?  Checked in this order, and the FIRST failure is the answer:
 *   card genuine and current → same exam period → this lecturer is assigned the unit → student registered for it →
 *   not barred → not already signed → (if the unit has a date) it is that day.
 * Staff and admins may sign any unit; lecturers only the units they are assigned.
 */
export function decideSign({ state, card, unit, reg, user, isAssigned, today }) {
  const who = card.student_name;
  if (state !== 'valid' && state !== 'provisional') {
    if (state === 'revoked') return no('card_invalid', 'This exam card has been revoked. Send the student to the finance office.');
    if (state === 'expired') return no('card_invalid', 'This exam card has expired.');
    return no('card_invalid', 'Exam card not recognised.');
  }
  if (unit.exam_period_id !== card.exam_period_id) {
    return no('wrong_period', `This card is for a different exam period than ${unit.unit_code}.`);
  }
  if (user.role === 'lecturer' && !isAssigned) {
    return no('not_your_unit', `You are not assigned to ${unit.unit_code}.`);
  }
  if (!reg) return no('not_registered', `${who} is not registered for ${unit.unit_code}.`);
  if (!reg.allowed) {
    return no('barred', `${who} is not allowed to sit ${unit.unit_code}${reg.block_reason ? `: ${reg.block_reason}` : '.'}`);
  }
  if (reg.signed_at) return no('already_signed', `${unit.unit_code} was already signed for ${who}.`);
  if (unit.exam_date && unit.exam_date !== today) {
    return no('wrong_day', `${unit.unit_code} is scheduled for ${unit.exam_date}, not today.`);
  }
  return { ok: true, result: 'signed', message: `${who} signed in for ${unit.unit_code}.` };
}
