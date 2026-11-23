import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { academicYearSchema, dateSchema, uuidSchema } from '../../src/validation.js';

describe('shared input validation', () => {
  test('accepts leap days and rejects impossible calendar dates', () => {
    assert.equal(dateSchema.safeParse('2028-02-29').success, true);
    assert.equal(dateSchema.safeParse('2027-02-29').success, false);
    assert.equal(dateSchema.safeParse('2027-13-01').success, false);
  });

  test('academic years must be consecutive and IDs must be UUIDs', () => {
    assert.equal(academicYearSchema.safeParse('2026/2027').success, true);
    assert.equal(academicYearSchema.safeParse('2026/2028').success, false);
    assert.equal(uuidSchema.safeParse('44444444-4444-4444-8444-444444444444').success, true);
    assert.equal(uuidSchema.safeParse('not-an-id').success, false);
  });
});
