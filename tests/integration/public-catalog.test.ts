import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { parseEnvironment } from '../../src/config/env.js';
import { createPostgresPool, type DatabaseConnection } from '../../src/core/db/database.js';
import type { EmailService } from '../../src/integrations/email/email.service.js';
import type { RedisConnection } from '../../src/integrations/redis/redis.js';
import { createApp } from '../../src/app.js';
import { applyInitialSchema, applySeeds } from '../../scripts/database-files.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl ? describe : describe.skip;

const environment = parseEnvironment({
  NODE_ENV: 'test',
  DATABASE_URL:
    databaseUrl ?? 'postgresql://greenway:greenway@127.0.0.1:55432/greenway_motors_test',
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
  LOG_LEVEL: 'fatal'
});
const email: EmailService = {
  sendVerificationEmail: () => Promise.resolve(),
  sendPasswordResetEmail: () => Promise.resolve()
};
const redis: RedisConnection = {
  ping: () => Promise.resolve(),
  close: () => Promise.resolve(),
  incrementFixedWindow: () => Promise.resolve(1)
};
const rawPool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 1 }) : undefined;
const database: DatabaseConnection | undefined = databaseUrl
  ? createPostgresPool(environment)
  : undefined;
const app = database ? createApp(environment, { database, redis, email }) : undefined;

function requireDependencies() {
  if (!rawPool || !app)
    throw new Error('DATABASE_TEST_URL is required for catalog integration tests.');
  return { rawPool, app };
}

async function createFixture() {
  const { rawPool: pool } = requireDependencies();
  const suffix = randomUUID();
  const country = await pool.query<{ id: number }>(
    "INSERT INTO countries (iso2, iso3, name) VALUES ('GW', 'GWM', $1) RETURNING id",
    [`Country ${suffix}`]
  );
  const make = await pool.query<{ id: number }>(
    'INSERT INTO makes (name, slug) VALUES ($1, $2) RETURNING id',
    [`Make ${suffix}`, `make-${suffix}`]
  );
  const model = await pool.query<{ id: number }>(
    'INSERT INTO models (make_id, name, slug) VALUES ($1, $2, $3) RETURNING id',
    [make.rows[0]!.id, `Model ${suffix}`, `model-${suffix}`]
  );
  const feature = await pool.query<{ id: number }>(
    'INSERT INTO features (name, category) VALUES ($1, $2) RETURNING id',
    [`Feature ${suffix}`, 'safety']
  );
  const published = await pool.query<{ id: string; reference_no: string }>(
    `INSERT INTO vehicles (make_id, model_id, year, mileage_km, stock_country_id, title, status, published_at, inventory_source_id)
     VALUES ($1, $2, 2024, 1000, $3, 'Published vehicle', 'published', now(), NULL) RETURNING id, reference_no`,
    [make.rows[0]!.id, model.rows[0]!.id, country.rows[0]!.id]
  );
  await pool.query('INSERT INTO vehicle_features (vehicle_id, feature_id) VALUES ($1, $2)', [
    published.rows[0]!.id,
    feature.rows[0]!.id
  ]);
  await pool.query(
    "INSERT INTO vehicle_media (vehicle_id, url, is_primary) VALUES ($1, 'https://example.test/published.jpg', true)",
    [published.rows[0]!.id]
  );
  await pool.query(
    `INSERT INTO vehicles (make_id, model_id, year, stock_country_id, title, status)
     VALUES ($1, $2, 2023, $3, 'Draft vehicle', 'draft')`,
    [make.rows[0]!.id, model.rows[0]!.id, country.rows[0]!.id]
  );
  await pool.query(
    `INSERT INTO vehicles (make_id, model_id, year, stock_country_id, title, status, published_at, deleted_at)
     VALUES ($1, $2, 2022, $3, 'Deleted vehicle', 'published', now(), now())`,
    [make.rows[0]!.id, model.rows[0]!.id, country.rows[0]!.id]
  );
  return {
    makeId: make.rows[0]!.id,
    featureId: feature.rows[0]!.id,
    referenceNo: published.rows[0]!.reference_no
  };
}

integration('public catalog and vehicle APIs', () => {
  beforeEach(async () => {
    const { rawPool: pool } = requireDependencies();
    await pool.query('DROP SCHEMA public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await applyInitialSchema(pool);
    await applySeeds(pool);
  });

  afterAll(async () => {
    await database?.close();
    await rawPool?.end();
  });

  it('returns only published, non-deleted inventory without internal source or review fields', async () => {
    const { app: api } = requireDependencies();
    const fixture = await createFixture();
    const response = await request(api).get(
      `/api/v1/vehicles?makeId=${fixture.makeId}&featureIds=${fixture.featureId}`
    );
    const body = response.body as { data: Array<Record<string, unknown>> };
    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      referenceNo: fixture.referenceNo,
      title: 'Published vehicle'
    });
    expect(JSON.stringify(response.body)).not.toContain('inventorySource');
    expect(JSON.stringify(response.body)).not.toContain('reviewNotes');
    expect(JSON.stringify(response.body)).not.toContain('stockNumber');
    expect(JSON.stringify(response.body)).not.toContain('vin');
  });

  it('returns a published vehicle detail and keeps unpublished inventory private', async () => {
    const { app: api } = requireDependencies();
    const fixture = await createFixture();
    expect((await request(api).get(`/api/v1/vehicles/${fixture.referenceNo}`)).status).toBe(200);
    expect((await request(api).get('/api/v1/vehicles/GW-999999999')).status).toBe(404);
  });

  it('rejects unsupported sorts and malformed cursors', async () => {
    const { app: api } = requireDependencies();
    await createFixture();
    expect((await request(api).get('/api/v1/vehicles?sort=price_desc')).status).toBe(422);
    expect((await request(api).get('/api/v1/vehicles?cursor=not-a-valid-cursor')).status).toBe(422);
  });
});
