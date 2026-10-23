import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRouter } from './routes.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { createMetrics } from './metrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp({
  bank,
  store,
  corsOrigin = '*',
  rateLimitMax = 100,
  rateLimitWindowMs = 15 * 60 * 1000,
} = {}) {
  const app = express();
  const metrics = createMetrics();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(cors({
    origin: corsOrigin === '*' ? '*' : corsOrigin.split(',').map((o) => o.trim()),
  }));

  app.use(express.json({ limit: '10kb' }));

  // Collect metrics for API requests, including requests rejected by rate limiting.
  app.use('/api', (req, res, next) => {
    const startedAt = performance.now();

    res.on('finish', () => {
      metrics.record({
        method: req.method,
        status: res.statusCode,
        durationMs: performance.now() - startedAt,
      });
    });

    next();
  });

  // Limit excessive API requests. Keep health and metrics endpoints accessible.
  app.use('/api', rateLimit({
    windowMs: rateLimitWindowMs,
    limit: rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/health' || req.path === '/metrics',
    handler: (req, res) => {
      res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again later.',
        },
      });
    },
  }));

  // Operational metrics endpoint.
  app.get('/api/metrics', (req, res) => {
    res.json(metrics.snapshot());
  });

  // API routes
  app.use('/api', createRouter({ bank, store }));

  // Built frontend (Vite → frontend/dist)
  const dist = path.join(__dirname, '../../frontend/dist');
  app.use(express.static(dist));

  // SPA fallback: any non-API path → index.html
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(dist, 'index.html'), (err) => {
      if (err) notFoundHandler(req, res);
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}