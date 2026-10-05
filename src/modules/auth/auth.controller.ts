import type { RequestHandler } from 'express';
import type { Environment } from '../../config/env.js';
import { forbiddenError } from '../../core/errors/http-errors.js';
import { getRequestContext } from '../../core/http/request-context.js';
import type { AuthService } from './auth.service.js';
import type { LoginInput, RegisterCustomerInput, UpdateProfileInput } from './auth.schema.js';

const refreshCookieName = 'greenway_refresh_token';

function sessionCookieOptions(environment: Environment) {
  return {
    httpOnly: true,
    secure: environment.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/api/v1/auth',
    ...(environment.NODE_ENV === 'production' ? { domain: environment.COOKIE_DOMAIN } : {}),
    maxAge: environment.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
  };
}

function requestMetadata(request: Parameters<RequestHandler>[0]): {
  ip?: string;
  userAgent?: string;
} {
  const userAgent = request.get('user-agent');
  return { ...(request.ip ? { ip: request.ip } : {}), ...(userAgent ? { userAgent } : {}) };
}

function requireTrustedOrigin(
  request: Parameters<RequestHandler>[0],
  environment: Environment
): void {
  const origin = request.get('origin');
  const referer = request.get('referer');
  if (
    origin === environment.WEB_ORIGIN ||
    (origin === undefined && referer?.startsWith(`${environment.WEB_ORIGIN}/`))
  ) {
    return;
  }
  throw forbiddenError(
    'This cookie-authenticated request must originate from the configured web application.'
  );
}

function readRefreshCookie(request: Parameters<RequestHandler>[0]): string | undefined {
  const cookies: unknown = request.cookies;
  if (typeof cookies !== 'object' || cookies === null || !(refreshCookieName in cookies)) {
    return undefined;
  }
  const token = (cookies as Record<string, unknown>)[refreshCookieName];
  return typeof token === 'string' ? token : undefined;
}

interface AuthController {
  register: RequestHandler;
  login: RequestHandler;
  refresh: RequestHandler;
  logout: RequestHandler;
  logoutAll: RequestHandler;
  requestVerification: RequestHandler;
  confirmVerification: RequestHandler;
  forgotPassword: RequestHandler;
  resetPassword: RequestHandler;
  changePassword: RequestHandler;
  me: RequestHandler;
  updateMe: RequestHandler;
  mfaChallenge: RequestHandler;
  mfaEnroll: RequestHandler;
  mfaConfirm: RequestHandler;
}

export function createAuthController(
  service: AuthService,
  environment: Environment
): AuthController {
  const register: RequestHandler = async (request, response) => {
    const result = await service.registerCustomer(request.body as RegisterCustomerInput);
    response
      .status(201)
      .json({ data: result.user, meta: { requestId: getRequestContext()?.requestId } });
  };

  const login: RequestHandler = async (request, response) => {
    const session = await service.login(request.body as LoginInput, requestMetadata(request));
    if ('mfaChallengeRequired' in session) {
      response
        .status(202)
        .json({ data: session, meta: { requestId: getRequestContext()?.requestId } });
      return;
    }
    response.cookie(refreshCookieName, session.refreshToken, sessionCookieOptions(environment));
    response.json({
      data: {
        accessToken: session.accessToken,
        user: session.user,
        ...(session.mfaSetupRequired ? { mfaSetupRequired: true } : {})
      },
      meta: { requestId: getRequestContext()?.requestId }
    });
  };

  const refresh: RequestHandler = async (request, response) => {
    requireTrustedOrigin(request, environment);
    const token = readRefreshCookie(request);
    if (!token) {
      throw forbiddenError('A refresh session is required.');
    }
    const session = await service.refresh(token, requestMetadata(request));
    response.cookie(refreshCookieName, session.refreshToken, sessionCookieOptions(environment));
    response.json({
      data: { accessToken: session.accessToken, user: session.user },
      meta: { requestId: getRequestContext()?.requestId }
    });
  };

  const logout: RequestHandler = async (request, response) => {
    requireTrustedOrigin(request, environment);
    await service.logout(readRefreshCookie(request));
    response.clearCookie(refreshCookieName, sessionCookieOptions(environment));
    response.json({
      data: { loggedOut: true },
      meta: { requestId: getRequestContext()?.requestId }
    });
  };

  const logoutAll: RequestHandler = async (request, response) => {
    await service.logoutAll(request.auth!.user.id);
    response.clearCookie(refreshCookieName, sessionCookieOptions(environment));
    response.json({
      data: { loggedOut: true },
      meta: { requestId: getRequestContext()?.requestId }
    });
  };

  const requestVerification: RequestHandler = async (request, response) => {
    await service.requestOneTimeToken(
      (request.body as { email: string }).email,
      'email_verification'
    );
    response.json({
      data: { message: 'If an eligible account exists, a verification email will be sent.' },
      meta: { requestId: getRequestContext()?.requestId }
    });
  };

  const confirmVerification: RequestHandler = async (request, response) => {
    await service.confirmEmailVerification((request.body as { token: string }).token);
    response.json({
      data: { verified: true },
      meta: { requestId: getRequestContext()?.requestId }
    });
  };

  const forgotPassword: RequestHandler = async (request, response) => {
    await service.requestOneTimeToken((request.body as { email: string }).email, 'password_reset');
    response.json({
      data: { message: 'If an eligible account exists, a password reset email will be sent.' },
      meta: { requestId: getRequestContext()?.requestId }
    });
  };

  const resetPassword: RequestHandler = async (request, response) => {
    const input = request.body as { token: string; newPassword: string };
    await service.resetPassword(input.token, input.newPassword);
    response.json({
      data: { passwordReset: true },
      meta: { requestId: getRequestContext()?.requestId }
    });
  };

  const changePassword: RequestHandler = async (request, response) => {
    const input = request.body as { currentPassword: string; newPassword: string };
    await service.changePassword(request.auth!.user.id, input.currentPassword, input.newPassword);
    response.clearCookie(refreshCookieName, sessionCookieOptions(environment));
    response.json({
      data: { passwordChanged: true, refreshSessionsRevoked: true },
      meta: { requestId: getRequestContext()?.requestId }
    });
  };

  const me: RequestHandler = (request, response) => {
    response.json({
      data: request.auth!.user,
      meta: { requestId: getRequestContext()?.requestId }
    });
  };

  const updateMe: RequestHandler = async (request, response) => {
    const user = await service.updateProfile(
      request.auth!.user.id,
      request.body as UpdateProfileInput
    );
    response.json({ data: user, meta: { requestId: getRequestContext()?.requestId } });
  };

  const mfaChallenge: RequestHandler = async (request, response) => {
    const input = request.body as { challengeToken: string; code: string };
    const session = await service.verifyMfaChallenge(
      input.challengeToken,
      input.code,
      requestMetadata(request)
    );
    response.cookie(refreshCookieName, session.refreshToken, sessionCookieOptions(environment));
    response.json({
      data: { accessToken: session.accessToken, user: session.user },
      meta: { requestId: getRequestContext()?.requestId }
    });
  };

  const mfaEnroll: RequestHandler = async (request, response) => {
    if (request.auth!.user.userType !== 'staff')
      throw forbiddenError('MFA enrollment is only available to staff.');
    const result = await service.enrollMfa(request.auth!.user.id, request.auth!.user.email);
    response
      .status(201)
      .json({ data: result, meta: { requestId: getRequestContext()?.requestId } });
  };

  const mfaConfirm: RequestHandler = async (request, response) => {
    if (request.auth!.user.userType !== 'staff')
      throw forbiddenError('MFA enrollment is only available to staff.');
    const session = await service.confirmMfa(
      request.auth!.user,
      (request.body as { code: string }).code,
      requestMetadata(request)
    );
    response.cookie(refreshCookieName, session.refreshToken, sessionCookieOptions(environment));
    response.json({
      data: {
        accessToken: session.accessToken,
        user: session.user,
        recoveryCodes: session.recoveryCodes
      },
      meta: { requestId: getRequestContext()?.requestId }
    });
  };

  return {
    register,
    login,
    refresh,
    logout,
    logoutAll,
    requestVerification,
    confirmVerification,
    forgotPassword,
    resetPassword,
    changePassword,
    me,
    updateMe,
    mfaChallenge,
    mfaEnroll,
    mfaConfirm
  };
}
