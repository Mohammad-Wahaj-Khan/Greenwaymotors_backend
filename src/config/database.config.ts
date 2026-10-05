import type { Environment } from './env.js';

export function createDatabaseConfig(environment: Environment) {
  return {
    url: environment.DATABASE_URL,
    poolMax: environment.DATABASE_POOL_MAX,
    connectionTimeoutMs: environment.DATABASE_CONNECTION_TIMEOUT_MS
  } as const;
}
