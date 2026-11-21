import { Router } from 'express';
import type { Db } from '../db.js';
import type { AppConfig } from '../config.js';
import { ActorState, asyncHandler, err } from '../middleware/error.js';
import { getSummaryStats } from '../services/reports.js';

/**
 * Polling fallback for the realtime WebSocket channel. Returns exactly the
 * same tenant-scoped committed state — realtime is convenience, polling is
 * authoritative.
 */
export function realtimeRoutes(db: Db, _config: AppConfig): Router {
  const router = Router();

  router.get(
    '/api/v1/realtime/summary',
    asyncHandler(async (req, res) => {
      const actor = requiredActor(req);
      const stats = await getSummaryStats(db, actor.tenantId);
      res.json({
        type: 'stats',
        data: {
          callbacksPending: stats.callbacksPending,
          approvalsPending: stats.approvalsPending,
          openCases: Object.entries(stats.cases).reduce((acc, [k, v]) => k === 'CLOSED' ? acc : acc + v, 0),
          openAlerts: stats.alerts.open,
          alertsByPriority: stats.alerts.byPriority,
          generatedAt: stats.generatedAt,
        },
      });
    }),
  );

  return router;
}

function requiredActor(req: { bb?: { actor?: ActorState } }): ActorState {
  const actor = req.bb?.actor;
  if (!actor) throw err('UNAUTHENTICATED', 'Authentication required.');
  return actor;
}
