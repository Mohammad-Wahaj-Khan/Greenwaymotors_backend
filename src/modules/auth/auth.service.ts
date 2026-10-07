import type { Kysely } from 'kysely';
import type { Environment } from '../../config/env.js';
import { createAccessTokenService } from '../../core/auth/jwt.js';
import { hashPassword, verifyPassword } from '../../core/auth/password.js';
import { createOpaqueToken, hashOpaqueToken } from '../../core/auth/token.js';
import { authenticationError, conflictError } from '../../core/errors/http-errors.js';
import { decryptJson, encryptJson } from '../../core/security/encryption.js';
import { createRecoveryCodes, createTotpSecret, verifyTotp } from '../../core/auth/totp.js';
import { audit } from '../../core/db/audit.js';
import type { DB, TokenPurpose } from '../../generated/database.types.js';
import type { AuthContext, LoginChallenge, SessionIssue, UserSummary } from './auth.types.js';
import type { LoginInput, RegisterCustomerInput, UpdateProfileInput } from './auth.schema.js';
import {
  findUserById,
  findUserForLogin,
  findUserPermissions,
  type DatabaseExecutor,
  userColumns
} from './auth.repository.js';

const oneTimeTokenLifetimeMs = 24 * 60 * 60 * 1000;
const mfaRequiredRoles = ['super_admin', 'admin', 'finance', 'sales_manager'];
const mfaChallengeLifetimeMs = 5 * 60 * 1000;

function toUserSummary(user: Awaited<ReturnType<typeof findUserById>>): UserSummary {
  if (!user) {
    throw authenticationError();
  }
  return {
    id: user.id,
    userType: user.user_type,
    email: user.email,
    fullName: user.full_name,
    phone: user.phone,
    whatsapp: user.whatsapp,
    countryId: user.country_id,
    city: user.city,
    preferredContact: user.preferred_contact,
    status: user.status,
    emailVerifiedAt: user.email_verified_at?.toISOString() ?? null
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

export class AuthService {
  private readonly accessTokens;

  public constructor(
    private readonly database: Kysely<DB>,
    private readonly environment: Environment
  ) {
    this.accessTokens = createAccessTokenService(environment);
  }

  public async authenticateAccessToken(token: string): Promise<AuthContext> {
    const claims = await this.accessTokens.verify(token);
    return this.getAuthContext(claims.subject, claims.mfaSatisfied);
  }

  public async getAuthContext(userId: string, mfaSatisfied = false): Promise<AuthContext> {
    const user = toUserSummary(await findUserById(this.database, userId));
    if (user.status !== 'active') {
      throw authenticationError('This account is not active.');
    }
    const permissions =
      user.userType === 'staff' ? await findUserPermissions(this.database, user.id) : [];
    const role =
      user.userType === 'staff'
        ? await this.database
            .selectFrom('user_roles')
            .innerJoin('roles', 'roles.id', 'user_roles.role_id')
            .select('roles.name')
            .where('user_roles.user_id', '=', user.id)
            .execute()
        : [];
    const mfaRequired = role.some((item) => mfaRequiredRoles.includes(item.name));
    return { user, permissions: new Set(permissions), mfaRequired, mfaSatisfied };
  }

  public async registerCustomer(input: RegisterCustomerInput): Promise<{ user: UserSummary }> {
    const passwordHash = await hashPassword(input.password);
    try {
      return await this.database.transaction().execute(async (transaction) => {
        const inserted = await transaction
          .insertInto('users')
          .values({
            user_type: 'customer',
            email: input.email,
            password_hash: passwordHash,
            full_name: input.fullName,
            phone: input.phone ?? null,
            whatsapp: input.whatsapp ?? null,
            country_id: input.countryId ?? null,
            city: input.city ?? null,
            preferred_contact: input.preferredContact ?? null
          })
          .returning(userColumns)
          .executeTakeFirstOrThrow();
        const verificationToken = await this.createOneTimeToken(
          transaction,
          inserted.id,
          'email_verification'
        );
        await transaction
          .insertInto('outbox_events')
          .values({
            topic: 'email.verification',
            payload: {
              ciphertext: encryptJson(this.environment, {
                email: inserted.email,
                token: verificationToken
              })
            }
          })
          .execute();
        return { user: toUserSummary(inserted) };
      });
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw conflictError('An account with this email already exists.');
      }
      throw error;
    }
  }

  public async login(
    input: LoginInput,
    metadata: { ip?: string; userAgent?: string }
  ): Promise<SessionIssue | LoginChallenge> {
    const user = await findUserForLogin(this.database, input.email);
    if (
      !user ||
      !(await verifyPassword(user.password_hash, input.password)) ||
      user.status !== 'active'
    ) {
      throw authenticationError('Invalid email or password.');
    }
    await this.database
      .updateTable('users')
      .set({ last_login_at: new Date() })
      .where('id', '=', user.id)
      .execute();
    const account = toUserSummary(user);
    const mfa = await this.database
      .selectFrom('user_mfa')
      .select(['enabled_at'])
      .where('user_id', '=', user.id)
      .executeTakeFirst();
    if (mfa?.enabled_at) {
      const challengeToken = createOpaqueToken();
      const expiresAt = new Date(Date.now() + mfaChallengeLifetimeMs);
      await this.database
        .insertInto('mfa_challenges')
        .values({
          user_id: user.id,
          token_hash: hashOpaqueToken(challengeToken),
          expires_at: expiresAt
        })
        .execute();
      return { mfaChallengeRequired: true, challengeToken, expiresAt: expiresAt.toISOString() };
    }
    const roles = await this.userRoles(user.id);
    const setupRequired =
      account.userType === 'staff' && roles.some((role) => mfaRequiredRoles.includes(role));
    return this.createSession(account, metadata, false, setupRequired);
  }

  public async verifyMfaChallenge(
    challengeToken: string,
    code: string,
    metadata: { ip?: string; userAgent?: string }
  ): Promise<SessionIssue> {
    return this.database.transaction().execute(async (trx) => {
      const challenge = await trx
        .selectFrom('mfa_challenges')
        .selectAll()
        .where('token_hash', '=', hashOpaqueToken(challengeToken))
        .where('consumed_at', 'is', null)
        .where('expires_at', '>', new Date())
        .forUpdate()
        .executeTakeFirst();
      if (!challenge) throw authenticationError('The MFA challenge is invalid or expired.');
      const mfa = await trx
        .selectFrom('user_mfa')
        .selectAll()
        .where('user_id', '=', challenge.user_id)
        .forUpdate()
        .executeTakeFirst();
      if (!mfa?.enabled_at) throw authenticationError('MFA is not enabled for this account.');
      const secret = decryptJson<{ secret: string }>(
        this.environment,
        mfa.secret_ciphertext
      ).secret;
      let valid = false;
      if (/^\d{6}$/.test(code)) valid = verifyTotp(secret, code);
      else if (/^[a-f\d]{12}$/i.test(code)) {
        const recovery = await trx
          .selectFrom('mfa_recovery_codes')
          .select('id')
          .where('user_id', '=', challenge.user_id)
          .where('code_hash', '=', hashOpaqueToken(code.toUpperCase()))
          .where('used_at', 'is', null)
          .forUpdate()
          .executeTakeFirst();
        if (recovery) {
          await trx
            .updateTable('mfa_recovery_codes')
            .set({ used_at: new Date() })
            .where('id', '=', recovery.id)
            .execute();
          valid = true;
        }
      }
      if (!valid) throw authenticationError('The MFA code is invalid.');
      await trx
        .updateTable('mfa_challenges')
        .set({ consumed_at: new Date() })
        .where('id', '=', challenge.id)
        .execute();
      const user = toUserSummary(await findUserById(trx, challenge.user_id));
      await audit(trx, user.id, 'auth.mfa.challenge_verified', 'user', user.id, {
        recoveryCodeUsed: !/^\d{6}$/.test(code)
      });
      return this.createSession(user, metadata, true, false, trx);
    });
  }

  public async enrollMfa(
    userId: string,
    email: string
  ): Promise<{ secret: string; otpauthUrl: string }> {
    const secret = createTotpSecret();
    await this.database.transaction().execute(async (trx) => {
      const old = await trx
        .selectFrom('user_mfa')
        .select(['enabled_at'])
        .where('user_id', '=', userId)
        .forUpdate()
        .executeTakeFirst();
      if (old?.enabled_at) throw conflictError('MFA is already enabled for this account.');
      await trx
        .insertInto('user_mfa')
        .values({
          user_id: userId,
          secret_ciphertext: encryptJson(this.environment, { secret }),
          enabled_at: null
        })
        .onConflict((oc) =>
          oc
            .column('user_id')
            .doUpdateSet({
              secret_ciphertext: encryptJson(this.environment, { secret }),
              updated_at: new Date()
            })
            .where('user_mfa.enabled_at', 'is', null)
        )
        .execute();
      await audit(trx, userId, 'auth.mfa.enrollment_started', 'user', userId);
    });
    const label = encodeURIComponent(`GreenWay Motors:${email}`);
    const otpauthUrl = `otpauth://totp/${label}?secret=${secret}&issuer=GreenWay%20Motors&algorithm=SHA1&digits=6&period=30`;
    return { secret, otpauthUrl };
  }

  public async confirmMfa(
    user: UserSummary,
    code: string,
    metadata: { ip?: string; userAgent?: string }
  ): Promise<SessionIssue & { recoveryCodes: string[] }> {
    return this.database.transaction().execute(async (trx) => {
      const mfa = await trx
        .selectFrom('user_mfa')
        .selectAll()
        .where('user_id', '=', user.id)
        .forUpdate()
        .executeTakeFirst();
      if (!mfa || mfa.enabled_at) throw conflictError('Start a new MFA enrollment first.');
      const secret = decryptJson<{ secret: string }>(
        this.environment,
        mfa.secret_ciphertext
      ).secret;
      if (!verifyTotp(secret, code)) throw authenticationError('The MFA code is invalid.');
      const recoveryCodes = createRecoveryCodes();
      await trx
        .updateTable('user_mfa')
        .set({ enabled_at: new Date(), updated_at: new Date() })
        .where('user_id', '=', user.id)
        .execute();
      await trx
        .insertInto('mfa_recovery_codes')
        .values(
          recoveryCodes.map((recoveryCode) => ({
            user_id: user.id,
            code_hash: hashOpaqueToken(recoveryCode)
          }))
        )
        .execute();
      await trx
        .updateTable('user_sessions')
        .set({ revoked_at: new Date() })
        .where('user_id', '=', user.id)
        .where('revoked_at', 'is', null)
        .execute();
      await audit(trx, user.id, 'auth.mfa.enabled', 'user', user.id, {
        recoveryCodesIssued: recoveryCodes.length,
        refreshSessionsRevoked: true
      });
      const session = await this.createSession(user, metadata, true, false, trx);
      return { ...session, recoveryCodes };
    });
  }

  private async userRoles(userId: string): Promise<string[]> {
    const rows = await this.database
      .selectFrom('user_roles')
      .innerJoin('roles', 'roles.id', 'user_roles.role_id')
      .select('roles.name')
      .where('user_roles.user_id', '=', userId)
      .execute();
    return rows.map((row) => row.name);
  }

  public async refresh(
    rawRefreshToken: string,
    metadata: { ip?: string; userAgent?: string }
  ): Promise<SessionIssue> {
    const refreshHash = hashOpaqueToken(rawRefreshToken);
    const result = await this.database.transaction().execute(async (transaction) => {
      const session = await transaction
        .selectFrom('user_sessions')
        .selectAll()
        .where('refresh_token_hash', '=', refreshHash)
        .forUpdate()
        .executeTakeFirst();
      if (!session || session.revoked_at || session.expires_at <= new Date()) {
        throw authenticationError('The refresh session is invalid or expired.');
      }
      const user = toUserSummary(await findUserById(transaction, session.user_id));
      if (user.status !== 'active') {
        throw authenticationError('This account is not active.');
      }
      await transaction
        .updateTable('user_sessions')
        .set({ revoked_at: new Date() })
        .where('id', '=', session.id)
        .execute();
      return { user, refreshToken: await this.insertSession(transaction, user.id, metadata) };
    });
    const mfa = await this.database
      .selectFrom('user_mfa')
      .select('enabled_at')
      .where('user_id', '=', result.user.id)
      .executeTakeFirst();
    const setupRequired =
      result.user.userType === 'staff' &&
      (await this.userRoles(result.user.id)).some((role) => mfaRequiredRoles.includes(role));
    return {
      user: result.user,
      refreshToken: result.refreshToken,
      accessToken: await this.accessTokens.issue(result.user.id, Boolean(mfa?.enabled_at)),
      ...(setupRequired && !mfa?.enabled_at && this.environment.NODE_ENV === 'production'
        ? { mfaSetupRequired: true }
        : {})
    };
  }

  public async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) {
      return;
    }
    await this.database
      .updateTable('user_sessions')
      .set({ revoked_at: new Date() })
      .where('refresh_token_hash', '=', hashOpaqueToken(rawRefreshToken))
      .where('revoked_at', 'is', null)
      .execute();
  }

  public async logoutAll(userId: string): Promise<void> {
    await this.database
      .updateTable('user_sessions')
      .set({ revoked_at: new Date() })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .execute();
  }

  public async requestOneTimeToken(
    email: string,
    purpose: TokenPurpose
  ): Promise<{ email: string; token: string } | undefined> {
    const user = await findUserForLogin(this.database, email);
    if (!user || user.status !== 'active') return undefined;
    const token = await this.database.transaction().execute(async (transaction) => {
      const oneTimeToken = await this.createOneTimeToken(transaction, user.id, purpose);
      const topic =
        purpose === 'email_verification' ? 'email.verification' : 'email.password_reset';
      await transaction
        .insertInto('outbox_events')
        .values({
          topic,
          payload: {
            ciphertext: encryptJson(this.environment, { email: user.email, token: oneTimeToken })
          }
        })
        .execute();
      return oneTimeToken;
    });
    return { email: user.email, token };
  }
  public async confirmEmailVerification(token: string): Promise<void> {
    await this.consumeOneTimeToken(token, 'email_verification', async (transaction, userId) => {
      await transaction
        .updateTable('users')
        .set({ email_verified_at: new Date() })
        .where('id', '=', userId)
        .execute();
    });
  }

  public async resetPassword(token: string, newPassword: string): Promise<void> {
    const passwordHash = await hashPassword(newPassword);
    await this.consumeOneTimeToken(token, 'password_reset', async (transaction, userId) => {
      const user = await transaction
        .selectFrom('users')
        .select('email')
        .where('id', '=', userId)
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable('users')
        .set({ password_hash: passwordHash })
        .where('id', '=', userId)
        .execute();
      await transaction
        .updateTable('user_sessions')
        .set({ revoked_at: new Date() })
        .where('user_id', '=', userId)
        .where('revoked_at', 'is', null)
        .execute();
      await transaction
        .insertInto('outbox_events')
        .values({
          topic: 'email.password_changed',
          payload: { ciphertext: encryptJson(this.environment, { email: user.email }) }
        })
        .execute();
    });
  }

  public async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    await this.database.transaction().execute(async (transaction) => {
      const user = await transaction
        .selectFrom('users')
        .select(['password_hash', 'email'])
        .where('id', '=', userId)
        .forUpdate()
        .executeTakeFirst();
      if (!user || !(await verifyPassword(user.password_hash, currentPassword))) {
        throw authenticationError('The current password is incorrect.');
      }
      await transaction
        .updateTable('users')
        .set({ password_hash: await hashPassword(newPassword) })
        .where('id', '=', userId)
        .execute();
      await transaction
        .updateTable('user_sessions')
        .set({ revoked_at: new Date() })
        .where('user_id', '=', userId)
        .where('revoked_at', 'is', null)
        .execute();
      await transaction
        .insertInto('outbox_events')
        .values({
          topic: 'email.password_changed',
          payload: { ciphertext: encryptJson(this.environment, { email: user.email }) }
        })
        .execute();
    });
  }

  public async updateProfile(userId: string, input: UpdateProfileInput): Promise<UserSummary> {
    const values = {
      ...(input.fullName === undefined ? {} : { full_name: input.fullName }),
      ...(input.phone === undefined ? {} : { phone: input.phone }),
      ...(input.whatsapp === undefined ? {} : { whatsapp: input.whatsapp }),
      ...(input.countryId === undefined ? {} : { country_id: input.countryId }),
      ...(input.city === undefined ? {} : { city: input.city }),
      ...(input.preferredContact === undefined ? {} : { preferred_contact: input.preferredContact })
    };
    const user = await this.database
      .updateTable('users')
      .set(values)
      .where('id', '=', userId)
      .returning(userColumns)
      .executeTakeFirstOrThrow();
    return toUserSummary(user);
  }

  private async createSession(
    user: UserSummary,
    metadata: { ip?: string; userAgent?: string },
    mfaSatisfied = false,
    setupRequired = false,
    database: DatabaseExecutor = this.database
  ): Promise<SessionIssue> {
    const refreshToken = await this.insertSession(database, user.id, metadata);
    return {
      user,
      refreshToken,
      accessToken: await this.accessTokens.issue(user.id, mfaSatisfied),
      ...(setupRequired && this.environment.NODE_ENV === 'production'
        ? { mfaSetupRequired: true }
        : {})
    };
  }

  private async insertSession(
    database: DatabaseExecutor,
    userId: string,
    metadata: { ip?: string; userAgent?: string }
  ): Promise<string> {
    const refreshToken = createOpaqueToken();
    await database
      .insertInto('user_sessions')
      .values({
        user_id: userId,
        refresh_token_hash: hashOpaqueToken(refreshToken),
        ip_address: metadata.ip ?? null,
        user_agent: metadata.userAgent ?? null,
        expires_at: new Date(
          Date.now() + this.environment.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
        )
      })
      .execute();
    return refreshToken;
  }

  private async createOneTimeToken(
    database: DatabaseExecutor,
    userId: string,
    purpose: TokenPurpose
  ): Promise<string> {
    const token = createOpaqueToken();
    await database
      .updateTable('user_tokens')
      .set({ used_at: new Date() })
      .where('user_id', '=', userId)
      .where('purpose', '=', purpose)
      .where('used_at', 'is', null)
      .execute();
    await database
      .insertInto('user_tokens')
      .values({
        user_id: userId,
        purpose,
        token_hash: hashOpaqueToken(token),
        expires_at: new Date(Date.now() + oneTimeTokenLifetimeMs)
      })
      .execute();
    return token;
  }

  private async consumeOneTimeToken(
    token: string,
    purpose: TokenPurpose,
    operation: (database: DatabaseExecutor, userId: string) => Promise<void>
  ): Promise<void> {
    const tokenHash = hashOpaqueToken(token);
    await this.database.transaction().execute(async (transaction) => {
      const record = await transaction
        .selectFrom('user_tokens')
        .select(['id', 'user_id'])
        .where('token_hash', '=', tokenHash)
        .where('purpose', '=', purpose)
        .where('used_at', 'is', null)
        .where('expires_at', '>', new Date())
        .forUpdate()
        .executeTakeFirst();
      if (!record) {
        throw authenticationError('The token is invalid or expired.');
      }
      await transaction
        .updateTable('user_tokens')
        .set({ used_at: new Date() })
        .where('id', '=', record.id)
        .execute();
      await operation(transaction, record.user_id);
    });
  }
}
