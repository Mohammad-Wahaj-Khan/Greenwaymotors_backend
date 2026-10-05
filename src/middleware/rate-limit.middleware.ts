import type { RequestHandler } from 'express';
import { AppError } from '../core/errors/app-error.js';
import type { RedisRateLimitStore } from '../integrations/redis/redis.js';

interface RateLimitOptions {
  keyPrefix: string;
  limit: number;
  windowMs: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const entries = new Map<string, RateLimitEntry>();

export function rateLimit(
  { keyPrefix, limit, windowMs }: RateLimitOptions,
  redis?: RedisRateLimitStore
): RequestHandler {
  return async (request, response, next) => {
    try {
      const now = Date.now();
      const periodStart = Math.floor(now / windowMs) * windowMs;
      const resetAt = periodStart + windowMs;
      const key = `${keyPrefix}:${request.ip}:${periodStart}`;
      let count: number;

      if (redis) {
        count = await redis.incrementFixedWindow(`rate-limit:${key}`, resetAt - now);
      } else {
        const existing = entries.get(key);
        const entry = !existing || existing.resetAt <= now ? { count: 0, resetAt } : existing;
        entry.count += 1;
        entries.set(key, entry);
        count = entry.count;
      }

      response.setHeader('ratelimit-limit', limit);
      response.setHeader('ratelimit-remaining', Math.max(0, limit - count));
      response.setHeader('ratelimit-reset', Math.ceil(resetAt / 1000));

      if (count > limit) {
        response.setHeader('retry-after', Math.ceil((resetAt - now) / 1000));
        next(new AppError(429, 'rate_limited', 'Too Many Requests', 'Try again later.'));
        return;
      }
      next();
    } catch (error: unknown) {
      next(error);
    }
  };
}
