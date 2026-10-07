import nodemailer from 'nodemailer';
import { loadEnvironment } from '../src/config/env.js';

const environment = loadEnvironment();
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

try {
  await transporter.verify();
  console.log(`SMTP connection verified (${environment.SMTP_HOST}:${environment.SMTP_PORT}).`);
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown SMTP connection error.';
  const safeMessage = message
    .replaceAll(environment.SMTP_PASSWORD ?? '', '[redacted]')
    .replaceAll(environment.SMTP_USER ?? '', '[redacted]');
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : 'UNKNOWN';
  console.error(`SMTP connection failed (${code}): ${safeMessage}`);
  process.exitCode = 1;
} finally {
  transporter.close();
}
