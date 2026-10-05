import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { parseEnvironment } from '../../src/config/env.js';
import type { DatabaseConnection } from '../../src/core/db/database.js';
import type { RedisConnection } from '../../src/integrations/redis/redis.js';

const environment = parseEnvironment({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://greenway:greenway@localhost:5432/greenway_motors',
  REDIS_URL: 'redis://localhost:6379',
  WEB_ORIGIN: 'http://localhost:3000',
  COOKIE_DOMAIN: 'localhost',
  ACCESS_TOKEN_PRIVATE_KEY: 'a-development-only-signing-key-that-is-long-enough',
  ACCESS_TOKEN_PUBLIC_KEY: 'a-development-only-signing-key-that-is-long-enough',
  ACCESS_TOKEN_TTL_SECONDS: '900',
  REFRESH_TOKEN_TTL_DAYS: '30',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'greenway',
  S3_ACCESS_KEY_ID: 'minioadmin',
  S3_SECRET_ACCESS_KEY: 'minioadmin',
  MAIL_FROM: 'noreply@greenway.local',
  MAIL_PROVIDER: 'mailpit',
  LOG_LEVEL: 'fatal'
});

function dependencies(databasePing: () => Promise<void>) {
  const database: DatabaseConnection = {
    db: {} as DatabaseConnection['db'],
    ping: databasePing,
    close: () => Promise.resolve()
  };
  const redis: RedisConnection = {
    ping: () => Promise.resolve(),
    close: () => Promise.resolve(),
    incrementFixedWindow: () => Promise.resolve(1)
  };
  return { database, redis };
}

describe('health endpoints', () => {
  it('reports liveness without consulting dependencies', async () => {
    const app = createApp(
      environment,
      dependencies(() => Promise.reject(new Error('offline')))
    );
    const response = await request(app).get('/health/live');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ data: { status: 'ok' } });
    expect(response.headers['x-request-id']).toBeTypeOf('string');
  });

  it('reports readiness when required dependencies are healthy', async () => {
    const app = createApp(
      environment,
      dependencies(() => Promise.resolve())
    );
    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ data: { status: 'ok' } });
  });

  it('reports dependency failure as problem details', async () => {
    const app = createApp(
      environment,
      dependencies(() => Promise.reject(new Error('offline')))
    );
    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).toMatchObject({
      type: '/problems/dependency_unavailable',
      code: 'dependency_unavailable'
    });
  });
});
