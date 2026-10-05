import { Redis } from 'ioredis';
export function createRedisClient(environment) {
    const client = new Redis(environment.REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 5000,
        enableOfflineQueue: false
    });
    return {
        async ping() {
            if (client.status === 'wait') {
                await client.connect();
            }
            await client.ping();
        },
        async close() {
            if (client.status !== 'wait' && client.status !== 'end') {
                await client.quit();
            }
        },
        async incrementFixedWindow(key, expiresInMs) {
            if (client.status === 'wait') {
                await client.connect();
            }
            const result = await client.eval("local current = redis.call('INCR', KEYS[1]); if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); end; return current;", 1, key, expiresInMs);
            return Number(result);
        }
    };
}
//# sourceMappingURL=redis.js.map