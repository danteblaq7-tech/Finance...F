import { Router } from 'express';
import { z } from 'zod';
import { pool, query } from '../db.js';
import { isStaff, requireAuth, requireStaff } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errors.js';
import { dateSchema } from '../validation.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/dates',
  asyncHandler(async (req, res) => {
    const days = z.coerce.number().int().min(1).max(60).default(60).parse(req.query.days);
    const rows = await query(
      `SELECT slot_date,
              count(*) FILTER (WHERE NOT is_booked AND start_time > (now() at time zone 'Africa/Nairobi')) AS free,
              count(*) FILTER (WHERE start_time > (now() at time zone 'Africa/Nairobi')) AS total
         FROM slots
        WHERE slot_date >= app_today() AND slot_date <= app_today() + $1::int
        GROUP BY slot_date
       HAVING count(*) FILTER (WHERE NOT is_booked AND start_time > (now() at time zone 'Africa/Nairobi')) > 0
        ORDER BY slot_date`,
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
        WHERE s.slot_date = $1
          AND ($2::boolean OR s.start_time > (now() at time zone 'Africa/Nairobi'))
        ORDER BY s.start_time`,
      [date, isStaff(req.user)],
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
    const { date, startTime } = z.object({
      date: dateSchema,
      startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Use a valid time in HH:MM format.'),
    }).parse(req.body);
    await pool.query('SELECT generate_slot_for_datetime($1, $2::time)', [date, startTime]);
    res.status(201).json({ ok: true });
  }),
);

export default router;
