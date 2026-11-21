import type { NextFunction, Request, Response } from 'express';

/**
 * Security headers for every API response. The API serves JSON only, so a
 * strict CSP is possible; the web app sets its own document-level policy.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  next();
}
