import { readFileSync } from 'node:fs';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { config } from './config.js';
import { pool } from './db.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { requestLogger } from './middleware/logging.js';
import authRoutes from './routes/auth.js';
import { applicationsRouter, periodsRouter } from './routes/exam.js';
import feeRoutes from './routes/fees.js';
import { invigilationRouter, lecturersRouter, unitsRouter } from './routes/invigilation.js';
import slotRoutes from './routes/slots.js';
import statementRoutes from './routes/statements.js';
import statsRoutes from './routes/stats.js';
import templateRoutes from './routes/templates.js';
import ticketRoutes from './routes/tickets.js';
import verifyRoutes from './routes/verify.js';

const version = (() => {
  try { return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version; } catch { return 'unknown'; }
})();

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Behind a load balancer the client's real IP is in X-Forwarded-For; without this every user shares one rate-limit bucket.
  app.set('trust proxy', config.trustProxy);
  app.use(requestLogger);
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins, credentials: false, exposedHeaders: ['X-Request-Id'], maxAge: 600 }));
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true, db: 'connected', version, env: config.nodeEnv, uptimeSeconds: Math.round(process.uptime()) });
    } catch {
      res.status(503).json({ ok: false, db: 'unreachable' });
    }
  });

  // A generous ceiling for every other call; the sensitive routes (register, upload, verify) have their own stricter limits.
  if (config.nodeEnv !== 'test') {
    app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please slow down.' } }));
  }

  app.use('/api/auth', authRoutes);
  app.use('/api/tickets', ticketRoutes);
  app.use('/api/slots', slotRoutes);
  app.use('/api/fee-records', feeRoutes);
  app.use('/api/fee-statements', statementRoutes);
  app.use('/api/exam-periods', periodsRouter);
  app.use('/api/applications', applicationsRouter);
  app.use('/api/stats', statsRoutes);
  app.use('/api/verify', verifyRoutes);
  app.use('/api/invigilation', invigilationRouter);
  app.use('/api/exam-units', unitsRouter);
  app.use('/api/lecturers', lecturersRouter);
  app.use('/api', templateRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
