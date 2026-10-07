import nodemailer from 'nodemailer';
import type { Environment } from '../../config/env.js';

export interface EmailService {
  sendVerificationEmail(input: { email: string; token: string }): Promise<void>;
  sendPasswordResetEmail(input: { email: string; token: string }): Promise<void>;
  sendPasswordChangedEmail(input: { email: string }): Promise<void>;
}

export function createEmailService(environment: Environment): EmailService {
  const secure = environment.SMTP_PORT === 465;
  const transporter = nodemailer.createTransport({
    host: environment.SMTP_HOST,
    port: environment.SMTP_PORT,
    secure,
    requireTLS: environment.SMTP_USE_TLS && !secure,
    ...(environment.SMTP_USER && environment.SMTP_PASSWORD
      ? { auth: { user: environment.SMTP_USER, pass: environment.SMTP_PASSWORD } }
      : {})
  });

  function actionEmail(
    heading: string,
    message: string,
    actionLabel: string,
    actionUrl: string
  ): { text: string; html: string } {
    const escapedUrl = actionUrl
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
    const text = [
      'GREEN WAY MOTORS',
      '',
      heading,
      '',
      message,
      '',
      `${actionLabel}: ${actionUrl}`,
      '',
      'If you did not request this, you can ignore this email.',
      '',
      'Green Way Motors'
    ].join('\n');
    const html = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${heading}</title></head>
  <body style="margin:0;background:#f3f6f4;font-family:Arial,Helvetica,sans-serif;color:#19231f;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6f4;padding:32px 12px;">
      <tr><td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e1e8e3;border-radius:12px;overflow:hidden;">
          <tr><td style="background:#123c2b;padding:22px 32px;color:#ffffff;font-size:20px;font-weight:700;">Green Way Motors</td></tr>
          <tr><td style="padding:36px 32px 20px;">
            <p style="margin:0 0 10px;color:#4b755f;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;">Account security</p>
            <h1 style="margin:0 0 18px;font-size:26px;line-height:1.3;color:#19231f;">${heading}</h1>
            <p style="margin:0 0 26px;font-size:16px;line-height:1.6;color:#4b5750;">${message}</p>
            <p style="margin:0 0 28px;"><a href="${escapedUrl}" style="display:inline-block;background:#18794e;border-radius:6px;padding:14px 22px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">${actionLabel}</a></p>
            <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#66736b;">If the button does not work, copy this link into your browser:</p>
            <p style="margin:0;overflow-wrap:anywhere;font-size:13px;line-height:1.5;"><a href="${escapedUrl}" style="color:#176b45;">${escapedUrl}</a></p>
          </td></tr>
          <tr><td style="border-top:1px solid #e8ede9;padding:20px 32px 26px;color:#748078;font-size:12px;line-height:1.6;">If you did not request this, you can ignore this email. For help, contact Green Way Motors support.</td></tr>
        </table>
        <p style="margin:18px 0 0;color:#748078;font-size:12px;">Green Way Motors | Account services</p>
      </td></tr>
    </table>
  </body>
</html>`;
    return { text, html };
  }

  async function sendAction(
    email: string,
    subject: string,
    heading: string,
    message: string,
    actionLabel: string,
    path: string,
    token: string
  ): Promise<void> {
    const link = new URL(path, environment.WEB_ORIGIN);
    link.searchParams.set('token', token);
    const content = actionEmail(heading, message, actionLabel, link.toString());
    await transporter.sendMail({
      from: environment.SMTP_FROM ?? environment.MAIL_FROM,
      to: email,
      subject,
      ...content
    });
  }

  async function sendPasswordChanged(email: string): Promise<void> {
    const subject = 'Your Green Way Motors password was changed';
    await transporter.sendMail({
      from: environment.SMTP_FROM ?? environment.MAIL_FROM,
      to: email,
      subject,
      text: [
        'GREEN WAY MOTORS',
        '',
        'Your password was changed',
        '',
        'The password for your Green Way Motors account was changed successfully.',
        'If you did not make this change, contact Green Way Motors support immediately.',
        '',
        'Green Way Motors'
      ].join('\n'),
      html: `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title></head>
  <body style="margin:0;background:#f3f6f4;font-family:Arial,Helvetica,sans-serif;color:#19231f;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6f4;padding:32px 12px;">
      <tr><td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e1e8e3;border-radius:12px;overflow:hidden;">
          <tr><td style="background:#123c2b;padding:22px 32px;color:#ffffff;font-size:20px;font-weight:700;">Green Way Motors</td></tr>
          <tr><td style="padding:36px 32px 30px;">
            <p style="margin:0 0 10px;color:#4b755f;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;">Account security</p>
            <h1 style="margin:0 0 18px;font-size:26px;line-height:1.3;color:#19231f;">Your password was changed</h1>
            <p style="margin:0;font-size:16px;line-height:1.6;color:#4b5750;">The password for your Green Way Motors account was changed successfully.</p>
            <p style="margin:18px 0 0;font-size:15px;line-height:1.6;color:#4b5750;">If you did not make this change, contact Green Way Motors support immediately.</p>
          </td></tr>
          <tr><td style="border-top:1px solid #e8ede9;padding:20px 32px 26px;color:#748078;font-size:12px;line-height:1.6;">This is a security notification. Replies to this message may not be monitored.</td></tr>
        </table>
        <p style="margin:18px 0 0;color:#748078;font-size:12px;">Green Way Motors | Account services</p>
      </td></tr>
    </table>
  </body>
</html>`
    });
  }

  return {
    sendVerificationEmail: ({ email, token }) =>
      sendAction(
        email,
        'Verify your Green Way Motors email',
        'Verify your email address',
        'Confirm your email address to finish setting up your Green Way Motors account.',
        'Verify email address',
        '/verify-email',
        token
      ),
    sendPasswordResetEmail: ({ email, token }) =>
      sendAction(
        email,
        'Reset your Green Way Motors password',
        'Reset your password',
        'We received a request to reset the password for your Green Way Motors account. Use the button below to choose a new password.',
        'Reset password',
        '/reset-password',
        token
      ),
    sendPasswordChangedEmail: ({ email }) => sendPasswordChanged(email)
  };
}
