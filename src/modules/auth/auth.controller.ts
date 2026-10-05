import type { RequestHandler } from 'express';
import type { Environment } from '../../config/env.js';
import { forbiddenError } from '../../core/errors/http-errors.js';
import { getRequestContext } from '../../core/http/request-context.js';
import type { EmailService } from '../../integrations/email/email.service.js';
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

function deliver(
  request: Parameters<RequestHandler>[0],
  task: Promise<void>,
  message: string
): void {
  void task.catch((error: unknown) => request.log.error({ err: error }, message));
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
  me: RequestHandler;
  updateMe: RequestHandler;
}

export function createAuthController(
  service: AuthService,
  email: EmailService,
  environment: Environment
): AuthController {
  const register: RequestHandler = async (request, response) => {
    const result = await service.registerCustomer(request.body as RegisterCustomerInput);
    deliver(
      request,
      email.sendVerificationEmail({ email: result.user.email, token: result.verificationToken }),
      'verification email delivery failed'
    );
    response
      .status(201)
      .json({ data: result.user, meta: { requestId: getRequestContext()?.requestId } });
  };

  const login: RequestHandler = async (request, response) => {
    const session = await service.login(request.body as LoginInput, requestMetadata(request));
    response.cookie(refreshCookieName, session.refreshToken, sessionCookieOptions(environment));
    response.json({
      data: { accessToken: session.accessToken, user: session.user },
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
    const record = await service.requestOneTimeToken(
      (request.body as { email: string }).email,
      'email_verification'
    );
    if (record) {
      deliver(request, email.sendVerificationEmail(record), 'verification email delivery failed');
    }
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
    const record = await service.requestOneTimeToken(
      (request.body as { email: string }).email,
      'password_reset'
    );
    if (record) {
      deliver(
        request,
        email.sendPasswordResetEmail(record),
        'password reset email delivery failed'
      );
    }
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
    me,
    updateMe
  };
}
