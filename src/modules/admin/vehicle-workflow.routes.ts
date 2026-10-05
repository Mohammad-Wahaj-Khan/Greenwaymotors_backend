import { Router } from 'express';
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { DB } from '../../generated/database.types.js';
import { audit } from '../../core/db/audit.js';
import { notFoundError } from '../../core/errors/app-error.js';
import { conflictError, validationError } from '../../core/errors/http-errors.js';
import { parseInput, parseUuid, sendData } from '../../core/http/api-response.js';
import { requirePermission } from '../../middleware/authorize.middleware.js';

const marketRow = z
  .object({
    marketId: z.uuid(),
    isActive: z.boolean(),
    featured: z.boolean().default(false),
    priority: z.number().int().min(0).max(10000).default(0),
    availableFrom: z.iso.datetime().nullable().optional(),
    availableUntil: z.iso.datetime().nullable().optional(),
    marketNotes: z.string().trim().max(1000).nullable().optional()
  })
  .strict()
  .refine((v) => !v.availableFrom || !v.availableUntil || v.availableUntil > v.availableFrom);
const singleMarket = z
  .object({
    isActive: z.boolean(),
    featured: z.boolean().default(false),
    priority: z.number().int().min(0).max(10000).default(0),
    availableFrom: z.iso.datetime().nullable().optional(),
    availableUntil: z.iso.datetime().nullable().optional(),
    marketNotes: z.string().trim().max(1000).nullable().optional()
  })
  .strict();
const bulkSchema = z
  .object({ vehicleIds: z.array(z.uuid()).min(1).max(100), markets: z.array(marketRow).max(100) })
  .strict();
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
  r.put(
    '/vehicles/:id/markets/:marketId',
    requirePermission('vehicle_market.manage'),
    async (req, res) => {
      const vehicleId = parseUuid(req.params.id),
        marketId = parseUuid(req.params.marketId),
        input = parseInput(singleMarket, req.body),
        actor = req.auth!.user.id;
      if (
        input.availableFrom &&
        input.availableUntil &&
        input.availableUntil <= input.availableFrom
      )
        throw validationError('availableUntil must follow availableFrom.');
      const row = await db.transaction().execute(async (trx) => {
        const vehicle = await trx
          .selectFrom('vehicles')
          .select('id')
          .where('id', '=', vehicleId)
          .where('deleted_at', 'is', null)
          .forUpdate()
          .executeTakeFirst();
        if (!vehicle) throw notFoundError;
        const market = await trx
          .selectFrom('markets')
          .select('id')
          .where('id', '=', marketId)
          .executeTakeFirst();
        if (!market) throw notFoundError;
        const mapping = await trx
          .insertInto('vehicle_markets')
          .values({
            vehicle_id: vehicleId,
            market_id: marketId,
            is_active: input.isActive,
            featured: input.featured,
            priority: input.priority,
            available_from: input.availableFrom ? new Date(input.availableFrom) : null,
            available_until: input.availableUntil ? new Date(input.availableUntil) : null,
            market_notes: input.marketNotes ?? null,
            created_by: actor
          })
          .onConflict((oc) =>
            oc.columns(['vehicle_id', 'market_id']).doUpdateSet({
              is_active: input.isActive,
              featured: input.featured,
              priority: input.priority,
              available_from: input.availableFrom ? new Date(input.availableFrom) : null,
              available_until: input.availableUntil ? new Date(input.availableUntil) : null,
              market_notes: input.marketNotes ?? null
            })
          )
          .returningAll()
          .executeTakeFirstOrThrow();
        await audit(trx, actor, 'vehicle.market.upsert', 'vehicle', vehicleId, {
          marketId,
          isActive: input.isActive
        });
        return mapping;
      });
      sendData(res, row);
    }
  );
  r.delete(
    '/vehicles/:id/markets/:marketId',
    requirePermission('vehicle_market.manage'),
    async (req, res) => {
      const vehicleId = parseUuid(req.params.id),
        marketId = parseUuid(req.params.marketId),
        actor = req.auth!.user.id;
      await db.transaction().execute(async (trx) => {
        const row = await trx
          .deleteFrom('vehicle_markets')
          .where('vehicle_id', '=', vehicleId)
          .where('market_id', '=', marketId)
          .returning('vehicle_id')
          .executeTakeFirst();
        if (!row) throw notFoundError;
        await audit(trx, actor, 'vehicle.market.remove', 'vehicle', vehicleId, { marketId });
      });
      res.status(204).end();
    }
  );
  r.post(
    '/vehicles/bulk-market-assignment',
    requirePermission('vehicle_market.manage'),
    async (req, res) => {
      const input = parseInput(bulkSchema, req.body),
        actor = req.auth!.user.id;
      if (
        new Set(input.vehicleIds).size !== input.vehicleIds.length ||
        new Set(input.markets.map((x) => x.marketId)).size !== input.markets.length
      )
        throw validationError('Vehicle and market identifiers must be unique.');
      if (input.vehicleIds.length * Math.max(1, input.markets.length) > 2000)
        throw validationError('Bulk assignment exceeds 2,000 mappings.');
      const result = await db.transaction().execute(async (trx) => {
        const vehicles = await trx
          .selectFrom('vehicles')
          .select('id')
          .where('id', 'in', input.vehicleIds)
          .where('deleted_at', 'is', null)
          .orderBy('id')
          .forUpdate()
          .execute();
        if (vehicles.length !== input.vehicleIds.length) throw notFoundError;
        if (input.markets.length) {
          const markets = await trx
            .selectFrom('markets')
            .select('id')
            .where(
              'id',
              'in',
              input.markets.map((x) => x.marketId)
            )
            .execute();
          if (markets.length !== input.markets.length)
            throw validationError('One or more marketIds are invalid.');
        }
        await trx
          .deleteFrom('vehicle_markets')
          .where('vehicle_id', 'in', input.vehicleIds)
          .execute();
        const values = input.vehicleIds.flatMap((vehicleId) =>
          input.markets.map((m) => ({
            vehicle_id: vehicleId,
            market_id: m.marketId,
            is_active: m.isActive,
            featured: m.featured,
            priority: m.priority,
            available_from: m.availableFrom ? new Date(m.availableFrom) : null,
            available_until: m.availableUntil ? new Date(m.availableUntil) : null,
            market_notes: m.marketNotes ?? null,
            created_by: actor
          }))
        );
        if (values.length) await trx.insertInto('vehicle_markets').values(values).execute();
        for (const vehicleId of input.vehicleIds)
          await audit(trx, actor, 'vehicle.markets.bulk_replace', 'vehicle', vehicleId, {
            count: input.markets.length
          });
        return { vehicles: input.vehicleIds.length, mappings: values.length };
      });
      sendData(res, result);
    }
  );
  return r;
}
