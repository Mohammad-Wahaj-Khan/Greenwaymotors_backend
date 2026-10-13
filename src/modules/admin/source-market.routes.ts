import { Router } from 'express';
import { z } from 'zod';
import type { Kysely, Selectable } from 'kysely';
import type { DB, InventorySources } from '../../generated/database.types.js';
import { notFoundError } from '../../core/errors/app-error.js';
import { conflictError } from '../../core/errors/http-errors.js';
import { audit } from '../../core/db/audit.js';
import {
  decodePageCursor,
  encodePageCursor,
  pageQuery,
  parseInput,
  parseUuid,
  sendData,
  sendPage
} from '../../core/http/api-response.js';
import { requirePermission } from '../../middleware/authorize.middleware.js';

const sourceInput = z.strictObject({
  companyName: z.string().trim().min(1).max(200),
  sourceCode: z.string().trim().min(1).max(60).nullable().optional(),
  countryId: z.number().int().positive().nullable().optional(),
  city: z.string().trim().max(100).nullable().optional(),
  contactName: z.string().trim().max(150).nullable().optional(),
  email: z.email().nullable().optional(),
  phone: z.string().trim().max(60).nullable().optional(),
  whatsapp: z.string().trim().max(60).nullable().optional(),
  website: z.url().nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
  reference: z.string().trim().max(100).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  paymentTerms: z.string().trim().max(1000).nullable().optional(),
  reliabilityRating: z.number().int().min(1).max(5).nullable().optional(),
  internalNotes: z.string().trim().max(2000).nullable().optional()
});
function sourceValues(input: {
  [K in keyof z.output<typeof sourceInput>]?: z.output<typeof sourceInput>[K] | undefined;
}) {
  return {
    ...(input.companyName !== undefined && { company_name: input.companyName }),
    ...(input.sourceCode !== undefined && { source_code: input.sourceCode }),
    ...(input.countryId !== undefined && { country_id: input.countryId }),
    ...(input.city !== undefined && { city: input.city }),
    ...(input.contactName !== undefined && { contact_name: input.contactName }),
    ...(input.email !== undefined && { email: input.email }),
    ...(input.phone !== undefined && { phone: input.phone }),
    ...(input.whatsapp !== undefined && { whatsapp: input.whatsapp }),
    ...(input.website !== undefined && { website: input.website }),
    ...(input.address !== undefined && { address: input.address }),
    ...(input.reference !== undefined && { reference: input.reference }),
    ...(input.notes !== undefined && { notes: input.notes }),
    ...(input.paymentTerms !== undefined && { payment_terms: input.paymentTerms }),
    ...(input.reliabilityRating !== undefined && { reliability_rating: input.reliabilityRating }),
    ...(input.internalNotes !== undefined && { internal_notes: input.internalNotes })
  };
}

function toSource(row: Selectable<InventorySources>) {
  return {
    id: row.id,
    companyName: row.company_name,
    sourceCode: row.source_code,
    status: row.status,
    countryId: row.country_id,
    city: row.city,
    contactName: row.contact_name,
    email: row.email,
    phone: row.phone,
    whatsapp: row.whatsapp,
    website: row.website,
    address: row.address,
    reference: row.reference,
    notes: row.notes,
    paymentTerms: row.payment_terms,
    reliabilityRating: row.reliability_rating,
    internalNotes: row.internal_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function uniqueOrThrow(error: unknown): never {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')
    throw conflictError('A record with this unique value already exists.');
  throw error;
}

export function createSourceMarketRouter(db: Kysely<DB>): Router {
  const router = Router();
  router.get('/inventory-sources', requirePermission('inventory_source.read'), async (req, res) => {
    const input = parseInput(pageQuery, req.query);
    const cursor = decodePageCursor(input.cursor);
    let query = db.selectFrom('inventory_sources').selectAll();
    if (input.q)
      query = query.where((eb) =>
        eb.or([
          eb('company_name', 'ilike', `%${input.q}%`),
          eb('source_code', 'ilike', `%${input.q}%`)
        ])
      );
    if (cursor)
      query = query.where((eb) =>
        eb.or([
          eb('created_at', '<', cursor.createdAt),
          eb.and([eb('created_at', '=', cursor.createdAt), eb('id', '<', cursor.id)])
        ])
      );
    const rows = await query
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(input.limit + 1)
      .execute();
    const data = rows.slice(0, input.limit);
    sendPage(
      res,
      data.map(toSource),
      input.limit,
      rows.length > input.limit && data.at(-1) ? encodePageCursor(data.at(-1)!) : null
    );
  });
  router.post(
    '/inventory-sources',
    requirePermission('inventory_source.manage'),
    async (req, res) => {
      const input = parseInput(sourceInput, req.body);
      try {
        const row = await db.transaction().execute(async (trx) => {
          const created = await trx
            .insertInto('inventory_sources')
            .values({
              company_name: input.companyName,
              ...sourceValues(input),
              created_by: req.auth!.user.id,
              updated_by: req.auth!.user.id
            })
            .returningAll()
            .executeTakeFirstOrThrow();
          await audit(
            trx,
            req.auth!.user.id,
            'inventory_source.create',
            'inventory_source',
            created.id
          );
          return created;
        });
        sendData(res, toSource(row), 201);
      } catch (error) {
        uniqueOrThrow(error);
      }
    }
  );
  router.get(
    '/inventory-sources/:id',
    requirePermission('inventory_source.read'),
    async (req, res) => {
      const row = await db
        .selectFrom('inventory_sources')
        .selectAll()
        .where('id', '=', parseUuid(req.params.id))
        .executeTakeFirst();
      if (!row) throw notFoundError;
      sendData(res, toSource(row));
    }
  );
  router.get(
    '/inventory-sources/:id/vehicles',
    requirePermission('inventory_source.read'),
    async (req, res) => {
      const id = parseUuid(req.params.id);
      const source = await db
        .selectFrom('inventory_sources')
        .select('id')
        .where('id', '=', id)
        .executeTakeFirst();
      if (!source) throw notFoundError;
      const rows = await db
        .selectFrom('vehicles')
        .select(['id', 'reference_no', 'title', 'status', 'availability_status'])
        .where('inventory_source_id', '=', id)
        .where('deleted_at', 'is', null)
        .orderBy('created_at', 'desc')
        .limit(100)
        .execute();
      sendData(
        res,
        rows.map((row) => ({
          id: row.id,
          referenceNo: row.reference_no,
          title: row.title,
          status: row.status,
          availabilityStatus: row.availability_status
        }))
      );
    }
  );
  router.patch(
    '/inventory-sources/:id',
    requirePermission('inventory_source.manage'),
    async (req, res) => {
      const input = parseInput(
        sourceInput.partial().refine((value) => Object.keys(value).length > 0),
        req.body
      );
      const id = parseUuid(req.params.id);
      try {
        const row = await db.transaction().execute(async (trx) => {
          const updated = await trx
            .updateTable('inventory_sources')
            .set({ ...sourceValues(input), updated_by: req.auth!.user.id })
            .where('id', '=', id)
            .returningAll()
            .executeTakeFirst();
          if (!updated) throw notFoundError;
          await audit(trx, req.auth!.user.id, 'inventory_source.update', 'inventory_source', id);
          return updated;
        });
        sendData(res, toSource(row));
      } catch (error) {
        uniqueOrThrow(error);
      }
    }
  );
  for (const [action, status] of [
    ['activate', 'active'],
    ['deactivate', 'inactive'],
    ['block', 'blocked']
  ] as const) {
    router.post(
      `/inventory-sources/:id/${action}`,
      requirePermission('inventory_source.manage'),
      async (req, res) => {
        const id = parseUuid(req.params.id);
        const row = await db.transaction().execute(async (trx) => {
          const updated = await trx
            .updateTable('inventory_sources')
            .set({ status, updated_by: req.auth!.user.id })
            .where('id', '=', id)
            .returningAll()
            .executeTakeFirst();
          if (!updated) throw notFoundError;
          await audit(trx, req.auth!.user.id, `inventory_source.${action}`, 'inventory_source', id);
          return updated;
        });
        sendData(res, toSource(row));
      }
    );
  }

  return router;
}
