import { createHash } from 'node:crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { DB, Json } from '../../generated/database.types.js';
import { conflictError } from '../../core/errors/http-errors.js';
import { notFoundError } from '../../core/errors/app-error.js';
import { audit } from '../../core/db/audit.js';
import type { Request } from 'express';

export type CommercialDb = Kysely<DB> | Transaction<DB>;

export function payloadHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function idempotent<T extends object>(
  trx: Transaction<DB>,
  scope: string,
  key: string,
  input: unknown,
  operation: () => Promise<T>
): Promise<T> {
  const hash = payloadHash(input);
  await sql`select pg_advisory_xact_lock(hashtextextended(${`${scope}:${key}`}, 0))`.execute(trx);
  const old = await trx
    .selectFrom('commercial_idempotency')
    .select(['payload_hash', 'result'])
    .where('scope', '=', scope)
    .where('idempotency_key', '=', key)
    .executeTakeFirst();
  if (old) {
    if (old.payload_hash !== hash)
      throw conflictError('Idempotency key was used with a different request.');
    return old.result as T;
  }
  const result = await operation();
  await trx
    .insertInto('commercial_idempotency')
    .values({ scope, idempotency_key: key, payload_hash: hash, result: result as Json })
    .execute();
  return result;
}

export function canAccessLead(req: Request, lead: { assigned_to: string | null }): boolean {
  return (
    req.auth!.permissions.has('lead.read_all') ||
    (req.auth!.permissions.has('lead.read_assigned') && lead.assigned_to === req.auth!.user.id)
  );
}

export function canAccessDeal(req: Request, deal: { owner_salesperson_id: string }): boolean {
  return (
    req.auth!.permissions.has('deal.read_all') ||
    (req.auth!.permissions.has('deal.read_assigned') &&
      deal.owner_salesperson_id === req.auth!.user.id)
  );
}

export function demandLeadUpdate(req: Request, lead: { assigned_to: string | null }): void {
  if (!(
    req.auth!.permissions.has('lead.update') ||
    (req.auth!.permissions.has('lead.update_assigned') && lead.assigned_to === req.auth!.user.id)
  )) {
    throw notFoundError;
  }
}

export async function writeActivity(
  db: CommercialDb,
  leadId: string,
  actorId: string,
  type: 'status_changed' | 'note',
  body: string,
  meta?: Record<string, unknown>
): Promise<void> {
  await db
    .insertInto('lead_activities')
    .values({
      lead_id: leadId,
      actor_id: actorId,
      type,
      body,
      meta: (meta ?? null) as Json | null
    })
    .execute();
}

export async function notifyUser(
  db: CommercialDb,
  userId: string | null,
  type: string,
  title: string,
  data: Record<string, unknown>
): Promise<void> {
  if (!userId) return;
  await db
    .insertInto('notifications')
    .values({ user_id: userId, type, title, data: data as Json })
    .execute();
}

export { audit };
