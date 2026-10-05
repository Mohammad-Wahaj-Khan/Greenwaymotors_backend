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
  const destination = await pool.query<{ id: number }>(
    "INSERT INTO countries (iso2, iso3, name) VALUES ('PK', 'PAK', $1) RETURNING id",
    [`Destination ${suffix}`]
  );
  const market = await pool.query<{ id: string }>(
    "INSERT INTO markets (country_id, slug, status, currency_code, locale) VALUES ($1, $2, 'active', 'PKR', 'en-PK') RETURNING id",
    [destination.rows[0]!.id, `pakistan-${suffix}`]
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
  const source = await pool.query<{ id: string }>(
    "INSERT INTO inventory_sources (company_name, contact_name, email) VALUES ('Private Supplier', 'Private Contact', 'supplier@example.test') RETURNING id"
  );
  await pool.query(
    "UPDATE vehicles SET inventory_source_id = $1, purchase_cost_minor = 1234500, purchase_cost_currency = 'USD', estimated_local_cost_minor = 100000, cost_notes = 'private cost note', review_notes = 'private review' WHERE id = $2",
    [source.rows[0]!.id, published.rows[0]!.id]
  );
  await pool.query(
    'INSERT INTO vehicle_markets (vehicle_id, market_id, is_active) VALUES ($1, $2, true)',
    [published.rows[0]!.id, market.rows[0]!.id]
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
    referenceNo: published.rows[0]!.reference_no,
    marketSlug: `pakistan-${suffix}`,
    vehicleId: published.rows[0]!.id,
    marketId: market.rows[0]!.id
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
      `/api/v1/vehicles?market=${fixture.marketSlug}&makeId=${fixture.makeId}&featureIds=${fixture.featureId}`
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
    expect(JSON.stringify(response.body)).not.toContain('purchaseCost');
    expect(JSON.stringify(response.body)).not.toContain('margin');
    expect(JSON.stringify(response.body)).not.toContain('Private Supplier');
    expect(JSON.stringify(response.body)).not.toContain('1234500');
    expect(JSON.stringify(response.body)).not.toContain('private cost note');
  });

  it('returns a published vehicle detail and keeps unpublished inventory private', async () => {
    const { app: api } = requireDependencies();
    const fixture = await createFixture();
    const detail = await request(api).get(
      `/api/v1/vehicles/${fixture.referenceNo}?market=${fixture.marketSlug}`
    );
    expect(detail.status).toBe(200);
    expect(JSON.stringify(detail.body)).not.toContain('Private Supplier');
    expect(JSON.stringify(detail.body)).not.toContain('1234500');
    expect(JSON.stringify(detail.body)).not.toContain('private cost note');
    expect(
      (await request(api).get(`/api/v1/vehicles/GW-999999999?market=${fixture.marketSlug}`)).status
    ).toBe(404);
  });

  it('rejects unsupported sorts and malformed cursors', async () => {
    const { app: api } = requireDependencies();
    const fixture = await createFixture();
    expect(
      (await request(api).get(`/api/v1/vehicles?market=${fixture.marketSlug}&sort=price_desc`))
        .status
    ).toBe(422);
    expect(
      (
        await request(api).get(
          `/api/v1/vehicles?market=${fixture.marketSlug}&cursor=not-a-valid-cursor`
        )
      ).status
    ).toBe(422);
  });

  it('requires explicit active destination eligibility and commercial availability', async () => {
    const { app: api, rawPool: pool } = requireDependencies();
    const fixture = await createFixture();
    const url = `/api/v1/vehicles?market=${fixture.marketSlug}`;
    expect((await request(api).get('/api/v1/vehicles')).status).toBe(422);
    expect(
      ((await request(api).get('/api/v1/vehicles?market=unknown')).body as { data: unknown[] }).data
    ).toHaveLength(0);
    await pool.query("UPDATE markets SET status = 'inactive' WHERE id = $1", [fixture.marketId]);
    expect(((await request(api).get(url)).body as { data: unknown[] }).data).toHaveLength(0);
    expect((await request(api).get(`/api/v1/markets/${fixture.marketSlug}`)).status).toBe(404);
    await pool.query("UPDATE markets SET status = 'active' WHERE id = $1", [fixture.marketId]);
    await pool.query('UPDATE vehicle_markets SET is_active = false WHERE vehicle_id = $1', [
      fixture.vehicleId
    ]);
    expect(((await request(api).get(url)).body as { data: unknown[] }).data).toHaveLength(0);
    await pool.query('UPDATE vehicle_markets SET is_active = true WHERE vehicle_id = $1', [
      fixture.vehicleId
    ]);
    await pool.query("UPDATE vehicles SET availability_status = 'reserved' WHERE id = $1", [
      fixture.vehicleId
    ]);
    expect(((await request(api).get(url)).body as { data: unknown[] }).data).toHaveLength(0);
    expect(
      (
        await request(api).get(
          `/api/v1/vehicles/${fixture.referenceNo}?market=${fixture.marketSlug}`
        )
      ).status
    ).toBe(404);
  });
});
