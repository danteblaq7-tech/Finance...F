import { Router } from 'express';
import { z } from 'zod';
import { bind, query, queryOne, withTransaction } from '../db.js';
import { isStaff, requireAuth } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { notifyTicketOwner } from '../notifications.js';
import { classifyTicket } from '../classifier.js';
import { uuidSchema } from '../validation.js';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { auditStaffAction } from '../auditLog.js';

const router = Router();
router.use(requireAuth);
const limit = (perWindow) => rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: config.nodeEnv === 'test' ? 1000 : perWindow,
  keyGenerator: (req) => req.user.id,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});
const ticketCreateLimiter = limit(10);
const classificationLimiter = limit(20);

const ISSUE_TYPES = ['fee_dispute', 'payment_plan', 'sponsorship', 'helb', 'bursary', 'fee_statement', 'other'];

const createSchema = z.object({
  issueType: z.enum(ISSUE_TYPES),
  description: z.string().trim().min(10, 'Please describe the issue (at least 10 characters).').max(4000),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  slotId: z.string().uuid().optional(),
});

const staffUpdateSchema = z
  .object({
    issueType: z.enum(ISSUE_TYPES),
    status: z.enum(['pending', 'in_review', 'resolved', 'cancelled']),
    priority: z.enum(['low', 'medium', 'high']),
    response: z.string().trim().min(1, 'Response cannot be empty.').max(4000),
    assignedStaffId: z.string().uuid().nullable(),
  })
  .partial();

const SELECT = `SELECT t.id, t.student_id, t.student_name, t.issue_type, t.description,
                       t.attachment_url, t.priority, t.status, t.appointment_slot,
                       t.appointment_slot_id, t.assigned_staff_id, t.created_at,
                       t.updated_at, t.attended_at, t.attended_by, t.resolved_at, t.closed_at,
                       u.student_id AS student_number, assigned.name AS assigned_staff_name,
                       attendee.name AS attended_by_name
                FROM tickets t
                JOIN profiles u ON u.id = t.student_id
                LEFT JOIN profiles assigned ON assigned.id = t.assigned_staff_id
                LEFT JOIN profiles attendee ON attendee.id = t.attended_by`;

async function loadTicket(id, user) {
  id = uuidSchema.parse(id);
  const t = await queryOne(`${SELECT} WHERE t.id = $1`, [id]);
  // 404 (not 403) for other students' tickets so ids can't be probed.
  if (!t || (!isStaff(user) && t.student_id !== user.id)) throw new HttpError(404, 'Ticket not found.');
  const responses = await query(
    `SELECT r.id, r.ticket_id, r.author_id, r.body, r.created_at, author.name AS author_name
     FROM ticket_responses r
     LEFT JOIN profiles author ON author.id = r.author_id
     WHERE r.ticket_id = $1
     ORDER BY r.created_at ASC, r.id ASC`,
    [id],
  );
  const classification = isStaff(user)
    ? await queryOne(
        `SELECT suggested_category, suggested_priority, rationale,
                provider_name, created_at AS timestamp
         FROM ticket_classification_recommendations
         WHERE ticket_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [id],
      )
    : null;
  return { ...t, responses, ...(classification ? { classification } : {}) };
}

router.get(
  '/',
  ticketCreateLimiter,
  classificationLimiter,
  asyncHandler(async (req, res) => {
    const { status, assignedTo } = z.object({
      status: z.enum(['pending', 'in_review', 'resolved', 'cancelled']).optional(),
      assignedTo: z.literal('me').optional(),
    }).parse(req.query);
    if (assignedTo && !isStaff(req.user)) throw new HttpError(403, 'Staff access only.');
    const where = [];
    const params = [];
    if (!isStaff(req.user)) where.push(`t.student_id = ${bind(params, req.user.id)}`);
    if (status) where.push(`t.status = ${bind(params, status)}`);
    if (assignedTo) where.push(`t.assigned_staff_id = ${bind(params, req.user.id)}`);
    const rows = await query(
      `${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, t.created_at DESC LIMIT 500`,
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
    const classification = await classifyTicket({ issueType: b.issueType, description: b.description });
    const priority = classification.providerName === 'fallback' ? 'medium' : b.priority;
    const id = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO tickets (id, student_id, student_name, issue_type, description, priority)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, req.user.id, req.user.name, b.issueType, b.description, priority],
      );
      await client.query(
        `INSERT INTO ticket_classification_recommendations
           (ticket_id, suggested_category, suggested_priority, rationale, provider_name)
         VALUES ($1,$2,$3,$4,$5)`,
        [id, classification.suggestedCategory, classification.suggestedPriority, classification.rationale, classification.providerName],
      );
      if (b.slotId) {
        await client.query('SELECT book_slot($1,$2,$3,$4)', [b.slotId, req.user.id, req.user.name, id]);
      }
    });
    if (b.slotId) notifyTicketOwner(id, 'appointment_confirmed', req.user.id);
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
      const hadAppointment = await withTransaction(async (client) => {
        const { rows: [locked] } = await client.query(
          'SELECT status, appointment_slot_id FROM tickets WHERE id = $1 FOR UPDATE',
          [ticket.id],
        );
        if (!locked || !['pending', 'in_review'].includes(locked.status)) {
          throw new HttpError(409, 'This ticket can no longer be cancelled.');
        }
        if (locked.appointment_slot_id) await client.query('SELECT unbook_slot($1)', [locked.appointment_slot_id]);
        await client.query('UPDATE tickets SET status = $1 WHERE id = $2', [status, ticket.id]);
        return Boolean(locked.appointment_slot_id);
      });
      if (hadAppointment) notifyTicketOwner(ticket.id, 'appointment_cancelled', req.user.id);
      return res.json({ ticket: await loadTicket(ticket.id, req.user) });
    }

    const b = staffUpdateSchema.parse(req.body);
    if (b.assignedStaffId !== undefined && req.user.role !== 'admin') {
      throw new HttpError(403, 'Only admins can assign tickets.');
    }
    if (b.status === 'cancelled' && b.response !== undefined) {
      throw new HttpError(409, 'A cancelled ticket cannot receive a response.');
    }
    const sets = [];
    const params = [];
    if (b.issueType !== undefined) sets.push(`issue_type = ${bind(params, b.issueType)}`);
    if (b.status !== undefined) sets.push(`status = ${bind(params, b.status)}`);
    if (b.priority !== undefined) sets.push(`priority = ${bind(params, b.priority)}`);
    if (b.assignedStaffId !== undefined) sets.push(`assigned_staff_id = ${bind(params, b.assignedStaffId)}`);
    // Picking up a ticket (moving it forward or responding) assigns it to that staff member.
    // That is what counts the ticket as "attended" on the dashboard.
    const touched = (b.status !== undefined && b.status !== 'pending') || b.response !== undefined;
    if (!sets.length && b.response === undefined) throw new HttpError(400, 'Nothing to update.');
    const hadAppointment = await withTransaction(async (client) => {
      const { rows: [locked] } = await client.query(
        'SELECT status, assigned_staff_id, appointment_slot_id FROM tickets WHERE id = $1 FOR UPDATE',
        [ticket.id],
      );
      if (!locked) throw new HttpError(404, 'Ticket not found.');
      if (locked.status === 'cancelled') throw new HttpError(409, 'This ticket is cancelled and cannot be changed.');
      if (b.assignedStaffId && b.assignedStaffId !== locked.assigned_staff_id) {
        const { rows: [assignee] } = await client.query(
          "SELECT role, is_active FROM profiles WHERE id = $1 FOR SHARE",
          [b.assignedStaffId],
        );
        if (!assignee || assignee.role !== 'staff' || !assignee.is_active) {
          throw new HttpError(400, 'Choose an active finance staff account.');
        }
      }
      if (b.status === 'cancelled' && locked.appointment_slot_id) {
        await client.query('SELECT unbook_slot($1)', [locked.appointment_slot_id]);
      }
      const updateSets = [...sets];
      const updateParams = [...params];
      if (b.assignedStaffId !== undefined && b.assignedStaffId !== locked.assigned_staff_id) {
        await auditStaffAction(client, {
          actorId: req.user.id,
          action: 'ticket_assignment_changed',
          entityType: 'ticket',
          entityId: ticket.id,
          metadata: { fromStaffId: locked.assigned_staff_id, toStaffId: b.assignedStaffId },
        });
      }
      if (touched && b.assignedStaffId === undefined && !locked.assigned_staff_id) {
        updateSets.push(`assigned_staff_id = ${bind(updateParams, req.user.id)}`);
      }
      if (touched) updateSets.push(`attended_by = COALESCE(attended_by, ${bind(updateParams, req.user.id)})`);
      if (updateSets.length) {
        await client.query(`UPDATE tickets SET ${updateSets.join(', ')} WHERE id = ${bind(updateParams, ticket.id)}`, updateParams);
      }
      if (b.response !== undefined) {
        const { rows: [response] } = await client.query(
          'INSERT INTO ticket_responses (ticket_id, author_id, body) VALUES ($1, $2, $3) RETURNING id',
          [ticket.id, req.user.id, b.response],
        );
        await auditStaffAction(client, {
          actorId: req.user.id,
          action: 'ticket_response_added',
          entityType: 'ticket',
          entityId: ticket.id,
          metadata: { responseId: response.id },
        });
      }
      return Boolean(locked.appointment_slot_id && b.status === 'cancelled');
    });
    if (b.response !== undefined) notifyTicketOwner(ticket.id, 'ticket_response', req.user.id);
    if (hadAppointment) notifyTicketOwner(ticket.id, 'appointment_cancelled', req.user.id);
    res.json({ ticket: await loadTicket(ticket.id, req.user) });
  }),
);

// Book an appointment slot for a ticket (atomic, via the book_slot SQL function).
router.post(
  '/:id/book',
  asyncHandler(async (req, res) => {
    const { slotId } = z.object({ slotId: z.string().uuid() }).parse(req.body);
    const ticket = await loadTicket(req.params.id, req.user);
    await withTransaction(async (client) => {
      const { rows: [locked] } = await client.query(
        'SELECT status, appointment_slot_id FROM tickets WHERE id = $1 FOR UPDATE',
        [ticket.id],
      );
      if (!locked || ['resolved', 'cancelled'].includes(locked.status)) throw new HttpError(409, 'This ticket is closed.');
      if (locked.appointment_slot_id) throw new HttpError(409, 'This ticket already has an appointment. Cancel it first.');
      await client.query('SELECT book_slot($1,$2,$3,$4)', [slotId, ticket.student_id, ticket.student_name, ticket.id]);
    });
    notifyTicketOwner(ticket.id, 'appointment_confirmed', req.user.id);
    res.json({ ticket: await loadTicket(ticket.id, req.user) });
  }),
);

router.patch(
  '/:id/booking',
  asyncHandler(async (req, res) => {
    const { slotId } = z.object({ slotId: z.string().uuid() }).parse(req.body);
    const ticket = await loadTicket(req.params.id, req.user);
    await withTransaction(async (client) => {
      const { rows: [locked] } = await client.query(
        'SELECT status, appointment_slot_id FROM tickets WHERE id = $1 FOR UPDATE',
        [ticket.id],
      );
      if (!locked || ['resolved', 'cancelled'].includes(locked.status)) throw new HttpError(409, 'This ticket is closed.');
      if (!locked.appointment_slot_id) throw new HttpError(409, 'There is no appointment to change.');
      if (locked.appointment_slot_id === slotId) throw new HttpError(409, 'Choose a different appointment slot.');
      await client.query('SELECT unbook_slot($1)', [locked.appointment_slot_id]);
      await client.query('SELECT book_slot($1,$2,$3,$4)', [slotId, ticket.student_id, ticket.student_name, ticket.id]);
    });
    notifyTicketOwner(ticket.id, 'appointment_changed', req.user.id);
    res.json({ ticket: await loadTicket(ticket.id, req.user) });
  }),
);

router.delete(
  '/:id/booking',
  asyncHandler(async (req, res) => {
    const ticket = await loadTicket(req.params.id, req.user);
    await withTransaction(async (client) => {
      const { rows: [locked] } = await client.query(
        'SELECT status, appointment_slot_id FROM tickets WHERE id = $1 FOR UPDATE',
        [ticket.id],
      );
      if (!locked || locked.status === 'cancelled') {
        throw new HttpError(409, 'This ticket is cancelled and cannot be changed.');
      }
      if (!locked.appointment_slot_id) throw new HttpError(409, 'No appointment to cancel.');
      await client.query('SELECT unbook_slot($1)', [locked.appointment_slot_id]);
    });
    notifyTicketOwner(ticket.id, 'appointment_cancelled', req.user.id);
    res.json({ ticket: await loadTicket(ticket.id, req.user) });
  }),
);

export default router;
