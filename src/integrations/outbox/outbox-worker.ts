import type { Kysely } from 'kysely';
import type { Environment } from '../../config/env.js';
import { decryptJson } from '../../core/security/encryption.js';
import type { DB } from '../../generated/database.types.js';
import type { EmailService } from '../email/email.service.js';
import type { Logger } from 'pino';

const maxAttempts = 8;
const staleLockMs = 5 * 60 * 1000;

interface MailPayload {
  email: string;
  token?: string;
}

export async function processOutboxEvent(
  db: Kysely<DB>,
  environment: Environment,
  email: EmailService,
  logger: Logger
): Promise<boolean> {
  const event = await db.transaction().execute(async (trx) => {
    const now = new Date();
    const row = await trx
      .selectFrom('outbox_events')
      .selectAll()
      .where((eb) =>
        eb.or([
          eb.and([eb('status', '=', 'pending'), eb('available_at', '<=', now)]),
          eb.and([
            eb('status', '=', 'processing'),
            eb('locked_at', '<', new Date(now.getTime() - staleLockMs))
          ])
        ])
      )
      .orderBy('available_at')
      .orderBy('created_at')
      .forUpdate()
      .skipLocked()
      .executeTakeFirst();
    if (!row) return undefined;
    const attempts = row.attempts + 1;
    const claimed = await trx
      .updateTable('outbox_events')
      .set({ status: 'processing', locked_at: now, attempts })
      .where('id', '=', row.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return claimed;
  });
  if (!event) return false;

  try {
    const payload = event.payload as { ciphertext?: unknown };
    if (typeof payload.ciphertext !== 'string')
      throw new Error('Outbox encrypted payload is missing.');
    const mail = decryptJson<MailPayload>(environment, payload.ciphertext);
    if (!mail.email) throw new Error('Outbox email payload is invalid.');
    if (event.topic === 'email.verification') {
      if (!mail.token) throw new Error('Outbox verification token is missing.');
      await email.sendVerificationEmail({ email: mail.email, token: mail.token });
    } else if (event.topic === 'email.password_reset') {
      if (!mail.token) throw new Error('Outbox password reset token is missing.');
      await email.sendPasswordResetEmail({ email: mail.email, token: mail.token });
    } else if (event.topic === 'email.password_changed') {
      await email.sendPasswordChangedEmail({ email: mail.email });
    } else throw new Error(`Unsupported outbox topic: ${event.topic}`);
    await db
      .updateTable('outbox_events')
      .set({
        status: 'completed',
        locked_at: null,
        completed_at: new Date(),
        last_error: null
      })
      .where('id', '=', event.id)
      .execute();
  } catch (error) {
    const exhausted = event.attempts >= maxAttempts;
    const delayMs = Math.min(6 * 60 * 60 * 1000, 1000 * 2 ** Math.min(event.attempts, 14));
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Email delivery failed.';
    await db
      .updateTable('outbox_events')
      .set({
        status: exhausted ? 'failed' : 'pending',
        locked_at: null,
        available_at: new Date(Date.now() + delayMs),
        last_error: message
      })
      .where('id', '=', event.id)
      .execute();
    logger.warn(
      { eventId: event.id, topic: event.topic, attempts: event.attempts, exhausted },
      'outbox delivery attempt failed'
    );
  }
  return true;
}

export function startOutboxWorker(
  db: Kysely<DB>,
  environment: Environment,
  email: EmailService,
  logger: Logger
): { stop: () => Promise<void> } {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void> | undefined;
  const run = async () => {
    while (!stopped) {
      try {
        if (!(await processOutboxEvent(db, environment, email, logger))) break;
      } catch (error) {
        logger.error({ err: error }, 'outbox worker iteration failed');
        break;
      }
    }
  };
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      active = run().finally(() => {
        active = undefined;
        schedule();
      });
    }, 1000);
    timer.unref();
  };
  schedule();
  return {
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      await active;
    }
  };
}
