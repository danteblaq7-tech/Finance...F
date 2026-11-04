import { Router } from 'express';
import { z } from 'zod';
import { pool, query } from '../db.js';
import { isStaff, requireAuth, requireStaff } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errors.js';

const router = Router();
router.use(requireAuth);

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

// Dates in the next N days that still have free slots.
router.get(
  '/dates',
  asyncHandler(async (req, res) => {
    const days = z.coerce.number().int().min(1).max(60).default(14).parse(req.query.days);
    const rows = await query(
      `SELECT slot_date,
              count(*) FILTER (WHERE NOT is_booked) AS free,
              count(*) AS total
         FROM slots
        WHERE slot_date >= app_today() AND slot_date <= app_today() + $1::int
        GROUP BY slot_date ORDER BY slot_date`,
      [days],
    );
    res.json({ dates: rows.map((r) => ({ date: r.slot_date, free: Number(r.free), total: Number(r.total) })) });
  }),
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const date = dateSchema.parse(req.query.date);
    // Who holds a slot lives in slot_bookings (staff-only data), joined in here for the staff view.
    const rows = await query(
      `SELECT s.id, s.slot_date, s.start_time, s.end_time, s.display_time, s.is_booked,
              b.booked_by_name, b.ticket_id
         FROM slots s LEFT JOIN slot_bookings b ON b.slot_id = s.id
        WHERE s.slot_date = $1 ORDER BY s.start_time`,
      [date],
    );
    // Students only learn whether a slot is taken, never who took it.
    const slots = isStaff(req.user) ? rows : rows.map(({ booked_by_name: _n, ticket_id: _t, ...s }) => s);
    res.json({ slots });
  }),
);

router.post(
  '/generate',
  requireStaff,
  asyncHandler(async (req, res) => {
    const { date } = z.object({ date: dateSchema }).parse(req.body);
    await pool.query('SELECT generate_slots_for_date($1)', [date]);
    res.status(201).json({ ok: true });
  }),
);

export default router;
