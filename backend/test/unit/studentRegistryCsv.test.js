import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseStudentRegistryCsv } from '../../src/studentRegistryCsv.js';

const pattern = /^[A-Z]{2,6}\/\d{3,4}\/\d{2}$/;

describe('student registry CSV', () => {
  test('normalizes numbers, handles quoted commas, and defaults active to true', () => {
    const records = parseStudentRegistryCsv(
      'student_number,course,active\n" com - 072 - 23 ","Commerce, accounting",\nSCI/1234/24,Science,false\n',
      pattern,
    );
    assert.deepEqual(records, [
      { studentNumber: 'COM/072/23', course: 'Commerce, accounting', active: true },
      { studentNumber: 'SCI/1234/24', course: 'Science', active: false },
    ]);
  });

  test('rejects duplicate numbers after normalization and invalid records', () => {
    assert.throws(
      () => parseStudentRegistryCsv('student_number,course\nCOM/072/23,Commerce\ncom - 072 - 23,Arts\n', pattern),
      /duplicate student numbers after normalization/,
    );
    assert.throws(
      () => parseStudentRegistryCsv('student_number,course\nCOM/72/23,Commerce\n', pattern),
      /invalid student number/,
    );
  });
});
