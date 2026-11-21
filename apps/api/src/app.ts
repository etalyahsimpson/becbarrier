import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import type { Db } from './db.js';
import type { AppConfig } from './config.js';
import { correlationMiddleware, errorMiddleware } from './middleware/error.js';
import { createAuthMiddleware, createCsrfMiddleware } from './middleware/auth.js';
import { RateLimiter, rateLimitMiddleware } from './middleware/rate-limit.js';
import { securityHeaders } from './middleware/security-headers.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';
import { emailSampleRoutes } from './routes/email-samples.js';
import { bankChangeRoutes } from './routes/bank-changes.js';
import { supplierRoutes } from './routes/suppliers.js';
import { caseRoutes } from './routes/cases.js';
import { reportRoutes } from './routes/reports.js';
import { realtimeRoutes } from './routes/realtime.js';
import { openApiDocument } from './openapi.js';

export interface AppDeps {
  db: Db;
  config: AppConfig;
}

export function createApp({ db, config }: AppDeps): Express {
  const app = express();
  const limiter = new RateLimiter(config.redisUrl);

  app.disable('x-powered-by');
  app.set('trust proxy', false);

  app.use(securityHeaders);
  app.use(correlationMiddleware);

  // Global throttling (redis-backed when available, in-memory fallback
  // otherwise; never a financial authority). The session-boundary endpoints
  // are exempt: production would apply a dedicated credential-throttle.
  app.use('/api/v1', (req, res, next) => {
    if (req.path.startsWith('/auth/') || req.path === '/health' || req.path === '/ready' || req.path === '/openapi.json') {
      next();
      return;
    }
    rateLimitMiddleware(limiter, { windowMs: 60_000, max: 300, keyPrefix: 'api' })(req, res, next);
  });

  // JSON body parsing EXCEPT for the raw .eml upload route (custom parser).
  const jsonParser = express.json({ limit: '1mb' });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'POST' && req.path === '/api/v1/email-samples') {
      next();
      return;
    }
    jsonParser(req, res, next);
  });

  // Public: health, readiness, OpenAPI document.
  app.use(healthRoutes(db, config));
  app.get('/api/v1/openapi.json', (_req, res) => {
    res.json(openApiDocument());
  });

  // Authenticated surface (all routers use absolute /api/v1 paths).
  const auth = createAuthMiddleware(db, config);
  const csrf = createCsrfMiddleware(config);
  app.use(authRoutes(db, config, auth));
  app.use(auth, csrf, emailSampleRoutes(db, config));
  app.use(auth, csrf, caseRoutes(db, config));
  app.use(auth, csrf, supplierRoutes(db, config));
  app.use(auth, csrf, bankChangeRoutes(db, config));
  app.use(auth, csrf, reportRoutes(db, config));
  app.use(auth, csrf, realtimeRoutes(db, config));

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND_IN_TENANT', message: 'Not found.' }, correlationId: 'n/a' });
  });

  app.use(errorMiddleware);
  return app;
}
