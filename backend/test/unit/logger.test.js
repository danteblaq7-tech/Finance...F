import assert from 'node:assert/strict';
import { test } from 'node:test';
import { logger } from '../../src/logger.js';

test('structured logger ignores arbitrary PII and request payload fields', () => {
  let output = '';
  const original = console.log;
  console.log = (line) => { output = line; };
  try {
    logger.info('http_request', {
      requestId: '11111111-1111-4111-8111-111111111111',
      method: 'GET',
      route: '/api/tickets/:id',
      status: 200,
      ip: '192.0.2.1',
      user: 'student@example.test',
      body: 'fee balance is 45000',
      authorization: 'Bearer secret',
    });
  } finally {
    console.log = original;
  }
  assert.match(output, /http_request/);
  assert.doesNotMatch(output, /192\.0\.2\.1|student@example\.test|45000|Bearer secret/);
});
