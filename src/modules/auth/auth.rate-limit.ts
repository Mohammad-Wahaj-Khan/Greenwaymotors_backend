import type { Environment } from '../../config/env.js';

const loginWindowMs = 15 * 60 * 1000;

export function loginRateLimitOptions(
  environment: Pick<Environment, 'NODE_ENV' | 'AUTH_LOGIN_RATE_LIMIT_MAX'>
): { keyPrefix: string; limit: number; windowMs: number } {
  return {
    keyPrefix: 'login',
    limit:
      environment.AUTH_LOGIN_RATE_LIMIT_MAX ?? (environment.NODE_ENV === 'production' ? 5 : 1000),
    windowMs: loginWindowMs
  };
}
