import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../logger.js';

/** Generates a server-owned correlation id and logs only route templates and operational metadata. */
export function requestLogger(req, res, next) {
  req.id = randomUUID();
  res.setHeader('X-Request-Id', req.id);
  if (config.nodeEnv === 'test') return next();
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    if (req.path === '/api/health') return; // load balancers poll this constantly
    const ms = Number((process.hrtime.bigint() - started) / 1_000_000n);
    const route = req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched';
    const fields = { requestId: req.id, method: req.method, route, status: res.statusCode, durationMs: ms };
    if (res.statusCode >= 500) logger.error('http_request_failed', fields);
    else logger.info('http_request', fields);
  });
  next();
}
