import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { decideFromStatement, evaluateFigures } from '../../src/clearance.js';
import { parseFeeStatement } from '../../src/statementParser.js';

const fig = (totalFee, amountPaid, balance) => ({ totalFee, amountPaid, balance });
const decide = (over) => decideFromStatement({ parsed: fig(100000, 100000, 0), flags: [], minPercent: 100, mode: 'verify', identity: 'matched', ...over, parsed: { ...fig(100000, 100000, 0), ...(over?.parsed ?? {}) } });

describe('evaluateFigures', () => {
  test('zero balance clears at any percentage', () => assert.equal(evaluateFigures(fig(100, 100, 0), 100).cleared, true));
  test('100% rule: 99.9% paid is not enough', () => assert.equal(evaluateFigures(fig(100000, 99900, 100), 100).cleared, false));
  test('70% rule: 70% paid is exactly enough', () => assert.equal(evaluateFigures(fig(100000, 70000, 30000), 70).cleared, true));
  test('70% rule: 69% paid is not', () => assert.equal(evaluateFigures(fig(100000, 69000, 31000), 70).cleared, false));
  test('only a balance, 100% rule → decidable', () => assert.equal(evaluateFigures(fig(null, null, 5000), 100).cleared, false));
  test('only a balance, 70% rule → cannot tell', () => assert.equal(evaluateFigures(fig(null, null, 5000), 70).cleared, null));
});

describe('decideFromStatement', () => {
  test('owing → denied automatically, with the figures in the reason', () => {
    const d = decide({ parsed: fig(78000, 52000, 26000) });
    assert.equal(d.status, 'rejected');
    assert.match(d.reason, /KSh 26,000/);
    assert.match(d.reason, /52,000 of KSh 78,000/);
  });

  test('cleared, default (verify) mode → held for the finance office, NOT approved', () => {
    const d = decide({});
    assert.equal(d.status, 'pending');
    assert.equal(d.needsReview, true);
  });

  test('cleared, trust mode, identity confirmed → approved', () => {
    assert.equal(decide({ mode: 'trust' }).status, 'approved');
  });

  test('cleared, trust mode, identity NOT confirmed → still held', () => {
    assert.equal(decide({ mode: 'trust', identity: 'unknown' }).status, 'pending');
  });

  test('trust mode never approves a statement that fails the threshold', () => {
    assert.equal(decide({ mode: 'trust', parsed: fig(100000, 50000, 50000) }).status, 'rejected');
  });

  test('inconsistent or wrong-period statements always go to a human, never auto-denied or approved', () => {
    assert.equal(decide({ mode: 'trust', flags: ['inconsistent'] }).status, 'pending');
    assert.equal(decide({ mode: 'trust', flags: ['wrong_period'], parsed: fig(100, 0, 100) }).status, 'pending');
  });

  test('unreadable statement → human review', () => {
    const d = decide({ parsed: fig(null, null, null) });
    assert.equal(d.status, 'pending');
    assert.match(d.note, /could not read/i);
  });

  test('end to end with the parser: partial payment under a 70% rule', () => {
    const parsed = parseFeeStatement('Total Fees 100,000\nAmount Paid 75,000\nBalance 25,000');
    assert.equal(decideFromStatement({ parsed, flags: parsed.flags, minPercent: 70, mode: 'trust', identity: 'matched' }).status, 'approved');
    assert.equal(decideFromStatement({ parsed, flags: parsed.flags, minPercent: 80, mode: 'trust', identity: 'matched' }).status, 'rejected');
  });
});

describe('decideFromStatement outcome label', () => {
  test('cleared figures held for verification are still recorded as "cleared"', () => assert.equal(decide({}).outcome, 'cleared'));
  test('owing is "not_cleared"', () => assert.equal(decide({ parsed: fig(10, 0, 10) }).outcome, 'not_cleared'));
  test('unreadable is "needs_review"', () => assert.equal(decide({ parsed: fig(null, null, null) }).outcome, 'needs_review'));
});
