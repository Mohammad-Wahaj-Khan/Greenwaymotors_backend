import type { Environment } from '../../config/env.js';

export const refreshCookieName = 'greenway_refresh_token';

export function sessionCookieOptions(
  environment: Pick<Environment, 'NODE_ENV' | 'COOKIE_DOMAIN' | 'REFRESH_TOKEN_TTL_DAYS'>
) {
  const isProduction = environment.NODE_ENV === 'production';

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? ('none' as const) : ('lax' as const),
    path: '/api/v1/auth',
    ...(isProduction ? { domain: environment.COOKIE_DOMAIN } : {}),
    maxAge: environment.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
  };
}
