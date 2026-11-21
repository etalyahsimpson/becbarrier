import { Router } from 'express';
import type { Db } from '../db.js';
import type { AppConfig } from '../config.js';
import { ActorState, asyncHandler, ApiError, err , pathParam } from '../middleware/error.js';
import { runIdempotentMutation } from '../middleware/idempotency.js';
import {
  cancelChange,
  createBankChange,
  createMaterialRevision,
  getBankChangeView,
  listBankChanges,
  recordDecision,
  recordErpAck,
  releaseForErp,
  verifyCallback,
} from '../services/bank-changes.js';
import { appendAuditEventWithConfig, AuditEventTypes } from '../services/audit.js';
import {
  createBankChangeSchema,
  decisionSchema,
  erpAckSchema,
  materialEditSchema,
  releaseSchema,
  verifyCallbackSchema,
} from '@becbarrier/contracts';
import { publishCommitted } from '../services/realtime.js';
import { z } from 'zod';

/**
 * The financial workflow REST surface (handoff section 7.5). All mutations
 * run through the idempotent transactional runner; denials on sensitive
 * transitions are recorded as safe audit events when the audit system is
 * healthy (T06).
 */
export function bankChangeRoutes(db: Db, config: AppConfig): Router {
  const router = Router();

  function actorOf(req: { bb?: { actor?: ActorState } }): ActorState {
    const actor = req.bb?.actor;
    if (!actor) throw err('UNAUTHENTICATED', 'Authentication required.');
    return actor;
  }

  function parseBody<T>(schema: z.ZodType<T>, body: unknown, message: string): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw err('MALFORMED_INPUT', message, parsed.error.issues);
    return parsed.data;
  }

  /** Records safe denial audit events (best effort, separate transaction). */
  async function auditDenial(actor: ActorState, aggregateId: string, e: ApiError): Promise<void> {
    const codes = ['SEPARATION_OF_DUTIES', 'VERIFICATION_HOLD', 'VERIFICATION_REQUIRED', 'STALE_REVISION', 'INVALID_TRANSITION', 'IDEMPOTENCY_CONFLICT', 'FORBIDDEN'];
    if (!codes.includes(e.code)) return;
    try {
      await db.withTransaction(async (client) => {
        await appendAuditEventWithConfig(client, config, {
          tenantId: actor.tenantId,
          aggregateType: 'bank_change_request',
          aggregateId,
          aggregateVersion: 0,
          actorUserId: actor.userId,
          eventType: AuditEventTypes.ACCESS_DENIED,
          safeMetadata: { code: e.code, message: e.message, role: actor.role },
        });
      });
    } catch {
      // audit unavailable — the denial itself still stands (fail closed)
    }
  }

  router.post(
    '/api/v1/suppliers/:id/bank-changes',
    asyncHandler(async (req, res) => {
      const actor = actorOf(req);
      const input = parseBody(
        createBankChangeSchema,
        { ...req.body, supplierId: req.params.id },
        'Invalid bank-change request.',
      );
      try {
        const outcome = await runIdempotentMutation(db, req, 'POST /suppliers/:id/bank-changes', async (client) => {
          const view = await createBankChange(client, config, actor, input);
          return { status: 201, body: view };
        });
        res.setHeader('Idempotency-Replayed', String(outcome.replayed));
        publishCommitted(actor.tenantId, 'stats_update', { reason: 'bank_change_created' });
        res.status(outcome.status).json(outcome.body);
      } catch (e) {
        if (e instanceof ApiError) await auditDenial(actor, input.supplierId, e);
        throw e;
      }
    }),
  );

  router.get(
    '/api/v1/bank-changes',
    asyncHandler(async (req, res) => {
      const actor = actorOf(req);
      const result = await listBankChanges(db, actor.tenantId, {
        state: req.query.state as string | undefined,
        supplierId: req.query.supplierId as string | undefined,
        limit: Number(req.query.limit ?? 25),
        cursor: req.query.cursor as string | undefined,
      });
      res.json(result);
    }),
  );

  router.get(
    '/api/v1/bank-changes/:id',
    asyncHandler(async (req, res) => {
      const actor = actorOf(req);
      const view = await getBankChangeView(db, actor.tenantId, pathParam(req, 'id'));
      const revisions = await db.query(
        `SELECT revision, beneficiary_mask, bank_name, masked_suffix, currency, reason, created_at
         FROM bank_change_revisions WHERE change_id = $1 AND tenant_id = $2 ORDER BY revision DESC`,
        [req.params.id, actor.tenantId],
      );
      const timeline = await db.query(
        `SELECT event_type, event_time, safe_metadata FROM audit_events
         WHERE tenant_id = $1 AND aggregate_type = 'bank_change_request' AND aggregate_id = $2
         ORDER BY sequence`,
        [actor.tenantId, req.params.id],
      );
      res.json({
        ...view,
        revisions: revisions.rows.map((r) => ({
          revision: r.revision,
          beneficiaryName: r.beneficiary_mask,
          bankName: r.bank_name,
          accountSuffix: r.masked_suffix,
          currency: r.currency,
          reason: r.reason,
          createdAt: new Date(r.created_at).toISOString(),
        })),
        auditTimeline: timeline.rows.map((t) => ({
          eventType: t.event_type,
          eventTime: new Date(t.event_time).toISOString(),
          metadata: t.safe_metadata,
        })),
      });
    }),
  );

  router.post(
    '/api/v1/bank-changes/:id/verify',
    asyncHandler(async (req, res) => {
      const actor = actorOf(req);
      const input = parseBody(verifyCallbackSchema, req.body, 'Invalid callback verification.');
      try {
        const outcome = await runIdempotentMutation(db, req, 'POST /bank-changes/:id/verify', async (client) => {
          const view = await verifyCallback(client, config, actor, pathParam(req, 'id'), input);
          return { status: 200, body: view };
        });
        res.setHeader('Idempotency-Replayed', String(outcome.replayed));
        publishCommitted(actor.tenantId, 'stats_update', { reason: 'callback_recorded' });
        res.status(outcome.status).json(outcome.body);
      } catch (e) {
        if (e instanceof ApiError) await auditDenial(actor, pathParam(req, 'id'), e);
        throw e;
      }
    }),
  );

  router.post(
    '/api/v1/bank-changes/:id/decisions',
    asyncHandler(async (req, res) => {
      const actor = actorOf(req);
      const input = parseBody(decisionSchema, req.body, 'Invalid approval decision.');
      try {
        const outcome = await runIdempotentMutation(db, req, 'POST /bank-changes/:id/decisions', async (client) => {
          const view = await recordDecision(client, config, actor, pathParam(req, 'id'), input);
          return {
            status: 200,
            body: {
              changeId: view.id,
              revision: view.revision,
              state: view.state,
              approvalCount: view.approvals.length,
              releaseEligible: view.state === 'APPROVAL_2',
            },
          };
        });
        res.setHeader('Idempotency-Replayed', String(outcome.replayed));
        publishCommitted(actor.tenantId, 'stats_update', { reason: 'decision_recorded' });
        res.status(outcome.status).json(outcome.body);
      } catch (e) {
        if (e instanceof ApiError) await auditDenial(actor, pathParam(req, 'id'), e);
        throw e;
      }
    }),
  );

  router.post(
    '/api/v1/bank-changes/:id/release',
    asyncHandler(async (req, res) => {
      const actor = actorOf(req);
      const input = parseBody(releaseSchema, req.body, 'Invalid release request.');
      try {
        const outcome = await runIdempotentMutation(db, req, 'POST /bank-changes/:id/release', async (client) => {
          const view = await releaseForErp(client, config, actor, pathParam(req, 'id'), input);
          return {
            status: 200,
            body: {
              changeId: view.id,
              revision: view.revision,
              state: view.state,
              releaseRef: null,
            },
          };
        });
        // Fetch the releaseRef for the response (kept out of the persisted
        // idempotency body to avoid stale refs after replays).
        const view = await getBankChangeView(db, actor.tenantId, pathParam(req, 'id'));
        res.setHeader('Idempotency-Replayed', String(outcome.replayed));
        publishCommitted(actor.tenantId, 'stats_update', { reason: 'released' });
        res.status(outcome.status).json({
          ...(outcome.body as Record<string, unknown>),
          releaseRef: view.state === 'RELEASED_FOR_ERP_UPDATE' ? (await getReleaseRef(db, actor.tenantId, pathParam(req, 'id'))) : null,
          state: view.state,
          revision: view.revision,
        });
      } catch (e) {
        if (e instanceof ApiError) await auditDenial(actor, pathParam(req, 'id'), e);
        throw e;
      }
    }),
  );

  router.post(
    '/api/v1/bank-changes/:id/erp-ack',
    asyncHandler(async (req, res) => {
      const actor = actorOf(req);
      const adapterSecret = req.header('x-erp-ack');
      if (!adapterSecret || adapterSecret !== config.erpAckSecret) {
        throw err('UNAUTHENTICATED', 'ERP adapter authentication failed (X-ERP-Ack).');
      }
      const input = parseBody(erpAckSchema, req.body, 'Invalid ERP acknowledgment.');
      const outcome = await runIdempotentMutation(db, req, 'POST /bank-changes/:id/erp-ack', async (client) => {
        const view = await recordErpAck(client, config, actor, pathParam(req, 'id'), input);
        return { status: 200, body: { changeId: view.id, state: view.state, revision: view.revision } };
      });
      res.setHeader('Idempotency-Replayed', String(outcome.replayed));
      res.status(outcome.status).json(outcome.body);
    }),
  );

  router.post(
    '/api/v1/bank-changes/:id/revisions',
    asyncHandler(async (req, res) => {
      const actor = actorOf(req);
      const input = parseBody(materialEditSchema, req.body, 'Invalid material edit.');
      try {
        const outcome = await runIdempotentMutation(db, req, 'POST /bank-changes/:id/revisions', async (client) => {
          const view = await createMaterialRevision(client, config, actor, pathParam(req, 'id'), input);
          return { status: 201, body: view };
        });
        res.setHeader('Idempotency-Replayed', String(outcome.replayed));
        publishCommitted(actor.tenantId, 'stats_update', { reason: 'revision_created' });
        res.status(outcome.status).json(outcome.body);
      } catch (e) {
        if (e instanceof ApiError) await auditDenial(actor, pathParam(req, 'id'), e);
        throw e;
      }
    }),
  );

  router.post(
    '/api/v1/bank-changes/:id/cancel',
    asyncHandler(async (req, res) => {
      const actor = actorOf(req);
      const outcome = await runIdempotentMutation(db, req, 'POST /bank-changes/:id/cancel', async (client) => {
        const view = await cancelChange(client, config, actor, pathParam(req, 'id'));
        return { status: 200, body: view };
      });
      res.setHeader('Idempotency-Replayed', String(outcome.replayed));
      res.status(outcome.status).json(outcome.body);
    }),
  );

  return router;
}

async function getReleaseRef(db: Db, tenantId: string, changeId: string): Promise<string | null> {
  const result = await db.query<{ release_ref: string | null }>(
    `SELECT release_ref FROM bank_change_requests WHERE id = $1 AND tenant_id = $2`,
    [changeId, tenantId],
  );
  return result.rows[0]?.release_ref ?? null;
}
