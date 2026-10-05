import nodemailer from 'nodemailer';
import type { Environment } from '../../config/env.js';

export interface EmailService {
  sendVerificationEmail(input: { email: string; token: string }): Promise<void>;
  sendPasswordResetEmail(input: { email: string; token: string }): Promise<void>;
}

export function createEmailService(environment: Environment): EmailService {
  const transporter = nodemailer.createTransport({
    host: environment.SMTP_HOST,
    port: environment.SMTP_PORT,
    secure: false
  });

  async function send(email: string, subject: string, path: string, token: string): Promise<void> {
    const link = new URL(path, environment.WEB_ORIGIN);
    link.searchParams.set('token', token);
    await transporter.sendMail({
      from: environment.MAIL_FROM,
      to: email,
      subject,
      text: `${subject}: ${link.toString()}`
    });
  }

  return {
    sendVerificationEmail: ({ email, token }) =>
      send(email, 'Verify your Green Way Motors email', '/verify-email', token),
    sendPasswordResetEmail: ({ email, token }) =>
      send(email, 'Reset your Green Way Motors password', '/reset-password', token)
  };
}
