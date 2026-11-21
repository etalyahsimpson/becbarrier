import { Router } from 'express';
import type { Db } from '../db.js';
import type { AppConfig } from '../config.js';
import { asyncHandler } from '../middleware/error.js';
import { checkEmailIntelligenceHealth } from '../services/email-intelligence.js';

/** No-secret health/readiness endpoints. Readiness requires the database. */
export function healthRoutes(db: Db, config: AppConfig): Router {
  const router = Router();

  router.get('/api/v1/health', (_req, res) => {
    res.json({ status: 'ok', service: 'becbarrier-api', environment: config.appEnv });
  });

  router.get(
    '/api/v1/ready',
    asyncHandler(async (_req, res) => {
      try {
        await db.query('SELECT 1');
      } catch {
        res.status(503).json({ status: 'unavailable', database: 'down' });
        return;
      }
      const analyzerUp = await checkEmailIntelligenceHealth(config);
      res.json({
        status: 'ready',
        database: 'up',
        emailIntelligence: analyzerUp ? 'up' : 'degraded',
      });
    }),
  );

  return router;
}
