import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../../src/app.js';
import { parseEnvironment } from '../../src/config/env.js';
import { hashPassword } from '../../src/core/auth/password.js';
import { createPostgresPool } from '../../src/core/db/database.js';
import { decryptJson } from '../../src/core/security/encryption.js';
import { totpCode } from '../../src/core/auth/totp.js';
import { processOutboxEvent } from '../../src/integrations/outbox/outbox-worker.js';
import type { EmailService } from '../../src/integrations/email/email.service.js';
import type { RedisConnection } from '../../src/integrations/redis/redis.js';
import type { ObjectStorage } from '../../src/integrations/storage/object-storage.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { applyInitialSchema, applySeeds } from '../../scripts/database-files.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl ? describe : describe.skip;
const environment = parseEnvironment({
  NODE_ENV: 'test',
  TRUST_PROXY_HOPS: '1',
  DATABASE_URL: databaseUrl ?? 'postgresql://postgres@127.0.0.1:55434/greenway_phase23_test',
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
  sendPasswordResetEmail: () => Promise.resolve(),
  sendPasswordChangedEmail: () => Promise.resolve()
};
const redis: RedisConnection = {
  ping: () => Promise.resolve(),
  close: () => Promise.resolve(),
  incrementFixedWindow: () => Promise.resolve(1)
};
const storage: ObjectStorage = {
  createUpload: (key) =>
    Promise.resolve({
      uploadUrl: 'http://upload.test/' + key,
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' }
    }),
  head: () => Promise.resolve({ mimeType: 'image/jpeg', sizeBytes: 1234 }),
  publicUrl: (key) => 'http://media.test/' + key
};
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 1 }) : undefined;
const database = databaseUrl ? createPostgresPool(environment) : undefined;
const app = database ? createApp(environment, { database, redis, email, storage }) : undefined;
const auth = database ? new AuthService(database.db, environment) : undefined;

function requireDependencies() {
  if (!pool || !app || !auth) throw new Error('DATABASE_TEST_URL is required.');
  if (!database) throw new Error('DATABASE_TEST_URL is required.');
  return { pool, app, auth, db: database.db };
}
async function staff(role: string) {
  const { pool, auth } = requireDependencies();
  const id = randomUUID();
  const emailAddress = `${role}-${id}@example.test`;
  await pool.query(
    `INSERT INTO users (id,user_type,email,password_hash,full_name)
    VALUES ($1,'staff',$2,$3,$4)`,
    [id, emailAddress, await hashPassword('strong-password-123'), role]
  );
  await pool.query(
    `INSERT INTO user_roles (user_id,role_id) SELECT $1,id FROM roles WHERE name=$2`,
    [id, role]
  );
  const session = await auth.login({ email: emailAddress, password: 'strong-password-123' }, {});
  if ('mfaChallengeRequired' in session) throw new Error('Unexpected MFA challenge in test setup.');
  return {
    id,
    email: emailAddress,
    token: session.accessToken
  };
}
async function customer() {
  const { pool, auth } = requireDependencies();
  const id = randomUUID();
  const emailAddress = `customer-${id}@example.test`;
  await pool.query(
    `INSERT INTO users (id,user_type,email,password_hash,full_name,phone,whatsapp,preferred_contact)
    VALUES ($1,'customer',$2,$3,'Test Buyer','+1-555-0100','+1-555-0101','whatsapp')`,
    [id, emailAddress, await hashPassword('strong-password-123')]
  );
  const session = await auth.login({ email: emailAddress, password: 'strong-password-123' }, {});
  if ('mfaChallengeRequired' in session) throw new Error('Unexpected MFA challenge in test setup.');
  return { id, email: emailAddress, token: session.accessToken };
}
async function fixture() {
  const { pool } = requireDependencies();
  const stock = await pool.query<{ id: number }>(
    "INSERT INTO countries (iso2,iso3,name) VALUES ('JP','JPN','Japan') RETURNING id"
  );
  const destination = await pool.query<{ id: number }>(
    "INSERT INTO countries (iso2,iso3,name) VALUES ('PK','PAK','Pakistan') RETURNING id"
  );
  const make = await pool.query<{ id: number }>(
    "INSERT INTO makes (name,slug) VALUES ('Toyota','toyota') RETURNING id"
  );
  const model = await pool.query<{ id: number }>(
    "INSERT INTO models (make_id,name,slug) VALUES ($1,'Corolla','corolla') RETURNING id",
    [make.rows[0]!.id]
  );
  const feature = await pool.query<{ id: number }>(
    "INSERT INTO features (name) VALUES ('ABS') RETURNING id"
  );
  const market = await pool.query<{ id: string }>(
    "INSERT INTO markets (country_id,slug,status,currency_code,locale) VALUES ($1,'pakistan','active','PKR','en-PK') RETURNING id",
    [destination.rows[0]!.id]
  );
  const source = await pool.query<{ id: string }>(
    "INSERT INTO inventory_sources (company_name,contact_name,email) VALUES ('Secret Supplier','Secret Contact','secret@example.test') RETURNING id"
  );
  const vehicle = await pool.query<{ id: string; reference_no: string }>(
    `INSERT INTO vehicles (make_id,model_id,year,stock_country_id,title,status,published_at,inventory_source_id,purchase_cost_minor,purchase_cost_currency)
     VALUES ($1,$2,2024,$3,'Exact Corolla','published',now(),$4,1234500,'USD') RETURNING id,reference_no`,
    [make.rows[0]!.id, model.rows[0]!.id, stock.rows[0]!.id, source.rows[0]!.id]
  );
  await pool.query(
    'INSERT INTO vehicle_markets (vehicle_id,market_id,is_active) VALUES ($1,$2,true)',
    [vehicle.rows[0]!.id, market.rows[0]!.id]
  );
  return {
    stockId: stock.rows[0]!.id,
    destinationId: destination.rows[0]!.id,
    makeId: make.rows[0]!.id,
    modelId: model.rows[0]!.id,
    featureId: feature.rows[0]!.id,
    marketId: market.rows[0]!.id,
    sourceId: source.rows[0]!.id,
    vehicleId: vehicle.rows[0]!.id,
    referenceNo: vehicle.rows[0]!.reference_no
  };
}

integration('Phase 2–3 inventory and CRM APIs', () => {
  beforeEach(async () => {
    const { pool } = requireDependencies();
    await pool.query('DROP SCHEMA public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await applyInitialSchema(pool);
    await applySeeds(pool);
  });
  it('protects source and costing data while publication obeys destination eligibility', async () => {
    const { app: api, pool } = requireDependencies();
    const owner = await staff('super_admin');
    const content = await staff('content_manager');
    const f = await fixture();
    expect((await request(api).get('/api/v1/admin/inventory-sources')).status).toBe(401);
    expect(
      (
        await request(api)
          .get('/api/v1/admin/inventory-sources')
          .set('Authorization', `Bearer ${content.token}`)
      ).status
    ).toBe(403);
    const publicResponse = await request(api).get('/api/v1/vehicles');
    expect(publicResponse.status).toBe(200);
    expect(JSON.stringify(publicResponse.body)).not.toContain('Secret Supplier');
    expect(JSON.stringify(publicResponse.body)).not.toContain('1234500');
    const costDenied = await request(api)
      .get(`/api/v1/admin/vehicles/${f.vehicleId}/costing`)
      .set('Authorization', `Bearer ${content.token}`);
    expect(costDenied.status).toBe(403);
    const cost = await request(api)
      .get(`/api/v1/admin/vehicles/${f.vehicleId}/costing`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(cost.status).toBe(200);
    const newSource = await request(api)
      .post('/api/v1/admin/inventory-sources')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ companyName: 'Another Internal Source', sourceCode: 'SRC-2' });
    expect(newSource.status).toBe(201);
    const createdVehicle = await request(api)
      .post('/api/v1/admin/vehicles')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        makeId: f.makeId,
        modelId: f.modelId,
        stockCountryId: f.stockId,
        title: 'Second Corolla',
        year: 2023,
        inventorySourceId: (newSource.body as { data: { id: string } }).data.id
      });
    expect(createdVehicle.status).toBe(201);
    const id = (createdVehicle.body as { data: { id: string } }).data.id;
    expect(
      (
        await request(api)
          .post(`/api/v1/admin/vehicles/${id}/publish`)
          .set('Authorization', `Bearer ${owner.token}`)
      ).status
    ).toBe(409);
    expect(
      (
        await request(api)
          .put(`/api/v1/admin/vehicles/${id}/markets`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ markets: [{ marketId: f.marketId, isActive: true }] })
      ).status
    ).toBe(200);
    expect(
      (
        await request(api)
          .post(`/api/v1/admin/vehicles/${id}/publish`)
          .set('Authorization', `Bearer ${owner.token}`)
      ).status
    ).toBe(200);
    expect(
      ((await request(api).get('/api/v1/vehicles')).body as { data: unknown[] }).data
    ).toHaveLength(2);
    expect(
      (
        await request(api)
          .post(`/api/v1/admin/vehicles/${id}/mark-unavailable`)
          .set('Authorization', `Bearer ${owner.token}`)
      ).status
    ).toBe(200);
    expect(
      ((await request(api).get('/api/v1/vehicles')).body as { data: unknown[] }).data
    ).toHaveLength(1);
    expect(
      (
        await request(api)
          .post(`/api/v1/admin/vehicles/${id}/mark-available`)
          .set('Authorization', `Bearer ${owner.token}`)
      ).status
    ).toBe(200);
    expect(
      (
        await request(api)
          .post(`/api/v1/admin/vehicles/${id}/unpublish`)
          .set('Authorization', `Bearer ${owner.token}`)
      ).status
    ).toBe(200);
    expect(
      ((await request(api).get('/api/v1/vehicles')).body as { data: unknown[] }).data
    ).toHaveLength(1);
    await pool.query("UPDATE markets SET status='inactive' WHERE id=$1", [f.marketId]);
    expect(
      ((await request(api).get('/api/v1/vehicles')).body as { data: unknown[] }).data
    ).toHaveLength(0);
  });

  it('queues encrypted verification mail, enforces notification ownership, and revokes suspended staff sessions', async () => {
    const { app: api, pool, db } = requireDependencies();
    const emailAddress = `customer-${randomUUID()}@example.test`;
    const registration = await request(api).post('/api/v1/auth/customers/register').send({
      email: emailAddress,
      password: 'customer-password-123',
      fullName: 'Test Customer'
    });
    expect(registration.status).toBe(201);
    expect(JSON.stringify(registration.body)).not.toContain('verificationToken');
    const queued = await pool.query<{ payload: { ciphertext: string } }>(
      "SELECT payload FROM outbox_events WHERE topic='email.verification' ORDER BY created_at DESC LIMIT 1"
    );
    expect(queued.rows[0]!.payload.ciphertext).not.toContain(emailAddress);
    expect(
      decryptJson<{ email: string; token: string }>(environment, queued.rows[0]!.payload.ciphertext)
        .email
    ).toBe(emailAddress);
    expect(await processOutboxEvent(db, environment, email, pino({ level: 'silent' }))).toBe(true);
    const completedEvent = await pool.query<{ status: string; payload: { ciphertext?: string } }>(
      "SELECT status,payload FROM outbox_events WHERE topic='email.verification' ORDER BY created_at DESC LIMIT 1"
    );
    expect(completedEvent.rows[0]?.status).toBe('completed');
    expect(completedEvent.rows[0]?.payload.ciphertext).toBe(queued.rows[0]!.payload.ciphertext);

    const login = await request(api).post('/api/v1/auth/login').send({
      email: emailAddress,
      password: 'customer-password-123'
    });
    const customerId = (registration.body as { data: { id: string } }).data.id;
    const other = await request(api)
      .post('/api/v1/auth/customers/register')
      .send({
        email: `other-${randomUUID()}@example.test`,
        password: 'customer-password-123',
        fullName: 'Other Customer'
      });
    const otherId = (other.body as { data: { id: string } }).data.id;
    const notification = await pool.query<{ id: string }>(
      "INSERT INTO notifications(user_id,type,title) VALUES($1,'test','Private notice') RETURNING id",
      [otherId]
    );
    const token = (login.body as { data: { accessToken: string } }).data.accessToken;
    expect(customerId).not.toBe(otherId);
    expect(
      (
        await request(api)
          .get(`/api/v1/me/notifications/${notification.rows[0]!.id}/read`)
          .set('Authorization', `Bearer ${token}`)
      ).status
    ).toBe(404);
    expect(
      (
        await request(api)
          .patch(`/api/v1/me/notifications/${notification.rows[0]!.id}/read`)
          .set('Authorization', `Bearer ${token}`)
          .send({})
      ).status
    ).toBe(404);

    const passwordChange = await request(api)
      .post('/api/v1/auth/me/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'customer-password-123', newPassword: 'customer-password-456' });
    expect(passwordChange.status).toBe(200);
    expect(
      (passwordChange.body as { data: { refreshSessionsRevoked: boolean } }).data
        .refreshSessionsRevoked
    ).toBe(true);
    expect(
      (
        await request(api)
          .post('/api/v1/auth/login')
          .send({ email: emailAddress, password: 'customer-password-123' })
      ).status
    ).toBe(401);
    expect(
      (
        await request(api)
          .post('/api/v1/auth/login')
          .send({ email: emailAddress, password: 'customer-password-456' })
      ).status
    ).toBe(200);

    const administrator = await staff('super_admin');
    const target = await staff('sales_agent');
    expect(
      (
        await request(api)
          .post(`/api/v1/admin/staff/${target.id}/suspend`)
          .set('Authorization', `Bearer ${administrator.token}`)
          .send({})
      ).status
    ).toBe(200);
    expect(
      (
        await request(api)
          .get('/api/v1/admin/dashboard/summary')
          .set('Authorization', `Bearer ${target.token}`)
      ).status
    ).toBe(401);
  });

  it('executes bounded dashboards and reports, enforces CMS separation, and keeps imports as drafts', async () => {
    const { app: api, pool } = requireDependencies();
    const administrator = await staff('super_admin');
    for (const endpoint of [
      '/api/v1/admin/dashboard/summary',
      '/api/v1/admin/dashboard/leads',
      '/api/v1/admin/dashboard/inventory',
      '/api/v1/admin/dashboard/sales',
      '/api/v1/admin/dashboard/followups',
      '/api/v1/admin/reports/leads',
      '/api/v1/admin/reports/sales',
      '/api/v1/admin/reports/inventory',
      '/api/v1/admin/reports/vehicles',
      '/api/v1/admin/reports/markets',
      '/api/v1/admin/reports/salespeople',
      '/api/v1/admin/reports/sources',
      '/api/v1/admin/reports/lost-reasons',
      '/api/v1/admin/audit-logs'
    ]) {
      const result = await request(api)
        .get(endpoint)
        .set('Authorization', `Bearer ${administrator.token}`);
      expect(result.status, `${endpoint}: ${JSON.stringify(result.body)}`).toBe(200);
    }
    const content = await staff('content_manager');
    const f = await fixture();
    const cms = await request(api)
      .post('/api/v1/admin/content/pages')
      .set('Authorization', `Bearer ${content.token}`)
      .send({ slug: 'about-us', title: 'About GreenWay', content: { html: '<p>About</p>' } });
    expect(cms.status).toBe(201);
    const blog = await request(api)
      .post('/api/v1/admin/content/blog')
      .set('Authorization', `Bearer ${content.token}`)
      .send({
        slug: 'market-blog',
        title: 'Pakistan news',
        content: { html: '<p>Market</p>' },
        markets: [f.marketId]
      });
    expect(blog.status).toBe(201);
    const blogId = (blog.body as { data: { id: string } }).data.id;
    expect(
      (
        await request(api)
          .post(`/api/v1/admin/content/blog/${blogId}/publish`)
          .set('Authorization', `Bearer ${content.token}`)
          .send({})
      ).status
    ).toBe(200);
    const matchingBlogs = await request(api).get('/api/v1/content/blog');
    const unmatchedBlogs = await request(api).get('/api/v1/content/blog?market=unassigned');
    expect(matchingBlogs.status, JSON.stringify(matchingBlogs.body)).toBe(200);
    expect(unmatchedBlogs.status, JSON.stringify(unmatchedBlogs.body)).toBe(200);
    expect((matchingBlogs.body as { data: unknown[] }).data).toHaveLength(1);
    expect((unmatchedBlogs.body as { data: unknown[] }).data).toHaveLength(0);
    const costDenied = await request(api)
      .get(`/api/v1/admin/vehicles/${randomUUID()}/costing`)
      .set('Authorization', `Bearer ${content.token}`);
    expect(costDenied.status).toBe(403);

    const imported = await request(api)
      .post('/api/v1/admin/vehicle-imports')
      .set('Authorization', `Bearer ${administrator.token}`)
      .send({
        rows: [
          {
            makeId: f.makeId,
            modelId: f.modelId,
            stockCountryId: f.stockId,
            title: 'Imported Draft',
            year: 2022,
            inventorySourceId: f.sourceId
          }
        ]
      });
    expect(imported.status).toBe(201);
    expect((imported.body as { data: { imported: number; failed: number } }).data).toMatchObject({
      imported: 1,
      failed: 0
    });
    const state = await pool.query<{ status: string }>(
      "SELECT status FROM vehicles WHERE title='Imported Draft'"
    );
    expect(state.rows[0]?.status).toBe('draft');
    const csv = await request(api)
      .post('/api/v1/admin/vehicle-imports')
      .set('Authorization', `Bearer ${administrator.token}`)
      .send({
        csv: `makeId,modelId,stockCountryId,title,year,inventorySourceId\n${f.makeId},${f.modelId},${f.stockId},"Imported, CSV Draft",2021,${f.sourceId}`
      });
    expect(csv.status, JSON.stringify(csv.body)).toBe(201);
    expect((csv.body as { data: { imported: number; failed: number } }).data).toMatchObject({
      imported: 1,
      failed: 0
    });
    const csvVehicle = await pool.query<{ status: string }>(
      'SELECT status FROM vehicles WHERE title=$1',
      ['Imported, CSV Draft']
    );
    expect(csvVehicle.rows[0]?.status).toBe('draft');
  });

  it('enrolls staff MFA, issues a one-time recovery code, and requires a fresh login challenge', async () => {
    const { app: api } = requireDependencies();
    const administrator = await staff('admin');
    const enrollmentResponse = await request(api)
      .post('/api/v1/auth/me/mfa/enroll')
      .set('Authorization', `Bearer ${administrator.token}`);
    expect(enrollmentResponse.status).toBe(201);
    const enrollment = (
      enrollmentResponse.body as {
        data: { secret: string; otpauthUrl: string };
      }
    ).data;
    expect(enrollment.otpauthUrl).toContain(`secret=${enrollment.secret}`);
    const confirmed = await request(api)
      .post('/api/v1/auth/me/mfa/confirm')
      .set('Authorization', `Bearer ${administrator.token}`)
      .send({ code: totpCode(enrollment.secret) });
    expect(confirmed.status).toBe(200);
    const recoveryCodes = (confirmed.body as { data: { recoveryCodes: string[] } }).data
      .recoveryCodes;
    expect(recoveryCodes).toHaveLength(10);
    const verifiedAccessToken = (confirmed.body as { data: { accessToken: string } }).data
      .accessToken;
    const oldNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const blocked = await request(api)
        .get('/api/v1/admin/dashboard/summary')
        .set('Authorization', `Bearer ${administrator.token}`);
      expect(blocked.status).toBe(403);
      const allowed = await request(api)
        .get('/api/v1/admin/dashboard/summary')
        .set('Authorization', `Bearer ${verifiedAccessToken}`);
      expect(allowed.status).toBe(200);
    } finally {
      if (oldNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = oldNodeEnv;
    }
    const login = await request(api).post('/api/v1/auth/login').send({
      email: administrator.email,
      password: 'strong-password-123'
    });
    expect(login.status).toBe(202);
    const challengeToken = (login.body as { data: { challengeToken: string } }).data.challengeToken;
    const challenged = await request(api).post('/api/v1/auth/mfa/challenge').send({
      challengeToken,
      code: recoveryCodes[0]
    });
    expect(challenged.status).toBe(200);
    expect((challenged.body as { data: { accessToken: string } }).data.accessToken).toBeTruthy();
    const nextLogin = await request(api).post('/api/v1/auth/login').send({
      email: administrator.email,
      password: 'strong-password-123'
    });
    expect(nextLogin.status).toBe(202);
    const nextChallengeToken = (nextLogin.body as { data: { challengeToken: string } }).data
      .challengeToken;
    await expect(
      request(api).post('/api/v1/auth/mfa/challenge').send({
        challengeToken: nextChallengeToken,
        code: recoveryCodes[0]
      })
    ).resolves.toMatchObject({ status: 401 });
  });

  it('uses completed upload intents and maintains one primary image', async () => {
    const { app: api } = requireDependencies();
    const owner = await staff('super_admin');
    const f = await fixture();
    const create = async () => {
      const presign = await request(api)
        .post('/api/v1/admin/uploads/presign')
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ purpose: 'vehicle_media', mimeType: 'image/jpeg', sizeBytes: 1234 });
      expect(presign.status).toBe(201);
      const intent = (presign.body as { data: { uploadIntentId: string } }).data.uploadIntentId;
      expect(
        (
          await request(api)
            .post('/api/v1/admin/uploads/complete')
            .set('Authorization', `Bearer ${owner.token}`)
            .send({ uploadIntentId: intent })
        ).status
      ).toBe(200);
      return intent;
    };
    const first = await create();
    expect(
      (
        await request(api)
          .post(`/api/v1/admin/vehicles/${f.vehicleId}/media`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ uploadIntentId: first, isPrimary: true })
      ).status
    ).toBe(201);
    const second = await create();
    expect(
      (
        await request(api)
          .post(`/api/v1/admin/vehicles/${f.vehicleId}/media`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ uploadIntentId: second, isPrimary: true })
      ).status
    ).toBe(201);
    const media = await request(api)
      .get(`/api/v1/admin/vehicles/${f.vehicleId}/media`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(
      (media.body as { data: Array<{ isPrimary: boolean }> }).data.filter((item) => item.isPrimary)
    ).toHaveLength(1);
  });

  it('creates customer leads idempotently and enforces sales scope, transitions and follow-up ownership', async () => {
    const { app: api, pool } = requireDependencies();
    const f = await fixture();
    const buyer = await customer();
    const manager = await staff('sales_manager');
    const agent = await staff('sales_agent');
    const other = await staff('sales_agent');
    const payload = {
      vehicleReferenceNo: f.referenceNo,
      marketSlug: 'pakistan',
      consentGiven: true
    };
    const key = `lead-${randomUUID()}`;
    expect(
      (await request(api).post('/api/v1/leads').set('Idempotency-Key', key).send(payload)).status
    ).toBe(401);
    expect(
      (
        await request(api)
          .post('/api/v1/leads')
          .set('Authorization', `Bearer ${manager.token}`)
          .set('Idempotency-Key', `lead-${randomUUID()}`)
          .send(payload)
      ).status
    ).toBe(403);
    expect(
      (
        await request(api)
          .post('/api/v1/leads')
          .set('Authorization', `Bearer ${buyer.token}`)
          .set('Idempotency-Key', key)
          .send({ ...payload, inventorySourceId: f.sourceId })
      ).status
    ).toBe(422);
    expect(
      (
        await request(api)
          .post('/api/v1/leads')
          .set('Authorization', `Bearer ${buyer.token}`)
          .set('Idempotency-Key', `lead-${randomUUID()}`)
          .send({ ...payload, contactEmail: 'spoofed@example.test' })
      ).status
    ).toBe(422);
    const created = await request(api)
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${buyer.token}`)
      .set('Idempotency-Key', key)
      .send(payload);
    expect(created.status).toBe(201);
    const ref = (created.body as { data: { referenceNo: string } }).data.referenceNo;
    expect(
      (
        (
          await request(api)
            .post('/api/v1/leads')
            .set('Authorization', `Bearer ${buyer.token}`)
            .set('Idempotency-Key', key)
            .send(payload)
        ).body as { data: { referenceNo: string } }
      ).data.referenceNo
    ).toBe(ref);
    expect(
      (
        await request(api)
          .post('/api/v1/leads')
          .set('Authorization', `Bearer ${buyer.token}`)
          .set('Idempotency-Key', key)
          .send({ ...payload, message: 'A different quote request' })
      ).status
    ).toBe(409);
    const count = await pool.query<{ count: string }>('SELECT count(*) FROM leads');
    expect(count.rows[0]!.count).toBe('1');
    const snapshot = await pool.query<{ vehicle_snapshot: Record<string, unknown> }>(
      'SELECT vehicle_snapshot FROM leads WHERE reference_no=$1',
      [ref]
    );
    const customerLead = await pool.query<{
      contact_name: string;
      contact_email: string;
      contact_whatsapp: string | null;
      customer_id: string;
    }>(
      'SELECT customer_id,contact_name,contact_email,contact_whatsapp FROM leads WHERE reference_no=$1',
      [ref]
    );
    expect(customerLead.rows[0]).toMatchObject({
      customer_id: buyer.id,
      contact_name: 'Test Buyer',
      contact_email: buyer.email,
      contact_whatsapp: '+1-555-0101'
    });
    expect(snapshot.rows[0]!.vehicle_snapshot).toMatchObject({
      referenceNo: f.referenceNo,
      title: 'Exact Corolla'
    });
    expect(JSON.stringify(snapshot.rows[0]!.vehicle_snapshot)).not.toContain('Secret Supplier');
    expect(
      (
        await request(api)
          .get(`/api/v1/staff/leads/${ref}`)
          .set('Authorization', `Bearer ${agent.token}`)
      ).status
    ).toBe(404);
    expect(
      (
        await request(api)
          .post(`/api/v1/staff/leads/${ref}/assign`)
          .set('Authorization', `Bearer ${manager.token}`)
          .send({ assignedTo: randomUUID() })
      ).status
    ).toBe(422);
    expect(
      (
        await request(api)
          .post(`/api/v1/staff/leads/${ref}/assign`)
          .set('Authorization', `Bearer ${manager.token}`)
          .send({ assignedTo: agent.id })
      ).status
    ).toBe(200);
    expect(
      (
        await request(api)
          .get(`/api/v1/staff/leads/${ref}`)
          .set('Authorization', `Bearer ${agent.token}`)
      ).status
    ).toBe(200);
    expect(
      (
        await request(api)
          .get(`/api/v1/staff/leads/${ref}`)
          .set('Authorization', `Bearer ${other.token}`)
      ).status
    ).toBe(404);
    expect(
      (
        await request(api)
          .patch(`/api/v1/staff/leads/${ref}/status`)
          .set('Authorization', `Bearer ${agent.token}`)
          .send({ status: 'qualified' })
      ).status
    ).toBe(409);
    expect(
      (
        await request(api)
          .patch(`/api/v1/staff/leads/${ref}/status`)
          .set('Authorization', `Bearer ${agent.token}`)
          .send({ status: 'contacted' })
      ).status
    ).toBe(200);
    expect(
      (
        await request(api)
          .post(`/api/v1/staff/leads/${ref}/activities`)
          .set('Authorization', `Bearer ${agent.token}`)
          .send({ type: 'created', body: 'forged' })
      ).status
    ).toBe(422);
    const followup = await request(api)
      .post(`/api/v1/staff/leads/${ref}/followups`)
      .set('Authorization', `Bearer ${agent.token}`)
      .send({ dueAt: new Date(Date.now() + 86400000).toISOString(), note: 'Call buyer' });
    expect(followup.status).toBe(201);
    const followupId = (followup.body as { data: { id: string } }).data.id;
    expect(
      (
        await request(api)
          .post(`/api/v1/staff/followups/${followupId}/complete`)
          .set('Authorization', `Bearer ${other.token}`)
      ).status
    ).toBe(404);
    expect(
      (
        await request(api)
          .post(`/api/v1/staff/followups/${followupId}/complete`)
          .set('Authorization', `Bearer ${agent.token}`)
      ).status
    ).toBe(200);
    const completedLead = await request(api)
      .patch(`/api/v1/staff/leads/${ref}/status`)
      .set('Authorization', `Bearer ${agent.token}`)
      .send({ status: 'completed' });
    expect(completedLead.status).toBe(200);
    expect((completedLead.body as { data: { status: string } }).data.status).toBe('completed');
    const completedList = await request(api)
      .get('/api/v1/staff/leads?status=completed')
      .set('Authorization', `Bearer ${manager.token}`);
    expect(completedList.status).toBe(200);
    expect(
      (completedList.body as { data: Array<{ referenceNo: string }> }).data.map(
        (item) => item.referenceNo
      )
    ).toContain(ref);
    expect(
      (
        await request(api)
          .post(`/api/v1/staff/leads/${ref}/assign`)
          .set('Authorization', `Bearer ${manager.token}`)
          .send({ assignedTo: other.id })
      ).status
    ).toBe(409);
    expect(
      (
        await request(api)
          .post(`/api/v1/staff/leads/${ref}/reopen`)
          .set('Authorization', `Bearer ${manager.token}`)
      ).status
    ).toBe(409);
    expect(
      (
        await request(api)
          .patch(`/api/v1/staff/leads/${ref}/status`)
          .set('Authorization', `Bearer ${manager.token}`)
          .send({ status: 'contacted' })
      ).status
    ).toBe(409);
    expect(
      (
        await request(api)
          .post(`/api/v1/staff/followups/${followupId}/complete`)
          .set('Authorization', `Bearer ${agent.token}`)
      ).status
    ).toBe(200);
    await pool.query("UPDATE vehicles SET availability_status='unavailable' WHERE id=$1", [
      f.vehicleId
    ]);
    expect(
      (
        await request(api)
          .post('/api/v1/leads')
          .set('Authorization', `Bearer ${buyer.token}`)
          .set('X-Forwarded-For', '192.0.2.11')
          .set('Idempotency-Key', `lead-${randomUUID()}`)
          .send(payload)
      ).status
    ).toBe(404);
    await pool.query("UPDATE vehicles SET availability_status='available' WHERE id=$1", [
      f.vehicleId
    ]);
    await pool.query('UPDATE vehicle_markets SET is_active=false WHERE vehicle_id=$1', [
      f.vehicleId
    ]);
    expect(
      (
        await request(api)
          .post('/api/v1/leads')
          .set('Authorization', `Bearer ${buyer.token}`)
          .set('X-Forwarded-For', '192.0.2.12')
          .set('Idempotency-Key', `lead-${randomUUID()}`)
          .send(payload)
      ).status
    ).toBe(404);
    await pool.query('UPDATE vehicle_markets SET is_active=true WHERE vehicle_id=$1', [
      f.vehicleId
    ]);
    await pool.query("UPDATE markets SET status='inactive' WHERE id=$1", [f.marketId]);
    expect(
      (
        await request(api)
          .post('/api/v1/leads')
          .set('Authorization', `Bearer ${buyer.token}`)
          .set('X-Forwarded-For', '192.0.2.13')
          .set('Idempotency-Key', `lead-${randomUUID()}`)
          .send(payload)
      ).status
    ).toBe(404);
  });
});

integration('Phase 4–5 commercial workflow', () => {
  beforeEach(async () => {
    const { pool } = requireDependencies();
    await pool.query('DROP SCHEMA public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await applyInitialSchema(pool);
    await applySeeds(pool);
  });

  it('converts an accepted quote through one deal and completes exact-vehicle fulfillment', async () => {
    const { app: api, pool } = requireDependencies();
    const agent = await staff('sales_agent');
    const otherAgent = await staff('sales_agent');
    const manager = await staff('sales_manager');
    const f = await fixture();
    await pool.query(
      "UPDATE vehicles SET purchase_cost_currency='PKR', estimated_local_cost_minor=250000 WHERE id=$1",
      [f.vehicleId]
    );
    const lead = await pool.query<{ id: string; reference_no: string }>(
      `INSERT INTO leads (vehicle_id,vehicle_snapshot,contact_name,contact_email,status,assigned_to,market_id)
       VALUES ($1,'{"title":"Exact Corolla"}','Quote Buyer','buyer@example.test','qualified',$2,$3)
       RETURNING id,reference_no`,
      [f.vehicleId, agent.id, f.marketId]
    );
    const leadRef = lead.rows[0]!.reference_no;
    const created = await request(api)
      .post(`/api/v1/staff/leads/${leadRef}/quotes`)
      .set('Authorization', `Bearer ${agent.token}`)
      .send({});
    expect(created.status).toBe(201);
    const quoteRef = (created.body as { data: { referenceNo: string } }).data.referenceNo;
    expect(
      (
        await request(api)
          .get(`/api/v1/staff/quotes/${quoteRef}`)
          .set('Authorization', `Bearer ${otherAgent.token}`)
      ).status
    ).toBe(404);

    const forged = await request(api)
      .post(`/api/v1/staff/quotes/${quoteRef}/versions`)
      .set('Authorization', `Bearer ${agent.token}`)
      .send({
        validUntil: new Date(Date.now() + 86400000).toISOString(),
        internalTotalCostMinor: 1,
        marginMinor: 1
      });
    expect(forged.status).toBe(422);
    expect(
      (
        await pool.query('SELECT status,deleted_at,availability_status FROM vehicles WHERE id=$1', [
          f.vehicleId
        ])
      ).rows[0]
    ).toMatchObject({ status: 'published', deleted_at: null, availability_status: 'available' });
    const versionInput = (label: string) => ({
      markupBps: 1000,
      validUntil: new Date(Date.now() + 86400000).toISOString(),
      internalNotes: 'private pricing note',
      items: [{ kind: 'documentation', label, quantity: 1, unitAmountMinor: 12500 }]
    });
    const v1 = await request(api)
      .post(`/api/v1/staff/quotes/${quoteRef}/versions`)
      .set('Authorization', `Bearer ${agent.token}`)
      .send(versionInput('Paperwork'));
    expect(v1.status, v1.text).toBe(201);
    const v1Data = (v1.body as { data: { customerTotalMinor: string; internal?: unknown } }).data;
    expect(v1Data.customerTotalMinor).toBe('1645450');
    expect(v1Data.internal).toBeUndefined();
    const costVersion = await request(api)
      .get(`/api/v1/staff/quotes/${quoteRef}/versions/1`)
      .set('Authorization', `Bearer ${manager.token}`);
    const costData = (
      costVersion.body as {
        data: {
          internal: { internalTotalCostMinor: string; marginMinor: string; source?: unknown };
        };
      }
    ).data;
    expect(costData.internal.internalTotalCostMinor).toBe('1484500');
    expect(costData.internal.marginMinor).toBe('160950');
    expect(costData.internal.source).toBeUndefined();
    expect(
      (
        await request(api)
          .post(`/api/v1/staff/quotes/${quoteRef}/send`)
          .set('Authorization', `Bearer ${agent.token}`)
          .set('Idempotency-Key', `send-v1-${randomUUID()}`)
          .send({})
      ).status
    ).toBe(200);
    const v2 = await request(api)
      .post(`/api/v1/staff/quotes/${quoteRef}/versions`)
      .set('Authorization', `Bearer ${agent.token}`)
      .send(versionInput('Revised paperwork'));
    expect(v2.status).toBe(201);
    expect((v2.body as { data: { versionNo: number } }).data.versionNo).toBe(2);
    const preview = await request(api)
      .get(`/api/v1/staff/quotes/${quoteRef}/preview`)
      .set('Authorization', `Bearer ${agent.token}`);
    expect(preview.status).toBe(200);
    expect(preview.text).not.toContain('1484500');
    expect(preview.text).not.toContain('private pricing note');
    const generatedPdf = await request(api)
      .post(`/api/v1/staff/quotes/${quoteRef}/pdf`)
      .set('Authorization', `Bearer ${agent.token}`);
    expect(generatedPdf.status, generatedPdf.text).toBe(201);
    const pdf = await request(api)
      .get(`/api/v1/staff/quotes/${quoteRef}/pdf`)
      .set('Authorization', `Bearer ${agent.token}`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.headers['cache-control']).toBe('private, no-store');
    const pdfBody: unknown = pdf.body;
    expect(Buffer.isBuffer(pdfBody)).toBe(true);
    if (!Buffer.isBuffer(pdfBody)) throw new Error('Expected the quote PDF response to be binary.');
    expect(pdfBody.subarray(0, 8).toString('ascii')).toBe('%PDF-1.4');
    expect(pdfBody.toString('ascii')).toContain('Revised paperwork');
    expect(pdfBody.toString('ascii')).not.toContain('private pricing note');
    expect(
      (
        await request(api)
          .get(`/api/v1/staff/quotes/${quoteRef}/pdf`)
          .set('Authorization', `Bearer ${otherAgent.token}`)
      ).status
    ).toBe(404);
    const storedPdf = await pool.query<{ sha256: string }>(
      'SELECT sha256 FROM quote_documents WHERE quote_id=(SELECT id FROM quotes WHERE reference_no=$1)',
      [quoteRef]
    );
    expect(storedPdf.rows[0]?.sha256).toBe(
      (generatedPdf.body as { data: { sha256: string } }).data.sha256
    );
    expect(
      (
        await request(api)
          .post(`/api/v1/staff/quotes/${quoteRef}/send`)
          .set('Authorization', `Bearer ${agent.token}`)
          .set('Idempotency-Key', `send-v2-${randomUUID()}`)
          .send({})
      ).status
    ).toBe(200);
    const oldVersion = await request(api)
      .get(`/api/v1/staff/quotes/${quoteRef}/versions/1`)
      .set('Authorization', `Bearer ${agent.token}`);
    expect((oldVersion.body as { data: { status: string } }).data.status).toBe('superseded');
    const acceptKey = `accept-${randomUUID()}`;
    const accepted = await request(api)
      .post(`/api/v1/staff/quotes/${quoteRef}/accept`)
      .set('Authorization', `Bearer ${agent.token}`)
      .set('Idempotency-Key', acceptKey)
      .send({});
    expect(accepted.status).toBe(200);
    const dealRef = (accepted.body as { data: { referenceNo: string; status: string } }).data
      .referenceNo;
    const quoteNotifications = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM notifications WHERE user_id=$1 AND type='quote.sent'",
      [agent.id]
    );
    expect(quoteNotifications.rows[0]?.count).toBe(2);
    const dealNotifications = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM notifications WHERE user_id=$1 AND type='deal.created'",
      [agent.id]
    );
    expect(dealNotifications.rows[0]?.count).toBe(1);
    const acceptedRetry = await request(api)
      .post(`/api/v1/staff/quotes/${quoteRef}/accept`)
      .set('Authorization', `Bearer ${agent.token}`)
      .set('Idempotency-Key', acceptKey)
      .send({});
    expect(acceptedRetry.status).toBe(200);
    expect((acceptedRetry.body as { data: { referenceNo: string } }).data.referenceNo).toBe(
      dealRef
    );
    expect((accepted.body as { data: { status: string } }).data.status).toBe('source_confirming');
    expect(
      (
        await request(api)
          .patch(`/api/v1/staff/deals/${dealRef}/status`)
          .set('Authorization', `Bearer ${manager.token}`)
          .send({ status: 'processing' })
      ).status
    ).toBe(409);
    expect(
      (
        await pool.query<{ status: string }>('SELECT status FROM leads WHERE id=$1', [
          lead.rows[0]!.id
        ])
      ).rows[0]!.status
    ).toBe('won');
    expect(
      (
        await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM deals WHERE lead_id=$1', [
          lead.rows[0]!.id
        ])
      ).rows[0]!.n
    ).toBe(1);
    await pool.query('UPDATE vehicles SET purchase_cost_minor=9900000 WHERE id=$1', [f.vehicleId]);
    expect(
      (
        await pool.query<{ source_cost_minor: string }>(
          'SELECT source_cost_minor FROM deals WHERE lead_id=$1',
          [lead.rows[0]!.id]
        )
      ).rows[0]!.source_cost_minor
    ).toBe('1234500');
    const repeated = await request(api)
      .post(`/api/v1/staff/leads/${leadRef}/deal`)
      .set('Authorization', `Bearer ${agent.token}`)
      .set('Idempotency-Key', `deal-${randomUUID()}`)
      .send({});
    expect(repeated.status).toBe(201);
    expect((repeated.body as { data: { referenceNo: string } }).data.referenceNo).toBe(dealRef);
    expect(
      (
        await pool.query<{ status: string }>(
          'SELECT l.status FROM quote_version_lifecycle l JOIN quote_versions v ON v.id=l.quote_version_id JOIN quotes q ON q.id=v.quote_id WHERE q.reference_no=$1 AND v.version_no=2',
          [quoteRef]
        )
      ).rows[0]!.status
    ).toBe('accepted');
    expect(
      ((await request(api).get('/api/v1/vehicles')).body as { data: unknown[] }).data
    ).toHaveLength(0);

    for (const status of ['source_confirmed', 'processing', 'ready_for_delivery']) {
      const moved = await request(api)
        .patch(`/api/v1/staff/deals/${dealRef}/status`)
        .set('Authorization', `Bearer ${manager.token}`)
        .send({
          status,
          ...(status === 'source_confirmed' ? { sourceConfirmationReference: 'OFFLINE-REF-1' } : {})
        });
      expect(moved.status).toBe(200);
    }
    const task = await request(api)
      .post(`/api/v1/staff/deals/${dealRef}/tasks`)
      .set('Authorization', `Bearer ${manager.token}`)
      .send({ taskType: 'Prepare delivery pack', notes: 'Internal task' });
    expect(task.status).toBe(201);
    const taskId = (task.body as { data: { id: string } }).data.id;
    expect(
      (
        await request(api)
          .post(`/api/v1/staff/deal-tasks/${taskId}/complete`)
          .set('Authorization', `Bearer ${manager.token}`)
          .send({})
      ).status
    ).toBe(200);
    const completed = await request(api)
      .post(`/api/v1/staff/deals/${dealRef}/complete`)
      .set('Authorization', `Bearer ${manager.token}`)
      .set('Idempotency-Key', `complete-${randomUUID()}`)
      .send({});
    expect(completed.status).toBe(200);
    const completionNotifications = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM notifications WHERE user_id=$1 AND type='deal.completed'",
      [agent.id]
    );
    expect(completionNotifications.rows[0]?.count).toBe(1);
    expect(
      (
        await pool.query(
          'SELECT deals.status,vehicles.availability_status FROM deals JOIN vehicles ON vehicles.id=deals.vehicle_id WHERE deals.reference_no=$1',
          [dealRef]
        )
      ).rows[0]
    ).toMatchObject({ status: 'completed', availability_status: 'sold' });
    expect(
      ((await request(api).get('/api/v1/vehicles')).body as { data: unknown[] }).data
    ).toHaveLength(0);
  });

  it('serializes competing reservations and expires stale holds before checking availability', async () => {
    const { app: api, pool } = requireDependencies();
    const agent = await staff('sales_agent');
    const f = await fixture();
    const lead = await pool.query<{ id: string; reference_no: string }>(
      `INSERT INTO leads (vehicle_id,vehicle_snapshot,contact_name,contact_email,status,assigned_to,market_id)
       VALUES ($1,'{"title":"Hold Buyer"}','Hold Buyer','hold@example.test','qualified',$2,$3)
       RETURNING id,reference_no`,
      [f.vehicleId, agent.id, f.marketId]
    );
    const reserve = (key: string, expiresInHours = 24) =>
      request(api)
        .post(`/api/v1/staff/vehicles/${f.vehicleId}/reservations`)
        .set('Authorization', `Bearer ${agent.token}`)
        .set('Idempotency-Key', key)
        .send({ leadReferenceNo: lead.rows[0]!.reference_no, expiresInHours });
    const outcomes = await Promise.all([
      reserve(`reserve-a-${randomUUID()}`),
      reserve(`reserve-b-${randomUUID()}`)
    ]);
    expect(outcomes.map((response) => response.status).sort()).toEqual([201, 409]);
    const hold = await pool.query<{ id: string }>(
      "SELECT id FROM vehicle_reservations WHERE vehicle_id=$1 AND status='active'",
      [f.vehicleId]
    );
    await pool.query(
      "UPDATE vehicle_reservations SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [hold.rows[0]!.id]
    );
    await pool.query("UPDATE vehicles SET availability_status='reserved' WHERE id=$1", [
      f.vehicleId
    ]);
    expect(
      ((await request(api).get('/api/v1/vehicles')).body as { data: unknown[] }).data
    ).toHaveLength(1);
    const replacementKey = `reserve-c-${randomUUID()}`;
    const replacement = await reserve(replacementKey);
    expect(replacement.status, replacement.text).toBe(201);
    const replacementData = (replacement.body as { data: { id: string } }).data;
    expect(((await reserve(replacementKey)).body as { data: { id: string } }).data.id).toBe(
      replacementData.id
    );
    expect((await reserve(replacementKey, 48)).status).toBe(409);
    expect(
      (
        await pool.query<{ status: string }>(
          'SELECT status FROM vehicle_reservations WHERE id=$1',
          [hold.rows[0]!.id]
        )
      ).rows[0]!.status
    ).toBe('expired');
    expect(
      (
        await request(api)
          .post(`/api/v1/staff/reservations/${replacementData.id}/extend`)
          .set('Authorization', `Bearer ${agent.token}`)
          .send({ extendByHours: 1 })
      ).status
    ).toBe(200);
    expect(
      (
        await request(api)
          .post(`/api/v1/staff/reservations/${replacementData.id}/release`)
          .set('Authorization', `Bearer ${agent.token}`)
          .send({ reason: 'Customer paused' })
      ).status
    ).toBe(200);
    expect(
      (
        await pool.query<{ availability_status: string }>(
          'SELECT availability_status FROM vehicles WHERE id=$1',
          [f.vehicleId]
        )
      ).rows[0]!.availability_status
    ).toBe('available');
  });

  it('refuses acceptance after cancellation or server-authoritative expiry', async () => {
    const { app: api, pool } = requireDependencies();
    const manager = await staff('sales_manager');
    const f = await fixture();
    await pool.query("UPDATE vehicles SET purchase_cost_currency='PKR' WHERE id=$1", [f.vehicleId]);
    const createLead = async (emailAddress: string) => {
      const lead = await pool.query<{ reference_no: string }>(
        `INSERT INTO leads (vehicle_id,vehicle_snapshot,contact_name,contact_email,status,assigned_to,market_id)
         VALUES ($1,'{"title":"Lifecycle Corolla"}','Lifecycle Buyer',$2,'qualified',$3,$4)
         RETURNING reference_no`,
        [f.vehicleId, emailAddress, manager.id, f.marketId]
      );
      return lead.rows[0]!.reference_no;
    };
    const createAndSend = async (leadRef: string, validUntil: string) => {
      const quote = await request(api)
        .post(`/api/v1/staff/leads/${leadRef}/quotes`)
        .set('Authorization', `Bearer ${manager.token}`)
        .send({});
      const quoteRef = (quote.body as { data: { referenceNo: string } }).data.referenceNo;
      expect(
        (
          await request(api)
            .post(`/api/v1/staff/quotes/${quoteRef}/versions`)
            .set('Authorization', `Bearer ${manager.token}`)
            .send({ validUntil })
        ).status
      ).toBe(201);
      expect(
        (
          await request(api)
            .post(`/api/v1/staff/quotes/${quoteRef}/send`)
            .set('Authorization', `Bearer ${manager.token}`)
            .set('Idempotency-Key', `send-${randomUUID()}`)
            .send({})
        ).status
      ).toBe(200);
      return quoteRef;
    };
    const cancelledQuote = await createAndSend(
      await createLead('cancelled@example.test'),
      new Date(Date.now() + 86400000).toISOString()
    );
    expect(
      (
        await request(api)
          .post(`/api/v1/staff/quotes/${cancelledQuote}/cancel`)
          .set('Authorization', `Bearer ${manager.token}`)
          .send({ reason: 'Customer withdrew' })
      ).status
    ).toBe(200);
    expect(
      (
        await request(api)
          .post(`/api/v1/staff/quotes/${cancelledQuote}/accept`)
          .set('Authorization', `Bearer ${manager.token}`)
          .set('Idempotency-Key', `accept-cancel-${randomUUID()}`)
          .send({})
      ).status
    ).toBe(409);

    const expiringQuote = await createAndSend(
      await createLead('expired@example.test'),
      new Date(Date.now() + 2000).toISOString()
    );
    await new Promise((resolve) => setTimeout(resolve, 2100));
    expect(
      (
        await request(api)
          .post(`/api/v1/staff/quotes/${expiringQuote}/expire`)
          .set('Authorization', `Bearer ${manager.token}`)
          .send({})
      ).status
    ).toBe(200);
    expect(
      (
        await request(api)
          .post(`/api/v1/staff/quotes/${expiringQuote}/accept`)
          .set('Authorization', `Bearer ${manager.token}`)
          .set('Idempotency-Key', `accept-expire-${randomUUID()}`)
          .send({})
      ).status
    ).toBe(409);
  });
});

afterAll(async () => {
  await database?.close();
  await pool?.end();
});
