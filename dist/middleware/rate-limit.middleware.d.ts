import type { RequestHandler } from 'express';
import type { RedisRateLimitStore } from '../integrations/redis/redis.js';
interface RateLimitOptions {
    keyPrefix: string;
    limit: number;
    windowMs: number;
}
export declare function rateLimit({ keyPrefix, limit, windowMs }: RateLimitOptions, redis?: RedisRateLimitStore): RequestHandler;
export {};
