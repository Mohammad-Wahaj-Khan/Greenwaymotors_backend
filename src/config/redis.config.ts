import type { Environment } from './env.js';

export function createRedisConfig(environment: Environment) {
  return {
    url: environment.REDIS_URL,
    required: environment.REDIS_REQUIRED
  } as const;
}
