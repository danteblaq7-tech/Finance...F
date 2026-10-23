import { Router } from 'express';
import { z } from 'zod';
import { pool, query, queryOne } from '../db.js';
import { isStaff, requireAuth } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';

const router = Router();
router.use(requireAuth);

const ISSUE_TYPES = ['fee_dispute', 'payment_plan', 'sponsorship', 'helb', 'bursary', 'fee_statement', 'other'];

const createSchema = z.object({
  issueType: z.enum(ISSUE_TYPES),
  description: z.string().trim().min(10, 'Please describe the issue (at least 10 characters).').max(4000),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
});

const staffUpdateSchema = z
  .object({
    status: z.enum(['pending', 'in_review', 'resolved', 'cancelled']),
    priority: z.enum(['low', 'medium', 'high']),
    staffNotes: z.string().max(4000),
    assignedStaffId: z.string().uuid().nullable(),
  })
  .partial();

const SELECT = `SELECT t.*, u.student_id AS student_number FROM tickets t JOIN users u ON u.id = t.student_id`;

async function loadTicket(id, user) {
  const t = await queryOne(`${SELECT} WHERE t.id = ?`, [id]);
  // 404 (not 403) for other students' tickets so ids can't be probed.
  if (!t || (!isStaff(user) && t.student_id !== user.id)) throw new HttpError(404, 'Ticket not found.');
  return t;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const status = z.enum(['pending', 'in_review', 'resolved', 'cancelled']).optional().parse(req.query.status);
    const where = [];
    const params = [];
    if (!isStaff(req.user)) {
      where.push('t.student_id = ?');
      params.push(req.user.id);
    }
    if (status) {
      where.push('t.status = ?');
      params.push(status);
    }
    const rows = await query(
      `${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY FIELD(t.priority,'high','medium','low'), t.created_at DESC LIMIT 500`,
      params,
    );
    res.json({ tickets: rows });
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'student') throw new HttpError(403, 'Only students can raise tickets.');
    const b = createSchema.parse(req.body);
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO tickets (id, student_id, student_name, issue_type, description, priority, staff_notes)
       VALUES (?,?,?,?,?,?, '')`,
      [id, req.user.id, req.user.name, b.issueType, b.description, b.priority],
    );
    res.status(201).json({ ticket: await loadTicket(id, req.user) });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => res.json({ ticket: await loadTicket(req.params.id, req.user) })),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const ticket = await loadTicket(req.params.id, req.user);

    if (!isStaff(req.user)) {
      // Students may only cancel their own open ticket.
      const { status } = z.object({ status: z.literal('cancelled') }).parse(req.body);
      if (!['pending', 'in_review'].includes(ticket.status)) throw new HttpError(409, 'This ticket can no longer be cancelled.');
      if (ticket.appointment_slot_id) {
        await pool.query('CALL unbook_slot(?)', [ticket.appointment_slot_id]);
      }
      await query('UPDATE tickets SET status = ? WHERE id = ?', [status, ticket.id]);
      return res.json({ ticket: await loadTicket(ticket.id, req.user) });
    }

    const b = staffUpdateSchema.parse(req.body);
    const sets = [];
    const params = [];
    if (b.status !== undefined) { sets.push('status = ?'); params.push(b.status); }
    if (b.priority !== undefined) { sets.push('priority = ?'); params.push(b.priority); }
    if (b.staffNotes !== undefined) { sets.push('staff_notes = ?'); params.push(b.staffNotes); }
    if (b.assignedStaffId !== undefined) { sets.push('assigned_staff_id = ?'); params.push(b.assignedStaffId); }
    // Picking up a pending ticket assigns it to whoever moved it forward.
    if (b.status === 'in_review' && b.assignedStaffId === undefined && !ticket.assigned_staff_id) {
      sets.push('assigned_staff_id = ?');
      params.push(req.user.id);
    }
    if (!sets.length) throw new HttpError(400, 'Nothing to update.');
    await query(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`, [...params, ticket.id]);
    res.json({ ticket: await loadTicket(ticket.id, req.user) });
  }),
);

// Book an appointment slot for a ticket (atomic, via the book_slot stored procedure).
router.post(
  '/:id/book',
  asyncHandler(async (req, res) => {
    const { slotId } = z.object({ slotId: z.string().uuid() }).parse(req.body);
    const ticket = await loadTicket(req.params.id, req.user);
    if (['resolved', 'cancelled'].includes(ticket.status)) throw new HttpError(409, 'This ticket is closed.');
    if (ticket.appointment_slot_id) throw new HttpError(409, 'This ticket already has an appointment. Cancel it first.');
    await pool.query('CALL book_slot(?,?,?,?)', [slotId, ticket.student_id, ticket.student_name, ticket.id]);
    res.json({ ticket: await loadTicket(ticket.id, req.user) });
  }),
);

router.delete(
  '/:id/booking',
  asyncHandler(async (req, res) => {
    const ticket = await loadTicket(req.params.id, req.user);
    if (!ticket.appointment_slot_id) throw new HttpError(409, 'No appointment to cancel.');
    await pool.query('CALL unbook_slot(?)', [ticket.appointment_slot_id]);
    res.json({ ticket: await loadTicket(ticket.id, req.user) });
  }),
);

export default router;
