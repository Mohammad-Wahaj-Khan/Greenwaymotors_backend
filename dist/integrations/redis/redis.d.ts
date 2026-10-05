import type { Environment } from '../../config/env.js';
export interface RedisHealth {
    ping(): Promise<void>;
    close(): Promise<void>;
}
export interface RedisRateLimitStore {
    incrementFixedWindow(key: string, expiresInMs: number): Promise<number>;
}
export interface RedisConnection extends RedisHealth, RedisRateLimitStore {
}
export declare function createRedisClient(environment: Environment): RedisConnection;
