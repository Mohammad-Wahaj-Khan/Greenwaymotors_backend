import { Redis } from 'ioredis';
import type { Environment } from '../../config/env.js';

export interface RedisHealth {
  ping(): Promise<void>;
  close(): Promise<void>;
}

export interface RedisRateLimitStore {
  incrementFixedWindow(key: string, expiresInMs: number): Promise<number>;
}

export interface RedisConnection extends RedisHealth, RedisRateLimitStore {}

export function createRedisClient(environment: Environment): RedisConnection {
  const client = new Redis(environment.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    enableOfflineQueue: false
  });

  return {
    async ping(): Promise<void> {
      if (client.status === 'wait') {
        await client.connect();
      }
      await client.ping();
    },
    async close(): Promise<void> {
      if (client.status !== 'wait' && client.status !== 'end') {
        await client.quit();
      }
    },
    async incrementFixedWindow(key: string, expiresInMs: number): Promise<number> {
      if (client.status === 'wait') {
        await client.connect();
      }
      const result = await client.eval(
        "local current = redis.call('INCR', KEYS[1]); if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); end; return current;",
        1,
        key,
        expiresInMs
      );
      return Number(result);
    }
  };
}
