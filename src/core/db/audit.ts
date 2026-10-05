import type { Kysely } from 'kysely';
import type { DB } from '../../generated/database.types.js';

export async function audit(
  db: Kysely<DB>,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  changes?: Record<string, string | number | boolean | null>
): Promise<void> {
  await db
    .insertInto('audit_logs')
    .values({
      actor_id: actorId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      changes: changes ?? null,
      ip_address: null
    })
    .execute();
}
