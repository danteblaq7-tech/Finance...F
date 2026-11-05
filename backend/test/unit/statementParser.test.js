// Unit tests: no database or network needed.   node --test test/unit
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { checkOwnership, parseFeeStatement } from '../../src/statementParser.js';

// Text exactly as a PDF library returns it for a table: every cell on its own line.
const LEDGER_CELLS_CLEARED =
  'MOI UNIVERSITY - STUDENT FEE STATEMENT\nName: Amina Hassan\nReg No: EGM/027/2024\nAcademic Year: 2026/2027   Semester 1\nDate\nDescription\nDebit\nCredit\nBalance\n01/09/2026\nTuition Sem 1\n85,000.00\n85,000.00\n12/09/2026\nMPESA QJ81K2L9XA\n85,000.00\n0.00\nTotal\n85,000.00\n85,000.00\n0.00\n';
const LEDGER_CELLS_OWING = LEDGER_CELLS_CLEARED.replace('EGM/027/2024', 'SCI/114/2023')
  .replace('Amina Hassan', 'Brian Kiprop')
  .replace('Total\n85,000.00\n85,000.00\n0.00', 'Total\n78,000.00\n52,000.00\n26,000.00');

describe('parseFeeStatement: PDF text', () => {
  test('ledger with a totals row, one cell per line (cleared)', () => {
    const p = parseFeeStatement(LEDGER_CELLS_CLEARED);
    assert.deepEqual([p.totalFee, p.amountPaid, p.balance], [85000, 85000, 0]);
    assert.equal(p.studentId, 'EGM/027/2024');
    assert.deepEqual(p.academicYears, ['2026/2027']);
    assert.equal(p.confidence, 'high');
    assert.equal(p.source, 'ledger');
  });

  test('ledger with a totals row on ONE line (owing)', () => {
    const text = 'Reg No: SCI/114/2023\nDate  Description  Debit  Credit  Balance\n01/09/2026 Tuition 78,000.00 78,000.00\nTotal  78,000.00  52,000.00  26,000.00';
    const p = parseFeeStatement(text);
    assert.deepEqual([p.totalFee, p.amountPaid, p.balance], [78000, 52000, 26000]);
  });

  test('ledger where the Balance column comes first', () => {
    const p = parseFeeStatement('Balance Debit Credit\nTotal 5,000.00 20,000.00 15,000.00');
    assert.deepEqual([p.totalFee, p.amountPaid, p.balance], [20000, 15000, 5000]);
  });

  test('owing ledger from the cell-per-line layout', () => {
    const p = parseFeeStatement(LEDGER_CELLS_OWING);
    assert.deepEqual([p.totalFee, p.amountPaid, p.balance], [78000, 52000, 26000]);
  });

  test('labelled summary with KES prefix', () => {
    const p = parseFeeStatement('FEE STATEMENT\nAdmission No: BUS/052/2025\nTotal Fees:  KES 72,000.00\nAmount Paid:  KES 72,000.00\nBalance:  KES 0.00\n');
    assert.deepEqual([p.totalFee, p.amountPaid, p.balance], [72000, 72000, 0]);
    assert.equal(p.studentId, 'BUS/052/2025');
  });

  test('label and value on separate lines', () => {
    const p = parseFeeStatement('Total Fees\n140,000.00\nAmount Paid\n120,000.00\nOutstanding Balance\n20,000.00');
    assert.deepEqual([p.totalFee, p.amountPaid, p.balance], [140000, 120000, 20000]);
  });

  test('dates, years and the semester number are not mistaken for money', () => {
    const p = parseFeeStatement('Total Fees for 2026/2027 Semester 1:  85,000\nAmount Paid as at 12/10/2026:  60,000\nBalance: 25,000');
    assert.deepEqual([p.totalFee, p.amountPaid, p.balance], [85000, 60000, 25000]);
  });

  test('"balance b/f" (opening balance) is not used as the balance', () => {
    const p = parseFeeStatement('Balance b/f 12,000.00\nTotal Fees 80,000.00\nAmount Paid 80,000.00\nClosing Balance 0.00');
    assert.equal(p.balance, 0);
  });

  test('brackets and CR mean the student overpaid: nothing owed', () => {
    assert.equal(parseFeeStatement('Total Fees 80,000\nAmount Paid 82,000\nBalance (2,000.00)').balance, 0);
    const cr = parseFeeStatement('Total Fees 80,000\nAmount Paid 82,000\nBalance 2,000.00 CR');
    assert.equal(cr.balance, 0);
    assert.equal(cr.creditBalance, true);
  });

  test('only two figures: the third is derived and flagged', () => {
    const p = parseFeeStatement('Total Fees 100,000\nBalance 30,000');
    assert.deepEqual([p.totalFee, p.amountPaid, p.balance], [100000, 70000, 30000]);
    assert.ok(p.flags.includes('paid_derived'));
    assert.equal(p.confidence, 'medium');
  });

  test('figures that do not add up are flagged "inconsistent"', () => {
    const p = parseFeeStatement('Total Fees 100,000\nAmount Paid 40,000\nBalance 0.00');
    assert.ok(p.flags.includes('inconsistent'));
    assert.equal(p.confidence, 'low');
  });

  test('nothing recognisable → no_figures', () => {
    const p = parseFeeStatement('Hello, this is a photo of my receipt');
    assert.ok(p.flags.includes('no_figures'));
    assert.equal(p.balance, null);
  });
});

describe('parseFeeStatement: CSV', () => {
  test('summary row', () => {
    const p = parseFeeStatement('student_id,total_fee,amount_paid,balance\nEGM/027/2024,85000,60000,25000\n');
    assert.deepEqual([p.totalFee, p.amountPaid, p.balance], [85000, 60000, 25000]);
    assert.equal(p.source, 'csv-summary');
  });

  test('transaction ledger: sums debits and credits, takes the last balance', () => {
    const csv = 'Date,Description,Debit,Credit,Balance\n01/09/2026,Tuition,"85,000.00",,"85,000.00"\n05/09/2026,MPESA,,"50,000.00","35,000.00"\n20/09/2026,MPESA,,"35,000.00",0.00\n';
    const p = parseFeeStatement(csv);
    assert.deepEqual([p.totalFee, p.amountPaid, p.balance], [85000, 85000, 0]);
    assert.equal(p.source, 'csv-ledger');
  });

  test('semicolon-separated and quoted cells', () => {
    const p = parseFeeStatement('Total Fees;Amount Paid;Balance\n"72,000.00";"72,000.00";"0.00"');
    assert.deepEqual([p.totalFee, p.amountPaid, p.balance], [72000, 72000, 0]);
  });
});

describe('checkOwnership', () => {
  const mine = { studentId: 'EGM/027/2024', academicYear: '2026/2027' };

  test('own statement for the right year', () => {
    const p = parseFeeStatement(LEDGER_CELLS_CLEARED);
    const r = checkOwnership(p, LEDGER_CELLS_CLEARED, mine);
    assert.equal(r.identity, 'matched');
    assert.deepEqual(r.flags, []);
  });

  test('someone else\'s statement is a hard mismatch', () => {
    const p = parseFeeStatement(LEDGER_CELLS_OWING);
    const r = checkOwnership(p, LEDGER_CELLS_OWING, mine);
    assert.equal(r.identity, 'mismatch');
    assert.ok(r.flags.includes('wrong_student'));
  });

  test('ID is matched even with different spacing and case', () => {
    const text = 'Registration Number: egm / 027 / 2024\nTotal Fees 1,000\nAmount Paid 1,000\nBalance 0';
    assert.equal(checkOwnership(parseFeeStatement(text), text, mine).identity, 'matched');
  });

  test('no student ID at all → needs a human, but is not a hard failure', () => {
    const text = 'Total Fees 1,000\nAmount Paid 1,000\nBalance 0';
    const r = checkOwnership(parseFeeStatement(text), text, mine);
    assert.equal(r.identity, 'unknown');
    assert.ok(r.flags.includes('no_student_id'));
  });

  test('a statement for a different academic year', () => {
    const text = 'Reg No: EGM/027/2024\nAcademic Year 2024/2025\nTotal Fees 1,000\nAmount Paid 1,000\nBalance 0';
    const r = checkOwnership(parseFeeStatement(text), text, mine);
    assert.ok(r.flags.includes('wrong_period'));
  });

  test('a ledger that lists several years is fine as long as the current one is present', () => {
    const text = 'Reg No: EGM/027/2024\n2025/2026 balance b/f 0\n2026/2027 Tuition 1,000\nTotal Fees 1,000\nAmount Paid 1,000\nBalance 0';
    assert.ok(!checkOwnership(parseFeeStatement(text), text, mine).flags.includes('wrong_period'));
  });
});
