import type { Environment } from '../../config/env.js';
export interface RedisHealth {
    ping(): Promise<void>;
    close(): Promise<void>;
}
export declare function createRedisClient(environment: Environment): RedisHealth;
