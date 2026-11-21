import { Router } from 'express';
import type { Db } from '../db.js';
import type { AppConfig } from '../config.js';
import { ActorState, asyncHandler, err } from '../middleware/error.js';
import { exportSummaryCsv, getSummaryStats, listAuditEvents } from '../services/reports.js';

export function reportRoutes(db: Db, _config: AppConfig): Router {
  const router = Router();

  router.get(
    '/api/v1/reports/summary',
    asyncHandler(async (req, res) => {
      const actor = requiredActor(req);
      if (req.query.format === 'csv') {
        const csv = await exportSummaryCsv(db, actor.tenantId, actor);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="becbarrier-summary-${actor.tenantSlug}.csv"`);
        res.send(csv);
        return;
      }
      res.json(await getSummaryStats(db, actor.tenantId));
    }),
  );

  router.get(
    '/api/v1/audit-events',
    asyncHandler(async (req, res) => {
      const actor = requiredActor(req);
      const result = await listAuditEvents(
        db,
        actor.tenantId,
        {
          eventType: req.query.eventType as string | undefined,
          aggregateType: req.query.aggregateType as string | undefined,
          limit: Math.min(Number(req.query.limit ?? 25), 100),
          cursor: req.query.cursor as string | undefined,
        },
        actor,
      );
      res.json(result);
    }),
  );

  return router;
}

function requiredActor(req: { bb?: { actor?: ActorState } }): ActorState {
  const actor = req.bb?.actor;
  if (!actor) throw err('UNAUTHENTICATED', 'Authentication required.');
  return actor;
}
