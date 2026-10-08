import { describe, expect, it } from 'vitest';
import { sessionCookieOptions } from '../../src/modules/auth/auth.cookie.js';

describe('refresh session cookie options', () => {
  it('allows cross-site production refresh requests over HTTPS', () => {
    expect(
      sessionCookieOptions({
        NODE_ENV: 'production',
        COOKIE_DOMAIN: 'wickhub.cc',
        REFRESH_TOKEN_TTL_DAYS: 30
      })
    ).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/api/v1/auth',
      domain: 'wickhub.cc',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });
  });

  it('keeps local development cookies lax and non-secure', () => {
    expect(
      sessionCookieOptions({
        NODE_ENV: 'development',
        COOKIE_DOMAIN: 'localhost',
        REFRESH_TOKEN_TTL_DAYS: 30
      })
    ).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });
  });
});
