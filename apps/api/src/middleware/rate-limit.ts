import { createClient, type RedisClientType } from 'redis';
import type { NextFunction, Request, Response } from 'express';
import { err } from './error.js';

/**
 * Request throttling. Redis is used for cross-process buckets when
 * REDIS_URL is configured; otherwise a bounded in-memory fallback applies.
 * Rate limiting protects the API surface but NEVER participates in
 * authorization or financial decisions — if Redis is unavailable the limiter
 * degrades to the local fallback rather than blocking business traffic.
 */

interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyPrefix: string;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private redis: RedisClientType | null = null;
  private redisReady = false;
  private readonly memory = new Map<string, Bucket>();

  constructor(redisUrl: string | null) {
    if (redisUrl) {
      this.redis = createClient({ url: redisUrl }) as RedisClientType;
      this.redis.on('error', () => {
        // fall back silently to memory; never crash financial traffic over throttling
        this.redisReady = false;
      });
      this.redis
        .connect()
        .then(() => {
          this.redisReady = true;
        })
        .catch(() => {
          this.redisReady = false;
        });
    }
  }

  async check(key: string, options: RateLimitOptions): Promise<{ allowed: boolean; retryAfterSec: number }> {
    const now = Date.now();
    const bucketKey = `${options.keyPrefix}:${key}`;
    if (this.redis && this.redisReady) {
      try {
        const redisKey = `rl:${bucketKey}:${Math.floor(now / options.windowMs)}`;
        const count = await this.redis.incr(redisKey);
        if (count === 1) {
          await this.pExpire(redisKey, options.windowMs);
        }
        if (count > options.max) {
          return { allowed: false, retryAfterSec: Math.ceil(options.windowMs / 1000) };
        }
        return { allowed: true, retryAfterSec: 0 };
      } catch {
        // fall through to memory
      }
    }
    const bucket = this.memory.get(bucketKey);
    if (!bucket || bucket.resetAt <= now) {
      this.memory.set(bucketKey, { count: 1, resetAt: now + options.windowMs });
      if (this.memory.size > 10_000) {
        // bounded fallback: drop expired entries
        for (const [k, v] of this.memory) {
          if (v.resetAt <= now) this.memory.delete(k);
        }
      }
      return { allowed: true, retryAfterSec: 0 };
    }
    bucket.count += 1;
    if (bucket.count > options.max) {
      return { allowed: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
    }
    return { allowed: true, retryAfterSec: 0 };
  }

  async close(): Promise<void> {
    if (this.redis && this.redisReady) {
      await this.redis.quit().catch(() => undefined);
    }
  }

  private async pExpire(key: string, ms: number): Promise<void> {
    await (this.redis as RedisClientType).expire(key, Math.ceil(ms / 1000));
  }
}

export function rateLimitMiddleware(
  limiter: RateLimiter,
  options: RateLimitOptions,
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const actorKey = req.bb?.actor ? `${req.bb.actor.tenantId}:${req.bb.actor.userId}` : ipOf(req);
    const { allowed, retryAfterSec } = await limiter.check(actorKey, options);
    if (!allowed) {
      res.setHeader('Retry-After', String(retryAfterSec));
      next(err('RATE_LIMITED', `Too many requests. Retry after ${retryAfterSec}s.`));
      return;
    }
    next();
  };
}

function ipOf(req: Request): string {
  return req.socket.remoteAddress ?? 'unknown';
}
