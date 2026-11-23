import assert from 'node:assert/strict';
import { before, beforeEach, describe, mock, test } from 'node:test';

let outboxRows;
let failOutbox;
const recipient = { email: 'student@example.test' };
const src = (p) => new URL(`../../src/${p}`, import.meta.url).href;

mock.module(src('config.js'), {
  namedExports: { config: { publicWebUrl: 'https://finesse-staging.example.test' } },
});
mock.module(src('db.js'), {
  namedExports: {
    queryOne: async () => recipient,
    query: async (_sql, params) => {
      if (failOutbox) throw new Error('simulated outbox failure');
      outboxRows.push(params);
      return [];
    },
  },
});

let deliverTicketNotification;
before(async () => {
  ({ deliverTicketNotification } = await import('../../src/notifications.js'));
});
beforeEach(() => {
  outboxRows = [];
  failOutbox = false;
});

describe('ticket and appointment notifications', () => {
  test('uses a plain template with an app link and no ticket or financial details', async () => {
    const queued = await deliverTicketNotification({
      ticketId: 'ticket-id',
      event: 'ticket_response',
      actorId: 'staff-id',
    });

    assert.equal(queued, true);
    assert.equal(outboxRows.length, 1);
    assert.equal(outboxRows[0][1], 'ticket_response');
    assert.equal(outboxRows[0][2], recipient.email);
    assert.match(outboxRows[0][7], /Sign in to Finesse/);
    assert.match(outboxRows[0][7], /https:\/\/finesse-staging\.example\.test/);
    assert.doesNotMatch(outboxRows[0][7], /balance|KSh|KES|fee|ticket-id|student@example\.test/i);
  });

  test('an outbox failure is swallowed so it cannot fail the main action', async () => {
    failOutbox = true;
    const error = mock.method(console, 'error', () => {});
    try {
      assert.equal(await deliverTicketNotification({
        ticketId: 'ticket-id',
        event: 'appointment_confirmed',
        actorId: 'student-id',
      }), false);
      assert.equal(error.mock.calls.length, 1);
    } finally {
      error.mock.restore();
    }
  });
});
