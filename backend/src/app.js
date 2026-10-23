import express from 'express';
import cors from 'cors';
import { createRouter } from './routes.js';
import { errorHandler, notFoundHandler } from './errors.js';

// Builds the Express app without starting it, so tests can create their own copy.
export function createApp({ bank, store, corsOrigin = '*' }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Render sits behind a proxy; needed for correct client IPs (rate limiting)

  app.use(cors({ origin: corsOrigin === '*' ? '*' : corsOrigin.split(',').map((o) => o.trim()) }));
  app.use(express.json({ limit: '10kb' }));

  // Rate limiting (Platform lead) plugs in here, before the routes.
  app.use('/api', createRouter({ bank, store }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
