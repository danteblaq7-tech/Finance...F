import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, withTransaction } from '../db.js';
import {
  PUBLIC_USER_COLUMNS, requireAdmin, requireAuth, requireInvigilator, requireStaff, requireStudent,
} from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { cardState, decideSign, extractCode } from '../services/invigilation.js';
import { supabaseAdmin } from '../supabase.js';

// Exam-hall sign-in. Three routers:
//   invigilationRouter  /api/invigilation   scan a card (see the student's units) and sign a unit
//   unitsRouter         /api/exam-units     set up units + registrations (staff), see a unit's register (lecturers: their own)
//   lecturersRouter     /api/lecturers      list lecturers (staff) and create their logins (admin)

// ── helpers ──────────────────────────────────────────────────────────────

const UNIT_COLUMNS = 'u.id, u.exam_period_id, u.unit_code, u.unit_name, u.exam_date, u.start_time, u.end_time, u.venue';

/** The exam period to work in: the one asked for, else the active period nearest to today (running now, then upcoming, then latest). */
async function resolvePeriod(periodId) {
  const cols = 'p.id, p.title, p.academic_year, p.semester, p.exam_start_date, p.exam_end_date';
  if (periodId) return queryOne(`SELECT ${cols} FROM exam_periods p WHERE p.id = $1`, [periodId]);
  return queryOne(
    `SELECT ${cols} FROM exam_periods p WHERE p.is_active
      ORDER BY CASE WHEN app_today() BETWEEN p.exam_start_date AND p.exam_end_date THEN 0
                    WHEN p.exam_start_date > app_today() THEN 1 ELSE 2 END,
               abs(p.exam_start_date - app_today())
      LIMIT 1`,
  );
}

const isAssignedTo = async (unitId, userId) =>
  !!(await queryOne('SELECT 1 FROM exam_unit_lecturers WHERE exam_unit_id = $1 AND lecturer_id = $2', [unitId, userId]));

/** The issued card behind a verification code (with the exam period's dates), or null. */
const loadCard = (code) =>
  queryOne(
    `SELECT a.student_name, a.student_id, a.course, a.year_of_study, a.exam_period_id, a.revoked_at, a.decision_source,
            a.manually_approved_by, p.title AS period_title, p.exam_end_date, (SELECT app_today()) AS today
       FROM exam_card_applications a JOIN exam_periods p ON p.id = a.exam_period_id
      WHERE a.verification_code = $1 AND a.status = 'issued'`,
    [code],
  );

/** The units this student is registered for in the card's exam period, and whether the caller may sign each. */
const unitsForCard = (card, user) =>
  query(
    `SELECT ${UNIT_COLUMNS}, r.id AS registration_id, r.allowed, r.block_reason, r.signed_at, r.signed_by_name,
            CASE WHEN $3 <> 'lecturer' THEN true
                 ELSE EXISTS (SELECT 1 FROM exam_unit_lecturers ul WHERE ul.exam_unit_id = u.id AND ul.lecturer_id = $4) END AS can_sign
       FROM unit_registrations r JOIN exam_units u ON u.id = r.exam_unit_id
      WHERE u.exam_period_id = $1 AND r.student_id = $2
      ORDER BY u.exam_date NULLS LAST, u.start_time NULLS LAST, u.unit_code`,
    [card.exam_period_id, card.student_id, user.role, user.id],
  );

const studentOf = (card) => ({ name: card.student_name, student_id: card.student_id, course: card.course, year_of_study: card.year_of_study });

// ── scanning ─────────────────────────────────────────────────────────────

export const invigilationRouter = Router();
invigilationRouter.use(requireAuth, requireInvigilator);

// Scan a card: who is it, is it genuine, and which units may they sit?
invigilationRouter.get(
  '/card/:code',
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const code = extractCode(req.params.code);
    const card = code ? await loadCard(code) : null;
    if (!card) return res.json({ state: 'not_found', valid: false, message: 'Exam card not recognised.' });
    const state = cardState(card);
    res.json({
      state,
      valid: state === 'valid' || state === 'provisional',
      student: studentOf(card),
      period: { id: card.exam_period_id, title: card.period_title },
      units: await unitsForCard(card, req.user),
    });
  }),
);

// Sign one unit for the scanned student. The UPDATE is the lock: only one caller can ever flip signed_at from NULL.
invigilationRouter.post(
  '/sign',
  asyncHandler(async (req, res) => {
    const { code: raw, unitId } = z.object({ code: z.string().trim().min(1).max(300), unitId: z.string().uuid() }).parse(req.body);
    const unit = await queryOne(`SELECT ${UNIT_COLUMNS} FROM exam_units u WHERE u.id = $1`, [unitId]);
    if (!unit) throw new HttpError(404, 'Unit not found.');

    const code = extractCode(raw);
    const card = code ? await loadCard(code) : null;
    if (!card) return res.json({ ok: false, result: 'card_invalid', state: 'not_found', message: 'Exam card not recognised.', unit, units: [] });

    const state = cardState(card);
    const reply = async (decision, extra = {}) =>
      res.json({ ...decision, state, provisional: state === 'provisional', student: studentOf(card), unit, units: await unitsForCard(card, req.user), ...extra });

    const regOf = () => queryOne('SELECT * FROM unit_registrations WHERE exam_unit_id = $1 AND student_id = $2', [unit.id, card.student_id]);
    let reg = await regOf();
    const decision = decideSign({
      state, card, unit, reg, user: req.user, today: card.today,
      isAssigned: req.user.role !== 'lecturer' || (await isAssignedTo(unit.id, req.user.id)),
    });
    if (!decision.ok) {
      return reply(decision, reg?.signed_at ? { signed_at: reg.signed_at, signed_by_name: reg.signed_by_name } : {});
    }

    const signed = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE unit_registrations SET signed_at = now(), signed_by = $2, signed_by_name = $3
          WHERE id = $1 AND signed_at IS NULL AND allowed RETURNING signed_at`,
        [reg.id, req.user.id, req.user.name],
      );
      if (!rows[0]) return null; // someone else signed (or barred) it in the meantime
      await client.query(`INSERT INTO unit_sign_log (registration_id, action, by_user, by_name) VALUES ($1, 'signed', $2, $3)`, [reg.id, req.user.id, req.user.name]);
      return rows[0];
    });

    if (!signed) {
      reg = await regOf();
      return reply(decideSign({ state, card, unit, reg, user: req.user, today: card.today, isAssigned: true }),
        reg?.signed_at ? { signed_at: reg.signed_at, signed_by_name: reg.signed_by_name } : {});
    }
    return reply(decision, { signed_at: signed.signed_at, signed_by_name: req.user.name });
  }),
);

// ── units, registrations, registers ──────────────────────────────────────

export const unitsRouter = Router();
unitsRouter.use(requireAuth);

// A student's own units (so the apps can list them next to the exam card).
unitsRouter.get(
  '/mine',
  requireStudent,
  asyncHandler(async (req, res) => {
    const period = await resolvePeriod(typeof req.query.periodId === 'string' ? req.query.periodId : undefined);
    if (!period || !req.user.student_id) return res.json({ period, units: [] });
    const units = await query(
      `SELECT ${UNIT_COLUMNS}, r.allowed, r.block_reason, r.signed_at
         FROM unit_registrations r JOIN exam_units u ON u.id = r.exam_unit_id
        WHERE u.exam_period_id = $1 AND r.student_id = $2
        ORDER BY u.exam_date NULLS LAST, u.start_time NULLS LAST, u.unit_code`,
      [period.id, req.user.student_id],
    );
    res.json({ period, units });
  }),
);

unitsRouter.use(requireInvigilator);

// Units of an exam period with their counts. Lecturers only get the units they are assigned.
unitsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { periodId } = z.object({ periodId: z.string().uuid().optional() }).parse(req.query);
    const period = await resolvePeriod(periodId);
    if (!period) return res.json({ period: null, units: [] });
    const lecturerOnly = req.user.role === 'lecturer';
    const units = await query(
      `SELECT ${UNIT_COLUMNS},
              (SELECT count(*) FROM unit_registrations r WHERE r.exam_unit_id = u.id) AS registered,
              (SELECT count(*) FROM unit_registrations r WHERE r.exam_unit_id = u.id AND r.signed_at IS NOT NULL) AS signed,
              (SELECT coalesce(json_agg(json_build_object('id', l.id, 'name', l.name, 'email', l.email) ORDER BY l.name), '[]'::json)
                 FROM exam_unit_lecturers ul JOIN profiles l ON l.id = ul.lecturer_id WHERE ul.exam_unit_id = u.id) AS lecturers
         FROM exam_units u
        WHERE u.exam_period_id = $1
          AND ($2::boolean = false OR EXISTS (SELECT 1 FROM exam_unit_lecturers ul WHERE ul.exam_unit_id = u.id AND ul.lecturer_id = $3))
        ORDER BY u.exam_date NULLS LAST, u.start_time NULLS LAST, u.unit_code`,
      [period.id, lecturerOnly, req.user.id],
    );
    res.json({ period, units });
  }),
);

// ---- bulk set-up (staff / admin). The web app sends big files in batches of up to 5,000 rows.

const text = (max) => z.string().trim().max(max).default('');
const unitCode = z.string().trim().min(1).max(40).transform((s) => s.toUpperCase().replace(/\s+/g, ' '));
const studentId = z.string().trim().min(1).max(40).transform((s) => s.toUpperCase());
const optDate = z.string().trim().default('')
  .refine((v) => v === '' || (/^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v)), 'Use the date format YYYY-MM-DD')
  .transform((v) => v || null);
const optTime = z.string().trim().default('')
  .refine((v) => v === '' || /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(v), 'Use the time format HH:MM')
  .transform((v) => v || null);

const unitsImportSchema = z.object({
  periodId: z.string().uuid(),
  rows: z.array(z.object({
    unit_code: unitCode,
    unit_name: text(150),
    exam_date: optDate,
    start_time: optTime,
    end_time: optTime,
    venue: text(150),
    lecturers: z.array(z.string().trim().toLowerCase().email()).max(20).default([]),
  })).min(1).max(5000),
});

// Create / update the units of an exam period (date, time, venue) and link lecturers by e-mail.
unitsRouter.post(
  '/import',
  requireStaff,
  asyncHandler(async (req, res) => {
    const b = unitsImportSchema.parse(req.body);
    if (!(await queryOne('SELECT 1 FROM exam_periods WHERE id = $1', [b.periodId]))) throw new HttpError(404, 'Exam period not found.');

    const unique = [...new Map(b.rows.map((r) => [r.unit_code, r])).values()]; // same unit twice: the last line wins
    const lecturerRows = await query("SELECT id, lower(email) AS email FROM profiles WHERE role = 'lecturer'");
    const lecturerByEmail = new Map(lecturerRows.map((l) => [l.email, l.id]));
    const unknownLecturers = new Set();
    let created = 0;
    let linked = 0;

    await withTransaction(async (client) => {
      for (const r of unique) {
        const { rows } = await client.query(
          `INSERT INTO exam_units (exam_period_id, unit_code, unit_name, exam_date, start_time, end_time, venue)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (exam_period_id, unit_code) DO UPDATE SET
             unit_name  = CASE WHEN EXCLUDED.unit_name <> '' THEN EXCLUDED.unit_name ELSE exam_units.unit_name END,
             exam_date  = COALESCE(EXCLUDED.exam_date,  exam_units.exam_date),
             start_time = COALESCE(EXCLUDED.start_time, exam_units.start_time),
             end_time   = COALESCE(EXCLUDED.end_time,   exam_units.end_time),
             venue      = COALESCE(NULLIF(EXCLUDED.venue, ''), exam_units.venue)
           RETURNING id, (xmax = 0) AS inserted`,
          [b.periodId, r.unit_code, r.unit_name, r.exam_date, r.start_time, r.end_time, r.venue],
        );
        if (rows[0].inserted) created += 1;
        if (r.lecturers.length) {
          // A lecturers column in the file REPLACES that unit's lecturers; an empty cell leaves them as they are.
          await client.query('DELETE FROM exam_unit_lecturers WHERE exam_unit_id = $1', [rows[0].id]);
          for (const email of new Set(r.lecturers)) {
            const lid = lecturerByEmail.get(email);
            if (!lid) { unknownLecturers.add(email); continue; }
            await client.query('INSERT INTO exam_unit_lecturers (exam_unit_id, lecturer_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [rows[0].id, lid]);
            linked += 1;
          }
        }
      }
    });
    res.status(201).json({ units: unique.length, created, lecturersLinked: linked, unknownLecturers: [...unknownLecturers] });
  }),
);

const REG_CHUNK = 2000;
const registrationsImportSchema = z.object({
  periodId: z.string().uuid(),
  rows: z.array(z.object({
    student_id: studentId,
    unit_code: unitCode,
    unit_name: text(150),
    allowed: z.boolean().optional(),   // leave out to keep whatever is already recorded
    reason: text(300),
  })).min(1).max(5000),
});

// Register students for units (creating any unit the file mentions that does not exist yet).
// Re-importing never un-signs anyone, and a row without an "allowed" value never overrides a bar set in the app.
unitsRouter.post(
  '/registrations/import',
  requireStaff,
  asyncHandler(async (req, res) => {
    const b = registrationsImportSchema.parse(req.body);
    if (!(await queryOne('SELECT 1 FROM exam_periods WHERE id = $1', [b.periodId]))) throw new HttpError(404, 'Exam period not found.');

    const regs = [...new Map(b.rows.map((r) => [`${r.unit_code}\u0000${r.student_id}`, r])).values()];
    const names = new Map();
    for (const r of b.rows) if (r.unit_name) names.set(r.unit_code, r.unit_name);
    const codes = [...new Set(b.rows.map((r) => r.unit_code))];
    let unitsCreated = 0;
    let added = 0;

    await withTransaction(async (client) => {
      const u = await client.query(
        `INSERT INTO exam_units (exam_period_id, unit_code, unit_name)
         SELECT $1, v.c, v.n FROM unnest($2::text[], $3::text[]) AS v(c, n)
         ON CONFLICT (exam_period_id, unit_code) DO UPDATE SET
           unit_name = CASE WHEN EXCLUDED.unit_name <> '' THEN EXCLUDED.unit_name ELSE exam_units.unit_name END
         RETURNING (xmax = 0) AS inserted`,
        [b.periodId, codes, codes.map((c) => names.get(c) ?? '')],
      );
      unitsCreated = u.rows.filter((r) => r.inserted).length;

      const plain = regs.filter((r) => r.allowed === undefined);
      const explicit = regs.filter((r) => r.allowed !== undefined);
      for (let i = 0; i < plain.length; i += REG_CHUNK) {
        const part = plain.slice(i, i + REG_CHUNK);
        const r = await client.query(
          `INSERT INTO unit_registrations (exam_unit_id, student_id)
           SELECT eu.id, v.s FROM unnest($2::text[], $3::text[]) AS v(c, s)
             JOIN exam_units eu ON eu.exam_period_id = $1 AND eu.unit_code = v.c
           ON CONFLICT (exam_unit_id, student_id) DO NOTHING RETURNING 1`,
          [b.periodId, part.map((x) => x.unit_code), part.map((x) => x.student_id)],
        );
        added += r.rowCount;
      }
      for (let i = 0; i < explicit.length; i += REG_CHUNK) {
        const part = explicit.slice(i, i + REG_CHUNK);
        const r = await client.query(
          `INSERT INTO unit_registrations (exam_unit_id, student_id, allowed, block_reason)
           SELECT eu.id, v.s, v.a, CASE WHEN v.a THEN NULL ELSE NULLIF(v.r, '') END
             FROM unnest($2::text[], $3::text[], $4::boolean[], $5::text[]) AS v(c, s, a, r)
             JOIN exam_units eu ON eu.exam_period_id = $1 AND eu.unit_code = v.c
           ON CONFLICT (exam_unit_id, student_id) DO UPDATE SET allowed = EXCLUDED.allowed, block_reason = EXCLUDED.block_reason
           RETURNING (xmax = 0) AS inserted`,
          [b.periodId, part.map((x) => x.unit_code), part.map((x) => x.student_id), part.map((x) => x.allowed), part.map((x) => x.reason)],
        );
        added += r.rows.filter((x) => x.inserted).length;
      }
    });
    res.status(201).json({ rows: regs.length, added, unitsCreated });
  }),
);

// Who may sign a unit.
unitsRouter.put(
  '/:id/lecturers',
  requireStaff,
  asyncHandler(async (req, res) => {
    const { lecturerIds } = z.object({ lecturerIds: z.array(z.string().uuid()).max(50) }).parse(req.body);
    const ids = [...new Set(lecturerIds)];
    if (!(await queryOne('SELECT 1 FROM exam_units WHERE id = $1', [req.params.id]))) throw new HttpError(404, 'Unit not found.');
    if (ids.length) {
      const ok = await query("SELECT id FROM profiles WHERE role = 'lecturer' AND id = ANY($1::uuid[])", [ids]);
      if (ok.length !== ids.length) throw new HttpError(400, 'Every selected person must be a lecturer account.');
    }
    await withTransaction(async (client) => {
      await client.query('DELETE FROM exam_unit_lecturers WHERE exam_unit_id = $1', [req.params.id]);
      if (ids.length) {
        await client.query('INSERT INTO exam_unit_lecturers (exam_unit_id, lecturer_id) SELECT $1, unnest($2::uuid[])', [req.params.id, ids]);
      }
    });
    res.json({ ok: true });
  }),
);

// The register of one unit. Staff see any unit; a lecturer only the units they are assigned.
unitsRouter.get(
  '/:id/register',
  asyncHandler(async (req, res) => {
    const unit = await queryOne(`SELECT ${UNIT_COLUMNS} FROM exam_units u WHERE u.id = $1`, [req.params.id]);
    if (!unit) throw new HttpError(404, 'Unit not found.');
    if (req.user.role === 'lecturer' && !(await isAssignedTo(unit.id, req.user.id))) throw new HttpError(403, 'You are not assigned to this unit.');
    const rows = await query(
      `SELECT r.id, r.student_id, COALESCE(p.name, f.student_name, '') AS student_name, r.allowed, r.block_reason,
              r.signed_at, r.signed_by_name,
              EXISTS (SELECT 1 FROM exam_card_applications a
                       WHERE a.student_id = r.student_id AND a.exam_period_id = $2 AND a.status = 'issued' AND a.revoked_at IS NULL) AS has_card
         FROM unit_registrations r
         LEFT JOIN profiles p ON p.student_id = r.student_id
         LEFT JOIN LATERAL (SELECT student_name FROM fee_records WHERE student_id = r.student_id AND student_name IS NOT NULL
                             ORDER BY updated_at DESC LIMIT 1) f ON true
        WHERE r.exam_unit_id = $1
        ORDER BY r.student_id LIMIT 5000`,
      [unit.id, unit.exam_period_id],
    );
    res.json({ unit, rows });
  }),
);

// ---- corrections (staff / admin), each one recorded in unit_sign_log

// Bar a student from a unit, or let them back in.
unitsRouter.patch(
  '/registrations/:id',
  requireStaff,
  asyncHandler(async (req, res) => {
    const b = z.object({ allowed: z.boolean(), reason: z.string().trim().max(300).default('') }).parse(req.body);
    if (!b.allowed && b.reason.length < 3) throw new HttpError(400, 'Please record why this student is barred.');
    const row = await withTransaction(async (client) => {
      const { rows } = await client.query(
        'UPDATE unit_registrations SET allowed = $2, block_reason = $3 WHERE id = $1 RETURNING id, allowed, block_reason',
        [req.params.id, b.allowed, b.allowed ? null : b.reason],
      );
      if (!rows[0]) return null;
      await client.query('INSERT INTO unit_sign_log (registration_id, action, by_user, by_name, reason) VALUES ($1,$2,$3,$4,$5)',
        [req.params.id, b.allowed ? 'allowed' : 'barred', req.user.id, req.user.name, b.reason || null]);
      return rows[0];
    });
    if (!row) throw new HttpError(404, 'Registration not found.');
    res.json({ registration: row });
  }),
);

// Undo a signature (e.g. signed by mistake). The reason is mandatory and kept.
unitsRouter.post(
  '/registrations/:id/reset',
  requireStaff,
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: z.string().trim().min(5, 'Please record a reason.').max(300) }).parse(req.body);
    const row = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE unit_registrations SET signed_at = NULL, signed_by = NULL, signed_by_name = NULL
          WHERE id = $1 AND signed_at IS NOT NULL RETURNING id`,
        [req.params.id],
      );
      if (!rows[0]) return null;
      await client.query(`INSERT INTO unit_sign_log (registration_id, action, by_user, by_name, reason) VALUES ($1,'reset',$2,$3,$4)`,
        [req.params.id, req.user.id, req.user.name, reason]);
      return rows[0];
    });
    if (!row) throw new HttpError(404, 'Nothing to reset: that unit is not signed.');
    res.json({ ok: true });
  }),
);

// Remove a registration (wrong unit, student dropped it). A signed one is evidence, so it stays.
unitsRouter.delete(
  '/registrations/:id',
  requireStaff,
  asyncHandler(async (req, res) => {
    const row = await queryOne('DELETE FROM unit_registrations WHERE id = $1 AND signed_at IS NULL RETURNING id', [req.params.id]);
    if (!row) throw new HttpError(409, 'Not found, or already signed (reset the signature first).');
    res.json({ ok: true });
  }),
);

// ── lecturers ────────────────────────────────────────────────────────────

export const lecturersRouter = Router();
lecturersRouter.use(requireAuth, requireStaff);

lecturersRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const lecturers = await query(
      `SELECT p.id, p.name, p.email, p.created_at,
              (SELECT count(*) FROM exam_unit_lecturers ul WHERE ul.lecturer_id = p.id) AS units
         FROM profiles p WHERE p.role = 'lecturer' ORDER BY p.name`,
    );
    res.json({ lecturers });
  }),
);

// Lecturers have no student ID, so they cannot use the student sign-up. An admin creates the login instead
// and the lecturer changes the password after the first sign-in.
lecturersRouter.post(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const b = z.object({
      name: z.string().trim().min(2).max(150),
      email: z.string().trim().toLowerCase().email().max(190),
      password: z.string().min(8, 'Password must be at least 8 characters').max(100),
    }).parse(req.body);
    if (await queryOne('SELECT 1 FROM profiles WHERE lower(email) = $1', [b.email])) {
      throw new HttpError(409, 'An account with this email already exists.');
    }
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: b.email, password: b.password, email_confirm: true, user_metadata: { name: b.name },
    });
    if (error) {
      if (error.code === 'email_exists' || error.code === 'user_already_exists') throw new HttpError(409, 'An account with this email already exists.');
      if (error.code === 'weak_password') throw new HttpError(400, error.message || 'That password is too weak.');
      console.error('Supabase createUser failed:', error.code, error.message);
      throw new HttpError(502, 'Could not create the account right now. Please try again.');
    }
    // The sign-up trigger always makes a 'student'; promoting is a deliberate server-side step.
    const user = await queryOne(`UPDATE profiles SET role = 'lecturer' WHERE id = $1 RETURNING ${PUBLIC_USER_COLUMNS}`, [data.user.id]);
    if (!user) {
      await supabaseAdmin.auth.admin.deleteUser(data.user.id).catch(() => {});
      throw new HttpError(500, 'Account setup failed. Has database/supabase/schema.sql been applied? (npm run db:schema)');
    }
    res.status(201).json({ lecturer: user });
  }),
);
