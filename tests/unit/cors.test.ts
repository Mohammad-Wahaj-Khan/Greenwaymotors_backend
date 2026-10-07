import { describe, expect, it } from 'vitest';
import { allowedWebOrigins, parseEnvironment } from '../../src/config/env.js';

const environment = parseEnvironment({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://greenway:greenway@127.0.0.1:5432/greenway',
  REDIS_URL: 'redis://127.0.0.1:6379',
  WEB_ORIGIN: 'http://localhost:3000',
  WEB_ORIGINS: 'https://preview.greenway.example, https://admin.greenway.example',
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
  MAIL_PROVIDER: 'mailpit'
});

describe('allowed web origins', () => {
  it('allows the deployed Vercel frontend and keeps configured origins', () => {
    const origins = allowedWebOrigins(environment);

    expect(origins.has('https://greenwaymotors.vercel.app')).toBe(true);
    expect(origins.has('http://localhost:3000')).toBe(true);
    expect(origins.has('https://preview.greenway.example')).toBe(true);
    expect(origins.has('https://admin.greenway.example')).toBe(true);
    expect(origins.has('https://attacker.example')).toBe(false);
  });
});
