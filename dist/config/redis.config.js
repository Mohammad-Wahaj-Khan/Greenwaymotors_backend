export function createRedisConfig(environment) {
    return {
        url: environment.REDIS_URL,
        required: environment.REDIS_REQUIRED
    };
}
//# sourceMappingURL=redis.config.js.map