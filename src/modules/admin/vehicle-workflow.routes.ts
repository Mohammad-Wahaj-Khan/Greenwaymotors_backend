import { Router } from 'express';
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { DB } from '../../generated/database.types.js';
import { audit } from '../../core/db/audit.js';
import { notFoundError } from '../../core/errors/app-error.js';
import { conflictError } from '../../core/errors/http-errors.js';
import { parseInput, parseUuid, sendData } from '../../core/http/api-response.js';
import { requirePermission } from '../../middleware/authorize.middleware.js';

const rejectSchema = z.object({ reason: z.string().trim().min(1).max(2000) }).strict();
function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(
      ([k, v]) =>
        [k, /cost|margin|supplier|source|secret|token/i.test(k) ? '[redacted]' : clean(v)] as const
    )
  );
}
export function createVehicleWorkflowRouter(db: Kysely<DB>): Router {
  const r = Router();
  r.post('/vehicles/:id/submit-review', requirePermission('vehicle.submit'), async (req, res) => {
    const id = parseUuid(req.params.id),
      actor = req.auth!.user.id;
    const row = await db.transaction().execute(async (trx) => {
      const current = await trx
        .selectFrom('vehicles')
        .select(['id', 'status'])
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .forUpdate()
        .executeTakeFirst();
      if (!current) throw notFoundError;
      if (!['draft', 'rejected'].includes(current.status))
        throw conflictError('Only draft or rejected vehicles can be submitted for review.');
      const updated = await trx
        .updateTable('vehicles')
        .set({ status: 'pending_review', review_notes: null, reviewed_by: null, reviewed_at: null })
        .where('id', '=', id)
        .returning(['id', 'reference_no', 'status', 'updated_at'])
        .executeTakeFirstOrThrow();
      await audit(trx, actor, 'vehicle.submit_review', 'vehicle', id);
      return updated;
    });
    sendData(res, row);
  });
  r.post('/vehicles/:id/reject', requirePermission('vehicle.reject'), async (req, res) => {
    const id = parseUuid(req.params.id),
      input = parseInput(rejectSchema, req.body),
      actor = req.auth!.user.id;
    const row = await db.transaction().execute(async (trx) => {
      const current = await trx
        .selectFrom('vehicles')
        .select('status')
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .forUpdate()
        .executeTakeFirst();
      if (!current) throw notFoundError;
      if (current.status !== 'pending_review')
        throw conflictError('Only vehicles pending review can be rejected.');
      const updated = await trx
        .updateTable('vehicles')
        .set({
          status: 'rejected',
          review_notes: input.reason,
          reviewed_by: actor,
          reviewed_at: new Date()
        })
        .where('id', '=', id)
        .returning(['id', 'reference_no', 'status', 'review_notes', 'reviewed_at'])
        .executeTakeFirstOrThrow();
      await audit(trx, actor, 'vehicle.reject', 'vehicle', id, { reason: input.reason });
      return updated;
    });
    sendData(res, row);
  });
  r.get('/vehicles/:id/history', requirePermission('vehicle.history.read'), async (req, res) => {
    const id = parseUuid(req.params.id);
    const limit = parseInput(z.coerce.number().int().min(1).max(100).default(50), req.query.limit);
    const exists = await db
      .selectFrom('vehicles')
      .select('id')
      .where('id', '=', id)
      .executeTakeFirst();
    if (!exists) throw notFoundError;
    const rows = await db
      .selectFrom('audit_logs')
      .select(['id', 'actor_id', 'action', 'changes', 'created_at'])
      .where('entity_type', '=', 'vehicle')
      .where('entity_id', '=', id)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
    sendData(
      res,
      rows.map((row) => ({ ...row, changes: clean(row.changes) }))
    );
  });
  return r;
}
