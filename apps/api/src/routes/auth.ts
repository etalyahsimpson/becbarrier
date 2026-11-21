import { Router } from 'express';
import { z } from 'zod';
import type { NextFunction, Request, Response } from 'express';
import type { Db } from '../db.js';
import type { AppConfig } from '../config.js';
import { asyncHandler, err } from '../middleware/error.js';
import { newSessionPayload, signSession } from '@becbarrier/security';
import {
  assertDemoIdentityAllowed,
  listDemoIdentities,
  resolveDemoLogin,
} from '../services/identity.js';
import { CSRF_COOKIE, SESSION_COOKIE } from '../middleware/auth.js';

/**
 * Auth routes. The demo identity adapter is available ONLY in
 * development/test (config-gated); production uses the OIDC boundary.
 */

export function authRoutes(db: Db, config: AppConfig, auth: (req: Request, res: Response, next: NextFunction) => void): Router {
  const router = Router();

  router.get(
    '/api/v1/auth/demo-identities',
    asyncHandler(async (req, res) => {
      assertDemoIdentityAllowed(config);
      const identities = await listDemoIdentities(db);
      res.json({ identities, adapter: 'LOCAL_DEMO_IDENTITY_ADAPTER', environment: config.appEnv });
    }),
  );

  router.post(
    '/api/v1/auth/demo-login',
    asyncHandler(async (req, res) => {
      assertDemoIdentityAllowed(config);
      const body = z.object({ userId: z.string().uuid(), tenantId: z.string().uuid() }).safeParse(req.body);
      if (!body.success) {
        throw err('MALFORMED_INPUT', 'userId and tenantId are required.', body.error.issues);
      }
      const identity = await resolveDemoLogin(db, body.data.userId, body.data.tenantId);
      const payload = newSessionPayload(identity.userId, identity.tenantId, config.sessionTtlSeconds);
      const { sessionToken, csrfToken } = signSession(config.sessionSigningKey, payload);
      const secure = config.appEnv === 'production';
      res.setHeader(
        'set-cookie',
        [
          `${SESSION_COOKIE}=${sessionToken}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=${config.sessionTtlSeconds}`,
          `${CSRF_COOKIE}=${csrfToken}; Path=/; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=${config.sessionTtlSeconds}`,
        ],
      );
      res.json({
        actor: {
          userId: identity.userId,
          userName: identity.userName,
          tenantId: identity.tenantId,
          tenantSlug: identity.tenantSlug,
          tenantName: identity.tenantName,
          role: identity.role,
        },
        csrfToken,
        adapter: 'LOCAL_DEMO_IDENTITY_ADAPTER',
      });
    }),
  );

  router.post('/api/v1/auth/logout', (req, res) => {
    const secure = config.appEnv === 'production';
    res.setHeader('set-cookie', [
      `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=0`,
      `${CSRF_COOKIE}=; Path=/; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=0`,
    ]);
    res.json({ ok: true });
  });

  router.get(
    '/api/v1/auth/me',
    auth,
    asyncHandler(async (req, res) => {
      const actor = req.bb?.actor;
      if (!actor) throw err('UNAUTHENTICATED', 'Authentication required.');
      res.json({
        userId: actor.userId,
        userName: actor.userName,
        tenantId: actor.tenantId,
        tenantSlug: actor.tenantSlug,
        tenantName: actor.tenantName,
        role: actor.role,
        sessionExpiresAt: new Date(actor.sessionExpiresAt * 1000).toISOString(),
      });
    }),
  );

  return router;
}
