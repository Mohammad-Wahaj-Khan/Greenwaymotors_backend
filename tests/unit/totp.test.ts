import { describe, expect, it } from 'vitest';
import { totpCode, verifyTotp } from '../../src/core/auth/totp.js';

describe('RFC 6238 TOTP', () => {
  it('matches the SHA-1 six-digit reference vector and tolerates one adjacent time step', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(totpCode(secret, 59_000)).toBe('287082');
    expect(verifyTotp(secret, '287082', 59_000)).toBe(true);
    expect(verifyTotp(secret, '287082', 89_000)).toBe(true);
    expect(verifyTotp(secret, '287082', 119_000)).toBe(false);
  });
});
