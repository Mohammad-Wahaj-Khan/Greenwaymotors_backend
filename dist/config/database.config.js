export function createDatabaseConfig(environment) {
    return {
        url: environment.DATABASE_URL,
        poolMax: environment.DATABASE_POOL_MAX,
        connectionTimeoutMs: environment.DATABASE_CONNECTION_TIMEOUT_MS
    };
}
//# sourceMappingURL=database.config.js.map