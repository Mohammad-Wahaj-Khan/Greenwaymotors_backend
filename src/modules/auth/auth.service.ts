import type { Kysely } from 'kysely';
import type { Environment } from '../../config/env.js';
import { createAccessTokenService } from '../../core/auth/jwt.js';
import { hashPassword, verifyPassword } from '../../core/auth/password.js';
import { createOpaqueToken, hashOpaqueToken } from '../../core/auth/token.js';
import { authenticationError, conflictError } from '../../core/errors/http-errors.js';
import type { DB, TokenPurpose } from '../../generated/database.types.js';
import type { AuthContext, SessionIssue, UserSummary } from './auth.types.js';
import type { LoginInput, RegisterCustomerInput, UpdateProfileInput } from './auth.schema.js';
import {
  findUserById,
  findUserForLogin,
  findUserPermissions,
  type DatabaseExecutor,
  userColumns
} from './auth.repository.js';

const oneTimeTokenLifetimeMs = 24 * 60 * 60 * 1000;

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
    return this.getAuthContext(claims.subject);
  }

  public async getAuthContext(userId: string): Promise<AuthContext> {
    const user = toUserSummary(await findUserById(this.database, userId));
    if (user.status !== 'active') {
      throw authenticationError('This account is not active.');
    }
    const permissions =
      user.userType === 'staff' ? await findUserPermissions(this.database, user.id) : [];
    return { user, permissions: new Set(permissions) };
  }

  public async registerCustomer(
    input: RegisterCustomerInput
  ): Promise<{ user: UserSummary; verificationToken: string }> {
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
        return { user: toUserSummary(inserted), verificationToken };
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
  ): Promise<SessionIssue> {
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
    return this.createSession(toUserSummary(user), metadata);
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
    return {
      user: result.user,
      refreshToken: result.refreshToken,
      accessToken: await this.accessTokens.issue(result.user.id)
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
    if (!user || user.status !== 'active') {
      return undefined;
    }
    const token = await this.database
      .transaction()
      .execute((transaction) => this.createOneTimeToken(transaction, user.id, purpose));
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
    metadata: { ip?: string; userAgent?: string }
  ): Promise<SessionIssue> {
    const refreshToken = await this.insertSession(this.database, user.id, metadata);
    return { user, refreshToken, accessToken: await this.accessTokens.issue(user.id) };
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
