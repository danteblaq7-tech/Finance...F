import { matchesStudentNumberPattern, normalizeStudentNumber } from './normalizeStudentNumber.js';

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

export function parseStudentRegistryCsv(text, studentIdPattern) {
  const [headerRow, ...dataRows] = parseCsvRows(text.replace(/^\uFEFF/, ''));
  if (!headerRow) throw new Error('CSV is empty.');
  const headers = headerRow.map((header) => header.trim().toLowerCase());
  const indices = {
    student_number: headers.indexOf('student_number'),
    course: headers.indexOf('course'),
    active: headers.indexOf('active'),
  };
  if (indices.student_number < 0 || indices.course < 0) {
    throw new Error('CSV must include student_number and course columns; active is optional.');
  }

  const seen = new Set();
  return dataRows.map((row, index) => {
    const studentNumber = normalizeStudentNumber(row[indices.student_number] ?? '');
    const course = (row[indices.course] ?? '').trim();
    const activeValue = indices.active < 0 ? '' : (row[indices.active] ?? '').trim().toLowerCase();
    if (!matchesStudentNumberPattern(studentNumber, studentIdPattern)) throw new Error(`CSV row ${index + 2} has an invalid student number.`);
    if (!course) throw new Error(`CSV row ${index + 2} is missing course.`);
    if (activeValue && !['true', 'false', '1', '0', 'yes', 'no'].includes(activeValue)) {
      throw new Error(`CSV row ${index + 2} has an invalid active value.`);
    }
    if (seen.has(studentNumber)) throw new Error(`CSV contains duplicate student numbers after normalization (row ${index + 2}).`);
    seen.add(studentNumber);
    return {
      studentNumber,
      course,
      active: !['false', '0', 'no'].includes(activeValue),
    };
  });
}
