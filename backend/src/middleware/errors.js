import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function notFound(_req, res) {
  res.status(404).json({ error: 'Not found' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'That file is too large.' });
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  // Raised on purpose by our SQL functions (RAISE EXCEPTION … ERRCODE 'P0001'), e.g. "slot already booked"
  if (err?.code === 'P0001') return res.status(409).json({ error: err.message });
  if (err?.code === '23505') return res.status(409).json({ error: 'That record already exists.' });
  // A malformed id in the URL (not a UUID) can't match anything.
  if (err?.code === '22P02') return res.status(404).json({ error: 'Not found' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  console.error(JSON.stringify({ t: new Date().toISOString(), id: req?.id, level: 'error', path: req?.originalUrl?.split('?')[0], message: err?.message, stack: err?.stack }));
  res.status(500).json({ error: 'Internal server error', requestId: req?.id });
}
