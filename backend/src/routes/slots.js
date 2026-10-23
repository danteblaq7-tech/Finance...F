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
      `SELECT slot_date, SUM(is_booked = 0) AS free, COUNT(*) AS total
         FROM slots
        WHERE slot_date >= CURDATE() AND slot_date <= CURDATE() + INTERVAL ? DAY
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
    const rows = await query(
      `SELECT id, slot_date, start_time, end_time, display_time, is_booked, booked_by_name, ticket_id
         FROM slots WHERE slot_date = ? ORDER BY start_time`,
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
    await pool.query('CALL generate_slots_for_date(?)', [date]);
    res.status(201).json({ ok: true });
  }),
);

export default router;
