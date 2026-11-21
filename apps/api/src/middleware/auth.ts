import { parse as parseCookie } from 'cookie';
import type { NextFunction, Request, Response } from 'express';
import type { Db } from '../db.js';
import type { AppConfig } from '../config.js';
import { csrfTokenFor, verifySession, type SessionPayload } from '@becbarrier/security';
import { ActorState, err } from './error.js';

export const SESSION_COOKIE = 'bb_session';
export const CSRF_COOKIE = 'bb_csrf';

/**
 * Resolves the authenticated actor on EVERY request from the signed session
 * cookie plus a fresh server-side lookup of membership, role, user status and
 * tenant status (invariant 6). Client-supplied role or tenant headers are
 * never trusted.
 */
export function createAuthMiddleware(db: Db, config: AppConfig) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const cookies = parseCookie(req.header('cookie') ?? '');
      const token = cookies[SESSION_COOKIE];
      if (!token) {
        next(err('UNAUTHENTICATED', 'Authentication required.'));
        return;
      }
      const payload = verifySession(config.sessionSigningKey, token);
      if (!payload) {
        next(err('UNAUTHENTICATED', 'Session is invalid or expired.'));
        return;
      }

      // Server-side authority resolution — fresh on every action.
      const result = await db.query<{
        role: string;
        user_name: string;
        user_status: string;
        membership_active: boolean;
        tenant_id: string;
        tenant_slug: string;
        tenant_name: string;
        tenant_status: string;
      }>(
        `SELECT m.role,
                u.display_name AS user_name,
                u.status AS user_status,
                m.active AS membership_active,
                t.id AS tenant_id,
                t.slug AS tenant_slug,
                t.name AS tenant_name,
                t.status AS tenant_status
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         JOIN tenants t ON t.id = m.tenant_id
         WHERE m.user_id = $1 AND m.tenant_id = $2
         LIMIT 1`,
        [payload.sub, payload.tenantId],
      );
      const row = result.rows[0];
      if (!row || !row.membership_active) {
        next(err('FORBIDDEN', 'Membership is inactive for this tenant.'));
        return;
      }
      if (row.user_status !== 'ACTIVE') {
        next(err('FORBIDDEN', 'User account is disabled.'));
        return;
      }
      if (row.tenant_status !== 'ACTIVE') {
        next(err('FORBIDDEN', 'Tenant is suspended.'));
        return;
      }

      const actor: ActorState = {
        userId: payload.sub,
        userName: row.user_name,
        tenantId: row.tenant_id,
        tenantSlug: row.tenant_slug,
        tenantName: row.tenant_name,
        role: row.role,
        sessionId: payload.sid,
        sessionExpiresAt: payload.exp,
      };
      req.bb.actor = actor;
      req.bb.session = payload;
      next();
    } catch (e) {
      next(e);
    }
  };
}

/**
 * CSRF defense: double-submit cookie bound to the signed session. The
 * X-CSRF-Token header must equal the bb_csrf cookie AND be the token derived
 * from the session's own csrf secret. Applies to all state-changing requests
 * except the login/logout session-boundary endpoints.
 */
export function createCsrfMiddleware(config: AppConfig) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const method = req.method.toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      next();
      return;
    }
    if (req.path === '/api/v1/auth/demo-login' || req.path === '/api/v1/auth/logout') {
      next();
      return;
    }
    const session = req.bb?.session;
    if (!session) {
      next(err('UNAUTHENTICATED', 'Authentication required.'));
      return;
    }
    const headerToken = req.header('x-csrf-token') ?? '';
    const cookies = parseCookie(req.header('cookie') ?? '');
    const cookieToken = cookies[CSRF_COOKIE] ?? '';
    const expected = csrfTokenFor(config.sessionSigningKey, session.sid, session.csrfSecret);
    if (!headerToken || headerToken !== cookieToken || headerToken !== expected) {
      next(err('FORBIDDEN', 'CSRF token missing, mismatching, or not bound to this session.'));
      return;
    }
    next();
  };
}

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const actor = req.bb?.actor;
    if (!actor) {
      next(err('UNAUTHENTICATED', 'Authentication required.'));
      return;
    }
    if (!roles.includes(actor.role)) {
      next(err('FORBIDDEN', `Role ${actor.role} is not permitted to perform this action.`));
      return;
    }
    next();
  };
}
