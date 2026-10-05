import { createAppConfig } from './app.config.js';
import { createAuthConfig } from './auth.config.js';
import { createDatabaseConfig } from './database.config.js';
import { loadEnvironment } from './env.js';
import { createRedisConfig } from './redis.config.js';
import { createStorageConfig } from './storage.config.js';
export { parseEnvironment } from './env.js';
export function loadConfig() {
    const environment = loadEnvironment();
    return {
        environment,
        app: createAppConfig(environment),
        auth: createAuthConfig(environment),
        database: createDatabaseConfig(environment),
        redis: createRedisConfig(environment),
        storage: createStorageConfig(environment)
    };
}
//# sourceMappingURL=index.js.map