import { Router } from 'express';
import type { Db } from '../db.js';
import type { AppConfig } from '../config.js';
import { ActorState, asyncHandler, err , pathParam } from '../middleware/error.js';
import { appendCaseEvent, getCaseDetail, listAlerts, listCases } from '../services/cases.js';
import { runIdempotentMutation } from '../middleware/idempotency.js';
import { caseEventSchema } from '@becbarrier/contracts';

export function caseRoutes(db: Db, config: AppConfig): Router {
  const router = Router();

  router.get(
    '/api/v1/alerts',
    asyncHandler(async (req, res) => {
      const actor = requiredActor(req);
      if (actor.role === 'AUDITOR') throw err('FORBIDDEN', 'Auditors have read-only history access via audit endpoints.');
      const result = await listAlerts(db, actor.tenantId, {
        disposition: req.query.disposition as string | undefined,
        priority: req.query.priority as string | undefined,
        limit: Math.min(Number(req.query.limit ?? 25), 100),
        cursor: req.query.cursor as string | undefined,
      });
      res.json(result);
    }),
  );

  router.get(
    '/api/v1/cases',
    asyncHandler(async (req, res) => {
      const actor = requiredActor(req);
      const result = await listCases(db, actor.tenantId, {
        status: req.query.status as string | undefined,
        limit: Math.min(Number(req.query.limit ?? 25), 100),
        cursor: req.query.cursor as string | undefined,
      });
      res.json(result);
    }),
  );

  router.get(
    '/api/v1/cases/:id',
    asyncHandler(async (req, res) => {
      const actor = requiredActor(req);
      res.json(await getCaseDetail(db, actor.tenantId, pathParam(req, 'id')));
    }),
  );

  router.post(
    '/api/v1/cases/:id/events',
    asyncHandler(async (req, res) => {
      const actor = requiredActor(req);
      const parsed = caseEventSchema.safeParse(req.body);
      if (!parsed.success) throw err('MALFORMED_INPUT', 'Invalid case event.', parsed.error.issues);
      const input = parsed.data;
      const outcome = await runIdempotentMutation(db, req, 'POST /cases/:id/events', async (client) => {
        const result = await appendCaseEvent(client, config, actor, pathParam(req, 'id'), input);
        return { status: 201, body: result };
      });
      res.setHeader('Idempotency-Replayed', String(outcome.replayed));
      res.status(outcome.status).json(outcome.body);
    }),
  );

  return router;
}

function requiredActor(req: { bb?: { actor?: ActorState } }): ActorState {
  const actor = req.bb?.actor;
  if (!actor) throw err('UNAUTHENTICATED', 'Authentication required.');
  return actor;
}
