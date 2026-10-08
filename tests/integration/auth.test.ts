import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { applyInitialSchema, applySeeds } from '../../scripts/database-files.js';
import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/core/auth/password.js';
import { hashOpaqueToken } from '../../src/core/auth/token.js';
import { createPostgresPool, type DatabaseConnection } from '../../src/core/db/database.js';
import { parseEnvironment } from '../../src/config/env.js';
import type { EmailService } from '../../src/integrations/email/email.service.js';
import type { RedisConnection } from '../../src/integrations/redis/redis.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';

const testUrl = process.env.DATABASE_TEST_URL;
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

const environment = parseEnvironment({
  NODE_ENV: 'test',
  DATABASE_URL: testUrl ?? 'postgresql://greenway:greenway@127.0.0.1:55432/greenway_motors_test',
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
const database: DatabaseConnection | undefined = testUrl
  ? createPostgresPool(environment)
  : undefined;
const app = database ? createApp(environment, { database, redis, email }) : undefined;

interface AuthResponse {
  data: { accessToken: string; user: { email: string } };
}

interface UserResponse {
  data: { email: string };
}

interface CreatedRoleResponse {
  data: { id: number };
}

function responseBody<T>(response: request.Response): T {
  return response.body as T;
}

function cookieHeader(response: request.Response): string {
  const headers: unknown = response.headers;
  const cookie =
    typeof headers === 'object' && headers !== null
      ? (headers as Record<string, unknown>)['set-cookie']
      : undefined;
  let first: unknown;
  if (Array.isArray(cookie)) {
    first = cookie[0];
  } else {
    first = cookie;
  }
  if (!first) {
    throw new Error('Missing refresh cookie.');
  }
  if (typeof first !== 'string') {
    throw new Error('Invalid refresh cookie.');
  }
  return first.split(';', 1)[0]!;
}

function requireApp() {
  if (!app) {
    throw new Error('DATABASE_TEST_URL is required for auth integration tests.');
  }
  return app;
}

afterAll(async () => {
  await database?.close();
});

describe.skipIf(!testUrl)('authentication and RBAC', () => {
  beforeAll(async () => {
    if (!testUrl) throw new Error('DATABASE_TEST_URL is required.');
    const pool = new Pool({ connectionString: testUrl, max: 1 });
    try {
      await pool.query('DROP SCHEMA public CASCADE');
      await pool.query('CREATE SCHEMA public');
      await applyInitialSchema(pool);
      await applySeeds(pool);
    } finally {
      await pool.end();
    }
  });
  it('rejects invalid credentials, rotates refresh tokens, and rejects a replayed refresh token', async () => {
    const api = requireApp();
    const emailAddress = `auth-${suffix}@example.test`;
    const registration = await request(api)
      .post('/api/v1/auth/customers/register')
      .send({ email: emailAddress, password: 'strong-password-123', fullName: 'Test Customer' });
    expect(registration.status).toBe(201);
    expect(registration.body).toHaveProperty('meta.requestId');
    expect(JSON.stringify(registration.body)).not.toContain('password_hash');
    expect(JSON.stringify(registration.body)).not.toContain('token_hash');

    const invalidLogin = await request(api)
      .post('/api/v1/auth/login')
      .send({ email: emailAddress, password: 'incorrect-password' });
    expect(invalidLogin.status).toBe(401);

    const login = await request(api)
      .post('/api/v1/auth/login')
      .send({ email: emailAddress, password: 'strong-password-123' });
    expect(login.status).toBe(200);
    const responseHeaders: unknown = login.headers;
    expect(JSON.stringify((responseHeaders as Record<string, unknown>)['set-cookie'])).toContain(
      'Path=/api/v1/auth'
    );
    const loginBody = responseBody<AuthResponse>(login);
    expect(loginBody.data.accessToken).toEqual(expect.any(String));
    const firstRefreshCookie = cookieHeader(login);

    const currentUser = await request(api)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${loginBody.data.accessToken}`);
    expect(currentUser.status).toBe(200);
    expect(responseBody<UserResponse>(currentUser).data.email).toBe(emailAddress);

    const refreshed = await request(api)
      .post('/api/v1/auth/refresh')
      .set('Origin', environment.WEB_ORIGIN)
      .set('Cookie', firstRefreshCookie);
    expect(refreshed.status).toBe(200);
    expect(cookieHeader(refreshed)).not.toBe(firstRefreshCookie);

    const replay = await request(api)
      .post('/api/v1/auth/refresh')
      .set('Origin', environment.WEB_ORIGIN)
      .set('Cookie', firstRefreshCookie);
    expect(replay.status).toBe(401);
  });

  it('rejects a suspended account independently of its unexpired access token', async () => {
    const api = requireApp();
    const emailAddress = `suspended-${suffix}@example.test`;
    await request(api).post('/api/v1/auth/customers/register').send({
      email: emailAddress,
      password: 'strong-password-123',
      fullName: 'Suspended Customer'
    });
    const login = await request(api)
      .post('/api/v1/auth/login')
      .send({ email: emailAddress, password: 'strong-password-123' });
    const loginBody = responseBody<AuthResponse>(login);
    await database!.db
      .updateTable('users')
      .set({ status: 'suspended' })
      .where('email', '=', emailAddress)
      .execute();

    const response = await request(api)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${loginBody.data.accessToken}`);
    expect(response.status).toBe(401);
  });

  it('invalidates an access token immediately when its current session is signed out', async () => {
    const api = requireApp();
    const emailAddress = `logout-${suffix}@example.test`;
    await request(api).post('/api/v1/auth/customers/register').send({
      email: emailAddress,
      password: 'strong-password-123',
      fullName: 'Logout Customer'
    });
    const login = await request(api)
      .post('/api/v1/auth/login')
      .send({ email: emailAddress, password: 'strong-password-123' });
    const loginBody = responseBody<AuthResponse>(login);

    const logout = await request(api)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${loginBody.data.accessToken}`)
      .set('Origin', environment.WEB_ORIGIN)
      .set('Cookie', cookieHeader(login));
    expect(logout.status).toBe(200);

    const currentUser = await request(api)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${loginBody.data.accessToken}`);
    expect(currentUser.status).toBe(401);
  });

  it('enforces one-time token use and revokes refresh sessions after a password reset', async () => {
    const api = requireApp();
    const emailAddress = `reset-${suffix}@example.test`;
    await request(api)
      .post('/api/v1/auth/customers/register')
      .send({ email: emailAddress, password: 'strong-password-123', fullName: 'Reset Customer' });
    const login = await request(api)
      .post('/api/v1/auth/login')
      .send({ email: emailAddress, password: 'strong-password-123' });
    expect(login.status).toBe(200);
    const service = new AuthService(database!.db, environment);
    const reset = await service.requestOneTimeToken(emailAddress, 'password_reset');
    if (!reset) {
      throw new Error('Expected a password reset token.');
    }
    await service.resetPassword(reset.token, 'new-strong-password-456');
    await expect(
      service.resetPassword(reset.token, 'another-strong-password-789')
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    const session = await database!.db
      .selectFrom('user_sessions')
      .innerJoin('users', 'users.id', 'user_sessions.user_id')
      .select('user_sessions.revoked_at')
      .where('users.email', '=', emailAddress)
      .executeTakeFirstOrThrow();
    expect(session.revoked_at).toBeInstanceOf(Date);

    const expired = await service.requestOneTimeToken(emailAddress, 'email_verification');
    if (!expired) {
      throw new Error('Expected an email verification token.');
    }
    await database!.db
      .updateTable('user_tokens')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('token_hash', '=', hashOpaqueToken(expired.token))
      .execute();
    await expect(service.confirmEmailVerification(expired.token)).rejects.toMatchObject({
      code: 'unauthenticated'
    });
  });

  it('enforces RBAC permission checks and records role mutations in audit logs', async () => {
    const api = requireApp();
    const passwordHash = await hashPassword('strong-password-123');
    const staff = await database!.db
      .insertInto('users')
      .values({
        user_type: 'staff',
        email: `staff-${suffix}@example.test`,
        password_hash: passwordHash,
        full_name: 'Test Staff'
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const login = await request(api)
      .post('/api/v1/auth/login')
      .send({ email: `staff-${suffix}@example.test`, password: 'strong-password-123' });
    const loginBody = responseBody<AuthResponse>(login);
    const denied = await request(api)
      .get('/api/v1/admin/roles')
      .set('Authorization', `Bearer ${loginBody.data.accessToken}`);
    expect(denied.status).toBe(403);

    const permission = await database!.db
      .selectFrom('permissions')
      .select('id')
      .where('code', '=', 'rbac.manage')
      .executeTakeFirstOrThrow();
    const managerRole = await database!.db
      .insertInto('roles')
      .values({
        name: `rbac_manager_${suffix}`.replace(/-/g, '_'),
        description: 'Test RBAC manager'
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await database!.db
      .insertInto('role_permissions')
      .values({ role_id: managerRole.id, permission_id: permission.id })
      .execute();
    await database!.db
      .insertInto('user_roles')
      .values({ user_id: staff.id, role_id: managerRole.id })
      .execute();

    const allowed = await request(api)
      .get('/api/v1/admin/roles')
      .set('Authorization', `Bearer ${loginBody.data.accessToken}`);
    expect(allowed.status).toBe(200);
    const created = await request(api)
      .post('/api/v1/admin/roles')
      .set('Authorization', `Bearer ${loginBody.data.accessToken}`)
      .send({ name: `audited_${suffix}`.replace(/-/g, '_'), description: 'Created under test' });
    expect(created.status).toBe(201);
    const auditLog = await database!.db
      .selectFrom('audit_logs')
      .select(['action', 'actor_id'])
      .where('entity_id', '=', String(responseBody<CreatedRoleResponse>(created).data.id))
      .executeTakeFirst();
    expect(auditLog).toMatchObject({ action: 'rbac.role.create', actor_id: staff.id });
  });
});
