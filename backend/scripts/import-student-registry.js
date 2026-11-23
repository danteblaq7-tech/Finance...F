import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from '../src/config.js';
import { pool } from '../src/db.js';
import { parseStudentRegistryCsv } from '../src/studentRegistryCsv.js';

export async function importStudentRegistry({ dbPool, csvText, studentIdPattern }) {
  const records = parseStudentRegistryCsv(csvText, studentIdPattern);
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    for (const record of records) {
      await client.query(
        `INSERT INTO public.student_registry (student_number, course, active)
         VALUES ($1, $2, $3)
         ON CONFLICT (student_number) DO UPDATE
         SET course = EXCLUDED.course, active = EXCLUDED.active, updated_at = now()`,
        [record.studentNumber, record.course, record.active],
      );
    }
    await client.query('COMMIT');
    return records.length;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  let exitCode = 0;
  try {
    const projectRef = new URL(config.supabase.url).hostname.split('.')[0];
    if (projectRef !== 'jqmxcnilrwgirsdufzjn' || config.nodeEnv === 'production') {
      throw new Error('This importer is restricted to the configured staging project jqmxcnilrwgirsdufzjn and non-production mode.');
    }
    const csvPath = process.argv[2];
    if (!csvPath) throw new Error('Usage: npm run registry:import -- <csv-file>');
    const csvText = await readFile(resolve(csvPath), 'utf8');
    const count = await importStudentRegistry({ dbPool: pool, csvText, studentIdPattern: config.studentIdPattern });
    console.log(`Imported ${count} student registry records into staging.`);
  } catch (error) {
    console.error(`Student registry import failed: ${error.message}`);
    exitCode = 1;
  } finally {
    await pool.end();
  }
  process.exitCode = exitCode;
}
