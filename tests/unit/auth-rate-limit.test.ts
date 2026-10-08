import { describe, expect, it } from 'vitest';
import { parseEnvironment } from '../../src/config/env.js';
import { loginRateLimitOptions } from '../../src/modules/auth/auth.rate-limit.js';

function environment(nodeEnv: 'development' | 'test' | 'production', override?: string) {
  return parseEnvironment({
    NODE_ENV: nodeEnv,
    ...(override ? { AUTH_LOGIN_RATE_LIMIT_MAX: override } : {}),
    DATABASE_URL: 'postgresql://greenway:greenway@127.0.0.1:5432/greenway',
    REDIS_URL: 'redis://127.0.0.1:6379',
    WEB_ORIGIN: 'http://localhost:3000',
    COOKIE_DOMAIN: 'localhost',
    ACCESS_TOKEN_PRIVATE_KEY: 'test-only-signing-key-that-is-at-least-32-characters-long',
    ACCESS_TOKEN_PUBLIC_KEY: 'test-only-signing-key-that-is-at-least-32-characters-long',
    ACCESS_TOKEN_TTL_SECONDS: '900',
    REFRESH_TOKEN_TTL_DAYS: '30',
    S3_ENDPOINT: 'http://127.0.0.1:9000',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'greenway-test',
    S3_ACCESS_KEY_ID: 'minioadmin',
    S3_SECRET_ACCESS_KEY: 'minioadmin',
    MAIL_FROM: 'noreply@greenway.test',
    MAIL_PROVIDER: 'mailpit',
    DATA_ENCRYPTION_KEY: 'test-only-encryption-key-at-least-32-chars',
    REDIS_REQUIRED: nodeEnv === 'production' ? 'true' : 'false'
  });
}

describe('login rate limit by environment', () => {
  it('allows more login attempts during local development and tests', () => {
    expect(loginRateLimitOptions(environment('development'))).toEqual({
      keyPrefix: 'login',
      limit: 100,
      windowMs: 15 * 60 * 1000
    });
    expect(loginRateLimitOptions(environment('test')).limit).toBe(100);
  });

  it('keeps the production limit low unless explicitly overridden for staging', () => {
    expect(loginRateLimitOptions(environment('production')).limit).toBe(5);
    expect(loginRateLimitOptions(environment('production', '100')).limit).toBe(100);
  });
});
