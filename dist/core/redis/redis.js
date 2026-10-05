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
        }
    };
}
//# sourceMappingURL=redis.js.map