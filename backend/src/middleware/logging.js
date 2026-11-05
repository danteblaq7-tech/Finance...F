import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

/** Gives every request an id (also returned as X-Request-Id, so a user's error can be found in the logs) and logs one JSON line per request. */
export function requestLogger(req, res, next) {
  req.id = req.get('x-request-id')?.slice(0, 64) || randomUUID();
  res.setHeader('X-Request-Id', req.id);
  if (config.nodeEnv === 'test') return next();
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    if (req.path === '/api/health') return; // load balancers poll this constantly
    const ms = Number((process.hrtime.bigint() - started) / 1_000_000n);
    const line = { t: new Date().toISOString(), id: req.id, method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, ms, ip: req.ip, user: req.user?.id };
    (res.statusCode >= 500 ? console.error : console.log)(JSON.stringify(line));
  });
  next();
}
