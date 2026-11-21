import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { ERROR_STATUS, ErrorCode } from '@becbarrier/contracts';
import type { SessionPayload } from '@becbarrier/security';

/** Typed application error carrying a machine-readable code. */
export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function err(code: ErrorCode, message: string, details?: unknown): ApiError {
  return new ApiError(code, message, details);
}

export interface RequestState {
  correlationId: string;
  actor?: ActorState;
  session?: SessionPayload;
}

export interface ActorState {
  userId: string;
  userName: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  role: string;
  sessionId: string;
  sessionExpiresAt: number;
}

declare module 'express-serve-static-core' {
  interface Request {
    bb: RequestState;
  }
}

export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const id = incoming && /^[A-Za-z0-9-]{6,64}$/.test(incoming) ? incoming : randomUUID();
  req.bb = { correlationId: id };
  res.setHeader('X-Request-Id', id);
  next();
}

export function errorMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const correlationId = req.bb?.correlationId ?? randomUUID();

  if (err instanceof ApiError) {
    res.status(ERROR_STATUS[err.code]).json({
      error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) },
      correlationId,
    });
    return;
  }

  // PostgreSQL unique violation → deterministic conflict.
  if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === '23505') {
    res.status(409).json({
      error: { code: 'STALE_REVISION', message: 'The record was already modified by a concurrent request.' },
      correlationId,
    });
    return;
  }

  console.error(
    `[unhandled] correlationId=${correlationId} path=${req.path}:`,
    err instanceof Error ? err.stack : err,
  );
  res.status(500).json({
    error: { code: 'TEMPORARILY_UNAVAILABLE', message: 'An unexpected error occurred.' },
    correlationId,
  });
}

/** Wrap async handlers so rejections reach the error middleware. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/** Express 5 path params can be string | string[]; routes need plain strings. */
export function pathParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw err('MALFORMED_INPUT', `Missing path parameter: ${name}.`);
  }
  return value;
}
