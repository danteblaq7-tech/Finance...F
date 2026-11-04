import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { pool } from './db.js';
import { errorHandler, notFound } from './middleware/errors.js';
import authRoutes from './routes/auth.js';
import { applicationsRouter, periodsRouter } from './routes/exam.js';
import feeRoutes from './routes/fees.js';
import slotRoutes from './routes/slots.js';
import templateRoutes from './routes/templates.js';
import ticketRoutes from './routes/tickets.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins, credentials: false }));
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true, db: 'connected' });
    } catch {
      res.status(503).json({ ok: false, db: 'unreachable' });
    }
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/tickets', ticketRoutes);
  app.use('/api/slots', slotRoutes);
  app.use('/api/fee-records', feeRoutes);
  app.use('/api/exam-periods', periodsRouter);
  app.use('/api/applications', applicationsRouter);
  app.use('/api', templateRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
