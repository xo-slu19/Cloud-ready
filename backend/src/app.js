import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRouter } from './routes.js';
import { errorHandler, notFoundHandler } from './errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ bank, store, corsOrigin = '*' }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(cors({
    origin: corsOrigin === '*' ? '*' : corsOrigin.split(',').map((o) => o.trim()),
  }));
  app.use(express.json({ limit: '10kb' }));

  // API first
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