import { z } from 'zod';

export const uuidSchema = z.string().uuid('Use a valid ID.');

export const dateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date format YYYY-MM-DD.')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }, 'Enter a real calendar date.');

export const academicYearSchema = z.string()
  .trim()
  .regex(/^\d{4}\/\d{4}$/, 'Use the format YYYY/YYYY.')
  .refine((value) => {
    const [start, end] = value.split('/').map(Number);
    return end === start + 1;
  }, 'The end year must be one year after the start year.');

