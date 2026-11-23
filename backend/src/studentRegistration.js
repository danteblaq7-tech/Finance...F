import { queryOne } from './db.js';
import { HttpError } from './middleware/errors.js';
import { normalizeStudentNumber, matchesStudentNumberPattern } from './normalizeStudentNumber.js';

export async function assertStudentNumberAllowed(studentNumber, studentIdPattern) {
  const registry = await queryOne(
    `SELECT
       EXISTS (SELECT 1 FROM public.student_registry) AS registry_configured,
       EXISTS (
         SELECT 1 FROM public.student_registry
         WHERE student_number = $1 AND active
       ) AS registry_match`,
    [studentNumber],
  );
  if (registry?.registry_configured) {
    if (!registry.registry_match) throw new HttpError(400, 'This student number is not on the active student registry.');
    return;
  }
  if (!matchesStudentNumberPattern(studentNumber, studentIdPattern)) {
    throw new HttpError(400, 'Enter a student number in the format COURSE/072/23.');
  }
}
