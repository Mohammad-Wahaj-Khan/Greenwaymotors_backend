import type { Kysely } from 'kysely';
import type { Environment } from '../../config/env.js';
import type { DB, TokenPurpose } from '../../generated/database.types.js';
import type { AuthContext, LoginChallenge, SessionIssue, UserSummary } from './auth.types.js';
import type { LoginInput, RegisterCustomerInput, UpdateProfileInput } from './auth.schema.js';
export declare class AuthService {
    private readonly database;
    private readonly environment;
    private readonly accessTokens;
    constructor(database: Kysely<DB>, environment: Environment);
    authenticateAccessToken(token: string): Promise<AuthContext>;
    getAuthContext(userId: string, mfaSatisfied?: boolean): Promise<AuthContext>;
    registerCustomer(input: RegisterCustomerInput): Promise<{
        user: UserSummary;
    }>;
    login(input: LoginInput, metadata: {
        ip?: string;
        userAgent?: string;
    }): Promise<SessionIssue | LoginChallenge>;
    verifyMfaChallenge(challengeToken: string, code: string, metadata: {
        ip?: string;
        userAgent?: string;
    }): Promise<SessionIssue>;
    enrollMfa(userId: string, email: string): Promise<{
        secret: string;
        otpauthUrl: string;
    }>;
    confirmMfa(user: UserSummary, code: string, metadata: {
        ip?: string;
        userAgent?: string;
    }): Promise<SessionIssue & {
        recoveryCodes: string[];
    }>;
    private userRoles;
    refresh(rawRefreshToken: string, metadata: {
        ip?: string;
        userAgent?: string;
    }): Promise<SessionIssue>;
    logout(rawRefreshToken: string | undefined): Promise<void>;
    logoutAll(userId: string): Promise<void>;
    requestOneTimeToken(email: string, purpose: TokenPurpose): Promise<{
        email: string;
        token: string;
    } | undefined>;
    confirmEmailVerification(token: string): Promise<void>;
    resetPassword(token: string, newPassword: string): Promise<void>;
    changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void>;
    updateProfile(userId: string, input: UpdateProfileInput): Promise<UserSummary>;
    private createSession;
    private insertSession;
    private createOneTimeToken;
    private consumeOneTimeToken;
}
