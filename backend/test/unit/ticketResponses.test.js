// Exercises ticket response history over HTTP with authentication and Postgres replaced by fakes.
//   node --experimental-test-module-mocks --test test/unit/ticketResponses.test.js
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, mock, test } from 'node:test';

process.env.NODE_ENV = 'test';

const src = (p) => new URL(`../../src/${p}`, import.meta.url).href;
const STUDENT = { id: '11111111-1111-4111-8111-111111111111', name: 'Student', role: 'student' };
const STAFF = { id: '22222222-2222-4222-8222-222222222222', name: 'Finance Officer', role: 'staff' };
const STAFF_TWO = { id: '44444444-4444-4444-8444-444444444444', name: 'Grace Otieno', role: 'staff' };
const ADMIN = { id: '55555555-5555-4555-8555-555555555555', name: 'Campus Admin', role: 'admin' };
const LECTURER = { id: '66666666-6666-4666-8666-666666666666', name: 'Lecturer', role: 'lecturer' };
const state = {
  ticket: {
    id: '33333333-3333-4333-8333-333333333333',
    student_id: STUDENT.id,
    student_number: 'STU/1',
    student_name: STUDENT.name,
    issue_type: 'fee_dispute',
    description: 'A sufficiently long test ticket description.',
    priority: 'medium',
    status: 'pending',
    appointment_slot_id: null,
    assigned_staff_id: null,
    attended_by: null,
    created_at: '2026-10-14T08:40:00.000Z',
    updated_at: '2026-10-14T08:40:00.000Z',
  },
  responses: [],
  classification: null,
  auditEvents: [],
};
let responseSequence = 0;
const notifications = [];
let classificationResult;

function reset() {
  state.ticket.id = '33333333-3333-4333-8333-333333333333';
  state.ticket.issue_type = 'fee_dispute';
  state.ticket.description = 'A sufficiently long test ticket description.';
  state.ticket.status = 'pending';
  state.ticket.priority = 'medium';
  state.ticket.appointment_slot_id = null;
  state.ticket.assigned_staff_id = null;
  state.ticket.attended_by = null;
  state.ticket.appointment_slot = null;
  state.responses = [];
  state.classification = null;
  state.auditEvents = [];
  classificationResult = {
    suggestedCategory: 'bursary',
    suggestedPriority: 'high',
    rationale: 'Bursary terms were found.',
    providerName: 'rules',
    timestamp: '2026-10-14T08:40:00.000Z',
  };
  responseSequence = 0;
  notifications.length = 0;
}

function selectTicket(id) {
  if (id !== state.ticket.id) return null;
  const person = (userId) => [STAFF, STAFF_TWO, ADMIN].find((user) => user.id === userId);
  return {
    ...state.ticket,
    assigned_staff_name: person(state.ticket.assigned_staff_id)?.name ?? null,
    attended_by_name: person(state.ticket.attended_by)?.name ?? null,
  };
}

async function execute(sql, params = []) {
  if (/INSERT INTO tickets/.test(sql)) {
    [state.ticket.id, state.ticket.student_id, state.ticket.student_name, state.ticket.issue_type, state.ticket.description, state.ticket.priority] = params;
    return { rows: [] };
  }
  if (/INSERT INTO ticket_classification_recommendations/.test(sql)) {
    state.classification = {
      suggested_category: params[1],
      suggested_priority: params[2],
      rationale: params[3],
      provider_name: params[4],
      timestamp: '2026-10-14T08:40:00.000Z',
    };
    return { rows: [] };
  }
  if (/SELECT status, (?:assigned_staff_id, )?appointment_slot_id FROM tickets/.test(sql)) {
    const ticket = selectTicket(params[0]);
    return { rows: ticket ? [{
      status: ticket.status,
      assigned_staff_id: ticket.assigned_staff_id,
      appointment_slot_id: ticket.appointment_slot_id,
    }] : [] };
  }
  if (/SELECT role, is_active FROM profiles WHERE id = \$1 FOR SHARE/.test(sql)) {
    const user = [STAFF, STAFF_TWO, ADMIN, STUDENT, LECTURER].find((candidate) => candidate.id === params[0]);
    return { rows: user ? [{ role: user.role, is_active: user.role !== 'lecturer' }] : [] };
  }
  if (/UPDATE tickets SET/.test(sql)) {
    for (const column of ['issue_type', 'status', 'priority', 'assigned_staff_id', 'attended_by']) {
      const match = sql.match(new RegExp(`${column} = \\$(\\d+)`));
      const coalesce = sql.match(new RegExp(`${column} = COALESCE\\(${column}, \\$(\\d+)\\)`));
      const selected = match ?? coalesce;
      if (selected) state.ticket[column] = params[Number(selected[1]) - 1];
    }
    return { rows: [] };
  }
  if (/INSERT INTO ticket_responses/.test(sql)) {
    const id = `response-${++responseSequence}`;
    state.responses.push({
      id,
      ticket_id: params[0],
      author_id: params[1],
      body: params[2],
      created_at: `2026-10-16T10:0${responseSequence}:00.000Z`,
    });
    return { rows: [{ id }] };
  }
  if (/INSERT INTO public\.staff_action_audit_log/.test(sql)) {
    state.auditEvents.push({ action: params[1], entityId: params[3], metadata: JSON.parse(params[4]) });
    return { rows: [{ id: 'audit-row' }] };
  }
  if (/SELECT unbook_slot/.test(sql)) {
    state.ticket.appointment_slot_id = null;
    state.ticket.appointment_slot = null;
    return { rows: [] };
  }
  if (/SELECT book_slot/.test(sql)) {
    state.ticket.appointment_slot_id = params[0];
    state.ticket.appointment_slot = '2026-11-25 10:00:00';
    return { rows: [] };
  }
  throw new Error(`Unexpected SQL in test: ${sql}`);
}

mock.module(src('db.js'), {
  namedExports: {
    bind: (params, value) => { params.push(value); return `$${params.length}`; },
    query: async (sql, params = []) => {
      if (/FROM ticket_responses r/.test(sql)) {
        return state.responses.filter((r) => r.ticket_id === params[0]).sort((a, b) => a.created_at.localeCompare(b.created_at))
          .map((r) => ({ ...r, author_name: [STAFF, STAFF_TWO, ADMIN].find((user) => user.id === r.author_id)?.name ?? null }));
      }
      if (/FROM tickets t\s+JOIN profiles/.test(sql)) {
        return sql.includes('t.assigned_staff_id =')
          ? (state.ticket.assigned_staff_id === params[0] ? [selectTicket(state.ticket.id)] : [])
          : [selectTicket(state.ticket.id)];
      }
      throw new Error(`Unexpected query in test: ${sql}`);
    },
    queryOne: async (sql, params = []) => {
      if (/FROM tickets t\s+JOIN profiles/.test(sql)) return selectTicket(params[0]);
      if (/FROM ticket_classification_recommendations/.test(sql)) return state.classification;
      throw new Error(`Unexpected queryOne in test: ${sql}`);
    },
    withTransaction: async (fn) => fn({ query: execute }),
  },
});

mock.module(src('middleware/auth.js'), {
  namedExports: {
    requireAuth: (req, res, next) => {
      const token = req.get('authorization')?.replace(/^Bearer /i, '');
      req.user = token === 'staff' ? STAFF : token === 'staff-two' ? STAFF_TWO : token === 'admin' ? ADMIN : token === 'lecturer' ? LECTURER : token === 'student' ? STUDENT : null;
      if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
      next();
    },
    isStaff: (user) => user?.role === 'staff' || user?.role === 'admin',
  },
});
mock.module(src('notifications.js'), {
  namedExports: {
    notifyTicketOwner: (ticketId, event, actorId) => notifications.push({ ticketId, event, actorId }),
  },
});
mock.module(src('classifier.js'), {
  namedExports: {
    classifyTicket: async () => classificationResult,
  },
});

let server;
let base;
before(async () => {
  const express = (await import('express')).default;
  const { errorHandler } = await import(src('middleware/errors.js'));
  const router = (await import(src('routes/tickets.js'))).default;
  const app = express();
  app.use(express.json());
  app.use('/api/tickets', router);
  app.use(errorHandler);
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(reset);

const api = async (path, token, options = {}) => {
  const res = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return { status: res.status, json: await res.json() };
};

describe('ticket response history', () => {
  test('ticket creation stores a separate suggestion while preserving staff control; fallback uses medium priority', async () => {
    const created = await api('/api/tickets', 'student', {
      method: 'POST',
      body: { issueType: 'fee_dispute', description: 'Please review this fee balance.', priority: 'low' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.ticket.priority, 'low');
    assert.equal(created.json.ticket.classification, undefined);
    assert.deepEqual(state.classification, {
      suggested_category: 'bursary',
      suggested_priority: 'high',
      rationale: 'Bursary terms were found.',
      provider_name: 'rules',
      timestamp: '2026-10-14T08:40:00.000Z',
    });

    const staffView = await api(`/api/tickets/${state.ticket.id}`, 'staff');
    assert.equal(staffView.json.ticket.classification.suggested_category, 'bursary');
    const accepted = await api(`/api/tickets/${state.ticket.id}`, 'staff', {
      method: 'PATCH',
      body: { issueType: 'bursary', priority: 'high' },
    });
    assert.equal(accepted.status, 200);
    assert.equal(state.ticket.issue_type, 'bursary');
    assert.equal(state.ticket.priority, 'high');
    classificationResult = {
      suggestedCategory: 'other',
      suggestedPriority: 'high',
      rationale: 'Classifier unavailable.',
      providerName: 'fallback',
      timestamp: '2026-10-14T08:40:00.000Z',
    };
    const fallback = await api('/api/tickets', 'student', {
      method: 'POST',
      body: { issueType: 'other', description: 'Please help with a finance query.', priority: 'high' },
    });
    assert.equal(fallback.status, 201);
    assert.equal(fallback.json.ticket.priority, 'medium');
  });

  test('staff responses append and detail returns them oldest first to the ticket owner', async () => {
    await api(`/api/tickets/${state.ticket.id}`, 'staff', { method: 'PATCH', body: { response: 'First update.' } });
    await api(`/api/tickets/${state.ticket.id}`, 'staff', { method: 'PATCH', body: { response: 'Second update.' } });
    assert.deepEqual(notifications.map(({ event }) => event), ['ticket_response', 'ticket_response']);

    const detail = await api(`/api/tickets/${state.ticket.id}`, 'student');
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.json.ticket.responses.map((r) => r.body), ['First update.', 'Second update.']);
    assert.equal(detail.json.ticket.responses[0].author_id, STAFF.id);
    assert.equal(detail.json.ticket.responses[0].author_name, STAFF.name);
    assert.ok(detail.json.ticket.responses[0].created_at < detail.json.ticket.responses[1].created_at);
  });

  test('admins can assign and reassign tickets to active finance staff with an audit event for each change', async () => {
    const first = await api(`/api/tickets/${state.ticket.id}`, 'admin', {
      method: 'PATCH',
      body: { assignedStaffId: STAFF.id },
    });
    assert.equal(first.status, 200);
    assert.equal(first.json.ticket.assigned_staff_id, STAFF.id);

    const second = await api(`/api/tickets/${state.ticket.id}`, 'admin', {
      method: 'PATCH',
      body: { assignedStaffId: STAFF_TWO.id },
    });
    assert.equal(second.status, 200);
    assert.equal(second.json.ticket.assigned_staff_id, STAFF_TWO.id);
    assert.deepEqual(state.auditEvents, [
      { action: 'ticket_assignment_changed', entityId: state.ticket.id, metadata: { fromStaffId: null, toStaffId: STAFF.id } },
      { action: 'ticket_assignment_changed', entityId: state.ticket.id, metadata: { fromStaffId: STAFF.id, toStaffId: STAFF_TWO.id } },
    ]);
  });

  test('only admins may assign tickets, and inactive/non-staff targets are rejected', async () => {
    for (const role of ['student', 'lecturer', 'staff']) {
      const result = await api(`/api/tickets/${state.ticket.id}`, role, {
        method: 'PATCH',
        body: { assignedStaffId: STAFF.id },
      });
      assert.ok(result.status >= 400, `${role} must not assign tickets`);
    }

    const invalidTarget = await api(`/api/tickets/${state.ticket.id}`, 'admin', {
      method: 'PATCH',
      body: { assignedStaffId: STUDENT.id },
    });
    assert.equal(invalidTarget.status, 400);
    assert.equal(state.ticket.assigned_staff_id, null);
    assert.equal(state.auditEvents.length, 0);
  });

  test('staff can filter to their own tickets; student and lecturer roles cannot use that filter', async () => {
    state.ticket.assigned_staff_id = STAFF.id;
    const mine = await api('/api/tickets?assignedTo=me', 'staff');
    assert.equal(mine.status, 200);
    assert.equal(mine.json.tickets.length, 1);
    assert.equal(mine.json.tickets[0].assigned_staff_id, STAFF.id);

    assert.equal((await api('/api/tickets?assignedTo=me', 'student')).status, 403);
    assert.equal((await api('/api/tickets?assignedTo=me', 'lecturer')).status, 403);
  });

  test('students cannot create responses and cancelled tickets cannot be changed', async () => {
    const studentWrite = await api(`/api/tickets/${state.ticket.id}`, 'student', {
      method: 'PATCH',
      body: { response: 'Student reply.' },
    });
    assert.equal(studentWrite.status, 400);
    assert.equal(state.responses.length, 0);

    state.ticket.status = 'cancelled';
    const staffWrite = await api(`/api/tickets/${state.ticket.id}`, 'staff', {
      method: 'PATCH',
      body: { response: 'Late response.' },
    });
    assert.equal(staffWrite.status, 409);
    assert.equal(state.responses.length, 0);

    const book = await api(`/api/tickets/${state.ticket.id}/book`, 'student', {
      method: 'POST',
      body: { slotId: '44444444-4444-4444-8444-444444444444' },
    });
    const cancelBooking = await api(`/api/tickets/${state.ticket.id}/booking`, 'student', { method: 'DELETE' });
    assert.equal(book.status, 409);
    assert.equal(cancelBooking.status, 409);
  });

  test('appointment confirmation, reschedule, and cancellation queue their matching notifications', async () => {
    const first = await api(`/api/tickets/${state.ticket.id}/book`, 'student', {
      method: 'POST',
      body: { slotId: '44444444-4444-4444-8444-444444444444' },
    });
    assert.equal(first.status, 200);

    const changed = await api(`/api/tickets/${state.ticket.id}/booking`, 'student', {
      method: 'PATCH',
      body: { slotId: '55555555-5555-4555-8555-555555555555' },
    });
    assert.equal(changed.status, 200);

    const cancelled = await api(`/api/tickets/${state.ticket.id}/booking`, 'student', { method: 'DELETE' });
    assert.equal(cancelled.status, 200);
    assert.deepEqual(notifications.map(({ event }) => event), [
      'appointment_confirmed',
      'appointment_changed',
      'appointment_cancelled',
    ]);
  });

  test('cancelling a ticket also notifies the student when an appointment is released', async () => {
    state.ticket.status = 'in_review';
    state.ticket.appointment_slot_id = '44444444-4444-4444-8444-444444444444';
    state.ticket.appointment_slot = '2026-11-25 10:00:00';
    const result = await api(`/api/tickets/${state.ticket.id}`, 'student', {
      method: 'PATCH',
      body: { status: 'cancelled' },
    });

    assert.equal(result.status, 200);
    assert.deepEqual(notifications.map(({ event }) => event), ['appointment_cancelled']);
  });
});
