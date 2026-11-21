import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db.js';
import type { AppConfig } from '../config.js';
import { ActorState, asyncHandler, err , pathParam } from '../middleware/error.js';
import { getSupplierDetail, listSuppliers, approveContact } from '../services/suppliers.js';
import { runIdempotentMutation } from '../middleware/idempotency.js';

export function supplierRoutes(db: Db, config: AppConfig): Router {
  const router = Router();

  router.get(
    '/api/v1/suppliers',
    asyncHandler(async (req, res) => {
      const actor = requiredActor(req);
      res.json({ items: await listSuppliers(db, actor.tenantId) });
    }),
  );

  router.get(
    '/api/v1/suppliers/:id',
    asyncHandler(async (req, res) => {
      const actor = requiredActor(req);
      res.json(await getSupplierDetail(db, actor.tenantId, pathParam(req, 'id')));
    }),
  );

  router.post(
    '/api/v1/suppliers/:id/contacts',
    asyncHandler(async (req, res) => {
      const actor = requiredActor(req);
      const body = z
        .object({
          channel: z.enum(['PHONE', 'EMAIL']),
          value: z.string().min(5).max(200),
          label: z.string().min(2).max(120),
        })
        .safeParse(req.body);
      if (!body.success) throw err('MALFORMED_INPUT', 'Invalid contact approval.', body.error.issues);
      const outcome = await runIdempotentMutation(db, req, 'POST /suppliers/:id/contacts', async (client) => {
        const result = await approveContact(client, config, actor, pathParam(req, 'id'), body.data);
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
