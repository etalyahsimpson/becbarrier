import { Router } from 'express';
import type { Db } from '../db.js';
import type { AppConfig } from '../config.js';
import { asyncHandler, err , pathParam } from '../middleware/error.js';
import { getEmailSampleView, listEmailSamples, persistEmailSample, prepareEmailAnalysis } from '../services/email-samples.js';
import { publishCommitted } from '../services/realtime.js';

/**
 * Email intake. Accepts one .eml per request:
 *  - raw body with Content-Type message/rfc822 or application/octet-stream
 *  - JSON { contentBase64 } for tooling
 * Rejects oversize payloads with 413 before full buffering when the declared
 * Content-Length already exceeds the cap. Uploads are content-addressed by
 * their SHA-256 digest, so re-uploading an identical sample replays the
 * stored analysis instead of duplicating records.
 */
export function emailSampleRoutes(db: Db, config: AppConfig): Router {
  const router = Router();

  const rawUpload = expressRawWithCap(config.uploadMaxBytes);

  router.post(
    '/api/v1/email-samples',
    rawUpload,
    asyncHandler(async (req, res) => {
      const actor = req.bb?.actor;
      if (!actor) throw err('UNAUTHENTICATED', 'Authentication required.');
      if (actor.role === 'AUDITOR') {
        throw err('FORBIDDEN', 'Auditors have read-only access.');
      }
      let bytes: Buffer;
      if (Buffer.isBuffer(req.body)) {
        bytes = req.body;
      } else if (req.body && typeof req.body === 'object' && typeof (req.body as { contentBase64?: string }).contentBase64 === 'string') {
        try {
          bytes = Buffer.from((req.body as { contentBase64: string }).contentBase64, 'base64');
        } catch {
          throw err('MALFORMED_INPUT', 'contentBase64 is not valid base64.');
        }
      } else {
        throw err('MALFORMED_INPUT', 'Provide a raw .eml body (message/rfc822) or JSON { contentBase64 }.');
      }

      // Phase 1: bounded analysis via the internal Python service.
      const { analysis } = await prepareEmailAnalysis(db, config, actor, bytes);
      // Phase 2: tenant-scoped transactional persistence.
      const outcome = await db.withTransaction(async (client) =>
        persistEmailSample(client, config, actor, analysis),
      );
      publishCommitted(actor.tenantId, 'stats_update', { reason: 'email_sample_ingested' });
      if (!outcome.replay) {
        publishCommitted(actor.tenantId, 'alert_created', {
          subject: typeof (analysis.normalized as { subject?: string } | null)?.subject === 'string'
            ? ((analysis.normalized as { subject?: string }).subject ?? '')
            : '',
          priority: analysis.priority,
          score: analysis.score,
        });
      }
      res.status(outcome.replay ? 200 : 201).json({
        sampleId: outcome.sampleId,
        replay: outcome.replay,
        provenance: analysis.provenance,
        parseStatus: analysis.parseStatus,
        ruleVersion: analysis.ruleVersion,
        score: analysis.score,
        priority: analysis.priority,
        unknownCount: analysis.unknownCount,
        findings: analysis.findings,
      });
    }),
  );

  router.get(
    '/api/v1/email-samples',
    asyncHandler(async (req, res) => {
      const actor = req.bb?.actor;
      if (!actor) throw err('UNAUTHENTICATED', 'Authentication required.');
      const limit = Number(req.query.limit ?? 25);
      const result = await listEmailSamples(db, actor.tenantId, limit, req.query.cursor as string | undefined);
      res.json(result);
    }),
  );

  router.get(
    '/api/v1/email-samples/:id',
    asyncHandler(async (req, res) => {
      const actor = req.bb?.actor;
      if (!actor) throw err('UNAUTHENTICATED', 'Authentication required.');
      res.json(await getEmailSampleView(db, actor.tenantId, pathParam(req, 'id')));
    }),
  );

  return router;
}

/** Raw-body parser with a hard byte cap (defends against buffering attacks). */
import type { Request, Response, NextFunction } from 'express';

export function expressRawWithCap(maxBytes: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const declared = Number(req.header('content-length') ?? '0');
    if (declared > maxBytes) {
      res.status(413).json({
        error: { code: 'PAYLOAD_TOO_LARGE', message: `The .eml exceeds the ${maxBytes}-byte limit.` },
        correlationId: req.bb?.correlationId ?? 'unknown',
      });
      return;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      total += chunk.length;
      if (total > maxBytes) {
        done = true;
        if (!res.headersSent) {
          res.status(413).json({
            error: { code: 'PAYLOAD_TOO_LARGE', message: `The .eml exceeds the ${maxBytes}-byte limit.` },
            correlationId: req.bb?.correlationId ?? 'unknown',
          });
        }
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      const contentType = req.header('content-type') ?? '';
      if (contentType.includes('application/json')) {
        // fall through to express.json (registered after raw for this route order)
        (req as unknown as { body?: unknown }).body = undefined;
        // parse manually to keep single-pass
        try {
          (req as unknown as { body: unknown }).body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          next();
        } catch {
          next(err('MALFORMED_INPUT', 'Invalid JSON body.'));
        }
        return;
      }
      (req as unknown as { body: Buffer }).body = Buffer.concat(chunks);
      next();
    });
    req.on('error', () => {
      if (!done && !res.headersSent) {
        done = true;
        next(err('TEMPORARILY_UNAVAILABLE', 'Upload stream failed.'));
      }
    });
  };
}
