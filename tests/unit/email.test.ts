import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEnvironment } from '../../src/config/env.js';
import { createEmailService } from '../../src/integrations/email/email.service.js';

const { createTransportMock, sendMailMock } = vi.hoisted(() => ({
  createTransportMock: vi.fn(),
  sendMailMock: vi
    .fn<
      (message: {
        from: string;
        to: string;
        subject: string;
        text: string;
        html: string;
      }) => Promise<void>
    >()
    .mockResolvedValue(undefined)
}));

vi.mock('nodemailer', () => ({
  default: { createTransport: createTransportMock }
}));

function environment(overrides: Record<string, string> = {}) {
  return parseEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://greenway:greenway@127.0.0.1:55432/greenway_motors_test',
    REDIS_URL: 'redis://127.0.0.1:6379',
    WEB_ORIGIN: 'https://www.greenway.example',
    COOKIE_DOMAIN: 'greenway.example',
    ACCESS_TOKEN_PRIVATE_KEY: 'test-only-signing-key-that-is-at-least-32-characters-long',
    ACCESS_TOKEN_PUBLIC_KEY: 'test-only-signing-key-that-is-at-least-32-characters-long',
    ACCESS_TOKEN_TTL_SECONDS: '900',
    REFRESH_TOKEN_TTL_DAYS: '30',
    S3_ENDPOINT: 'http://127.0.0.1:9000',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'greenway-test',
    S3_ACCESS_KEY_ID: 'test-access-key',
    S3_SECRET_ACCESS_KEY: 'test-secret-key',
    MAIL_FROM: 'no-reply@greenway.example',
    MAIL_PROVIDER: 'smtp',
    SMTP_HOST: 'smtp.greenway.example',
    SMTP_PORT: '587',
    SMTP_USER: 'smtp-user',
    SMTP_PASSWORD: 'smtp-password',
    SMTP_USE_TLS: 'true',
    ...overrides
  });
}

describe('email service SMTP configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTransportMock.mockReturnValue({ sendMail: sendMailMock });
  });

  it('uses SMTP authentication and requires STARTTLS when configured', async () => {
    const email = createEmailService(
      environment({ SMTP_FROM: 'Green Way Motors <admin@greenwaymotors.com>' })
    );

    await email.sendVerificationEmail({ email: 'customer@greenway.example', token: 'test-token' });

    expect(createTransportMock).toHaveBeenCalledWith({
      host: 'smtp.greenway.example',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'smtp-user', pass: 'smtp-password' }
    });
    const message = sendMailMock.mock.calls[0]?.[0];
    expect(message?.from).toBe('Green Way Motors <admin@greenwaymotors.com>');
    expect(message?.to).toBe('customer@greenway.example');
    expect(message?.text).toContain('https://www.greenway.example/verify-email?token=test-token');
    expect(message?.html).toContain('Verify email address');
    expect(message?.html).toContain(
      'href="https://www.greenway.example/verify-email?token=test-token"'
    );
  });

  it('sends a branded password reset email with both HTML and plain text', async () => {
    const email = createEmailService(environment());

    await email.sendPasswordResetEmail({
      email: 'customer@greenway.example',
      token: 'reset-token'
    });

    const message = sendMailMock.mock.calls[0]?.[0];
    expect(message?.subject).toBe('Reset your Green Way Motors password');
    expect(message?.text).toContain(
      'https://www.greenway.example/reset-password?token=reset-token'
    );
    expect(message?.html).toContain('Reset password');
    expect(message?.html).toContain('We received a request to reset the password');
  });

  it('sends a branded password changed security notice', async () => {
    const email = createEmailService(environment());

    await email.sendPasswordChangedEmail({ email: 'customer@greenway.example' });

    const message = sendMailMock.mock.calls[0]?.[0];
    expect(message?.subject).toBe('Your Green Way Motors password was changed');
    expect(message?.text).toContain('If you did not make this change');
    expect(message?.html).toContain('Your password was changed');
  });

  it('uses implicit TLS on port 465', () => {
    createEmailService(environment({ SMTP_PORT: '465', SMTP_USE_TLS: 'false' }));

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ port: 465, secure: true, requireTLS: false })
    );
  });

  it('allows no SMTP credentials but rejects a partial credential pair', () => {
    expect(() => environment({ SMTP_USER: '', SMTP_PASSWORD: '' })).not.toThrow();
    expect(() => environment({ SMTP_USER: 'smtp-user', SMTP_PASSWORD: '' })).toThrow(
      'SMTP_USER and SMTP_PASSWORD must be configured together.'
    );
  });
});
