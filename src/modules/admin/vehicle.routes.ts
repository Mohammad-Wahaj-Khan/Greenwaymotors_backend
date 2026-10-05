import { Router } from 'express';
import { type Kysely, type Selectable } from 'kysely';
import { z } from 'zod';
import type {
  DB,
  Vehicles,
  VehicleStatus,
  VehicleAvailabilityStatus
} from '../../generated/database.types.js';
import { notFoundError } from '../../core/errors/app-error.js';
import { conflictError, forbiddenError, validationError } from '../../core/errors/http-errors.js';
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

const nullableText = (max: number) => z.string().trim().max(max).nullable();
const vehicleInput = z.strictObject({
  makeId: z.number().int().positive(),
  modelId: z.number().int().positive(),
  stockCountryId: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  year: z.number().int().min(1950).max(2100),
  inventorySourceId: z.uuid().nullable().optional(),
  stockNumber: nullableText(100).optional(),
  vin: nullableText(100).optional(),
  condition: z.enum(['new', 'used']).optional(),
  variant: nullableText(150).optional(),
  bodyTypeId: z.number().int().positive().nullable().optional(),
  mileageKm: z.number().int().min(0).nullable().optional(),
  engineCc: z.number().int().min(0).nullable().optional(),
  fuel: z
    .enum(['petrol', 'diesel', 'hybrid', 'plug_in_hybrid', 'electric', 'lpg', 'cng', 'other'])
    .nullable()
    .optional(),
  transmission: z.enum(['automatic', 'manual', 'cvt', 'semi_automatic']).nullable().optional(),
  drive: z.enum(['fwd', 'rwd', 'awd', '4wd']).nullable().optional(),
  steering: z.enum(['lhd', 'rhd']).nullable().optional(),
  seats: z.number().int().positive().nullable().optional(),
  doors: z.number().int().positive().nullable().optional(),
  exteriorColor: nullableText(100).optional(),
  interiorColor: nullableText(100).optional(),
  stockCity: nullableText(100).optional(),
  description: nullableText(10000).optional()
});
const amount = z.string().regex(/^\d{1,18}$/);
const costingInput = z
  .strictObject({
    purchaseCostMinor: amount.nullable(),
    purchaseCostCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    estimatedLocalCostMinor: amount.nullable(),
    costNotes: nullableText(4000)
  })
  .refine(
    (value) => (value.purchaseCostMinor === null) === (value.purchaseCostCurrency === null),
    'Purchase cost and currency must both be present or both null.'
  );
const eligibilityInput = z.strictObject({
  markets: z
    .array(
      z
        .strictObject({
          marketId: z.uuid(),
          isActive: z.boolean(),
          featured: z.boolean().default(false),
          priority: z.number().int().min(0).max(10000).default(0),
          availableFrom: z.iso.datetime().nullable().optional(),
          availableUntil: z.iso.datetime().nullable().optional(),
          marketNotes: nullableText(1000).optional()
        })
        .refine(
          (value) =>
            !value.availableFrom ||
            !value.availableUntil ||
            value.availableUntil > value.availableFrom,
          'availableUntil must follow availableFrom.'
        )
    )
    .max(100)
});

function vehicleValues(input: {
  [K in keyof z.output<typeof vehicleInput>]?: z.output<typeof vehicleInput>[K] | undefined;
}) {
  return {
    ...(input.makeId !== undefined && { make_id: input.makeId }),
    ...(input.modelId !== undefined && { model_id: input.modelId }),
    ...(input.stockCountryId !== undefined && { stock_country_id: input.stockCountryId }),
    ...(input.title !== undefined && { title: input.title }),
    ...(input.year !== undefined && { year: input.year }),
    ...(input.inventorySourceId !== undefined && { inventory_source_id: input.inventorySourceId }),
    ...(input.stockNumber !== undefined && { stock_number: input.stockNumber }),
    ...(input.vin !== undefined && { vin: input.vin }),
    ...(input.condition !== undefined && { condition: input.condition }),
    ...(input.variant !== undefined && { variant: input.variant }),
    ...(input.bodyTypeId !== undefined && { body_type_id: input.bodyTypeId }),
    ...(input.mileageKm !== undefined && { mileage_km: input.mileageKm }),
    ...(input.engineCc !== undefined && { engine_cc: input.engineCc }),
    ...(input.fuel !== undefined && { fuel: input.fuel }),
    ...(input.transmission !== undefined && { transmission: input.transmission }),
    ...(input.drive !== undefined && { drive: input.drive }),
    ...(input.steering !== undefined && { steering: input.steering }),
    ...(input.seats !== undefined && { seats: input.seats }),
    ...(input.doors !== undefined && { doors: input.doors }),
    ...(input.exteriorColor !== undefined && { exterior_color: input.exteriorColor }),
    ...(input.interiorColor !== undefined && { interior_color: input.interiorColor }),
    ...(input.stockCity !== undefined && { stock_city: input.stockCity }),
    ...(input.description !== undefined && { description: input.description })
  };
}
function toAdminVehicle(row: Selectable<Vehicles>, canReadSource: boolean) {
  return {
    id: row.id,
    referenceNo: row.reference_no,
    status: row.status,
    availabilityStatus: row.availability_status,
    title: row.title,
    description: row.description,
    makeId: row.make_id,
    modelId: row.model_id,
    variant: row.variant,
    bodyTypeId: row.body_type_id,
    year: row.year,
    condition: row.condition,
    mileageKm: row.mileage_km,
    engineCc: row.engine_cc,
    fuel: row.fuel,
    transmission: row.transmission,
    drive: row.drive,
    steering: row.steering,
    seats: row.seats,
    doors: row.doors,
    exteriorColor: row.exterior_color,
    interiorColor: row.interior_color,
    stockCountryId: row.stock_country_id,
    stockCity: row.stock_city,
    ...(canReadSource
      ? { inventorySourceId: row.inventory_source_id, stockNumber: row.stock_number, vin: row.vin }
      : {}),
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
}
function databaseConflict(error: unknown): never {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')
    throw conflictError('Vehicle identity or mapping already exists.');
  throw error;
}
async function ensureVehicle(db: Kysely<DB>, id: string) {
  const row = await db
    .selectFrom('vehicles')
    .selectAll()
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row) throw notFoundError;
  return row;
}
async function ensureModel(db: Kysely<DB>, makeId: number, modelId: number) {
  const found = await db
    .selectFrom('models')
    .select('id')
    .where('id', '=', modelId)
    .where('make_id', '=', makeId)
    .executeTakeFirst();
  if (!found) throw validationError('modelId does not belong to makeId.');
}

export function createVehicleRouter(db: Kysely<DB>): Router {
  const router = Router();
  router.get('/vehicles', requirePermission('vehicle.read_all'), async (req, res) => {
    const input = parseInput(
      pageQuery.extend({
        status: z
          .enum(['draft', 'pending_review', 'published', 'rejected', 'sold', 'archived'])
          .optional(),
        availabilityStatus: z
          .enum(['available', 'reserved', 'sourcing_hold', 'sold', 'unavailable'])
          .optional()
      }),
      req.query
    );
    const cursor = decodePageCursor(input.cursor);
    let query = db.selectFrom('vehicles').selectAll().where('deleted_at', 'is', null);
    if (input.status) query = query.where('status', '=', input.status);
    if (input.availabilityStatus)
      query = query.where('availability_status', '=', input.availabilityStatus);
    if (input.q)
      query = query.where((eb) =>
        eb.or([eb('title', 'ilike', `%${input.q}%`), eb('reference_no', 'ilike', `%${input.q}%`)])
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
      data.map((row) => toAdminVehicle(row, req.auth!.permissions.has('inventory_source.read'))),
      input.limit,
      rows.length > input.limit && data.at(-1) ? encodePageCursor(data.at(-1)!) : null
    );
  });
  router.post('/vehicles', requirePermission('vehicle.create'), async (req, res) => {
    const input = parseInput(vehicleInput, req.body);
    if (input.inventorySourceId && !req.auth!.permissions.has('inventory_source.read'))
      throw forbiddenError();
    await ensureModel(db, input.makeId, input.modelId);
    try {
      const row = await db.transaction().execute(async (trx) => {
        const created = await trx
          .insertInto('vehicles')
          .values({
            ...vehicleValues(input),
            make_id: input.makeId,
            model_id: input.modelId,
            stock_country_id: input.stockCountryId,
            title: input.title,
            year: input.year,
            created_by: req.auth!.user.id
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await audit(trx, req.auth!.user.id, 'vehicle.create', 'vehicle', created.id);
        return created;
      });
      sendData(res, toAdminVehicle(row, req.auth!.permissions.has('inventory_source.read')), 201);
    } catch (error) {
      databaseConflict(error);
    }
  });
  router.get('/vehicles/:id', requirePermission('vehicle.read_all'), async (req, res) => {
    const row = await ensureVehicle(db, parseUuid(req.params.id));
    sendData(res, toAdminVehicle(row, req.auth!.permissions.has('inventory_source.read')));
  });
  router.patch('/vehicles/:id', requirePermission('vehicle.update'), async (req, res) => {
    const input = parseInput(
      vehicleInput.partial().refine((value) => Object.keys(value).length > 0),
      req.body
    );
    const id = parseUuid(req.params.id);
    if (
      input.inventorySourceId !== undefined &&
      !req.auth!.permissions.has('inventory_source.manage')
    )
      throw forbiddenError();
    const existing = await ensureVehicle(db, id);
    if (input.makeId !== undefined || input.modelId !== undefined)
      await ensureModel(db, input.makeId ?? existing.make_id, input.modelId ?? existing.model_id);
    try {
      const row = await db.transaction().execute(async (trx) => {
        const updated = await trx
          .updateTable('vehicles')
          .set(vehicleValues(input))
          .where('id', '=', id)
          .where('deleted_at', 'is', null)
          .returningAll()
          .executeTakeFirst();
        if (!updated) throw notFoundError;
        await audit(trx, req.auth!.user.id, 'vehicle.update', 'vehicle', id);
        return updated;
      });
      sendData(res, toAdminVehicle(row, req.auth!.permissions.has('inventory_source.read')));
    } catch (error) {
      databaseConflict(error);
    }
  });
  router.delete('/vehicles/:id', requirePermission('vehicle.archive'), async (req, res) => {
    const id = parseUuid(req.params.id);
    await db.transaction().execute(async (trx) => {
      const current = await trx
        .selectFrom('vehicles')
        .select(['id', 'availability_status'])
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .forUpdate()
        .executeTakeFirst();
      if (!current) throw notFoundError;
      if (current.availability_status === 'reserved' || current.availability_status === 'sold')
        throw conflictError('Reserved or sold vehicles cannot be deleted.');
      await trx
        .updateTable('vehicles')
        .set({ deleted_at: new Date(), status: 'archived' })
        .where('id', '=', id)
        .execute();
      await audit(trx, req.auth!.user.id, 'vehicle.delete', 'vehicle', id);
    });
    res.status(204).end();
  });
  router.post('/vehicles/:id/restore', requirePermission('vehicle.archive'), async (req, res) => {
    const id = parseUuid(req.params.id);
    const row = await db.transaction().execute(async (trx) => {
      const current = await trx
        .selectFrom('vehicles')
        .select('id')
        .where('id', '=', id)
        .where('deleted_at', 'is not', null)
        .forUpdate()
        .executeTakeFirst();
      if (!current) throw notFoundError;
      const updated = await trx
        .updateTable('vehicles')
        .set({ deleted_at: null, status: 'draft' })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await audit(trx, req.auth!.user.id, 'vehicle.restore', 'vehicle', id);
      return updated;
    });
    sendData(res, toAdminVehicle(row, req.auth!.permissions.has('inventory_source.read')));
  });
  const commands: Array<{
    name: string;
    permission: string;
    target: VehicleStatus | VehicleAvailabilityStatus;
    column: 'status' | 'availability_status';
  }> = [
    { name: 'publish', permission: 'vehicle.publish', target: 'published', column: 'status' },
    { name: 'unpublish', permission: 'vehicle.publish', target: 'draft', column: 'status' },
    { name: 'archive', permission: 'vehicle.archive', target: 'archived', column: 'status' },
    {
      name: 'mark-unavailable',
      permission: 'vehicle.availability.manage',
      target: 'unavailable',
      column: 'availability_status'
    },
    {
      name: 'mark-available',
      permission: 'vehicle.availability.manage',
      target: 'available',
      column: 'availability_status'
    },
    {
      name: 'mark-sold',
      permission: 'vehicle.availability.manage',
      target: 'sold',
      column: 'availability_status'
    }
  ];
  for (const command of commands) {
    router.post(
      `/vehicles/:id/${command.name}`,
      requirePermission(command.permission),
      async (req, res) => {
        const id = parseUuid(req.params.id);
        const row = await db.transaction().execute(async (trx) => {
          const current = await trx
            .selectFrom('vehicles')
            .selectAll()
            .where('id', '=', id)
            .where('deleted_at', 'is', null)
            .forUpdate()
            .executeTakeFirst();
          if (!current) throw notFoundError;
          if (
            command.name === 'publish' &&
            !['draft', 'pending_review', 'rejected'].includes(current.status)
          )
            throw conflictError('Invalid publication transition.');
          if (command.name === 'unpublish' && current.status !== 'published')
            throw conflictError('Invalid publication transition.');
          if (command.name === 'archive' && current.status === 'sold')
            throw conflictError('Sold vehicles cannot be archived.');
          if (command.name === 'mark-unavailable' && current.availability_status !== 'available')
            throw conflictError('Vehicle is not available.');
          if (command.name === 'mark-available' && current.availability_status !== 'unavailable')
            throw conflictError('Vehicle cannot be made available.');
          if (
            command.name === 'mark-sold' &&
            !['available', 'unavailable'].includes(current.availability_status)
          )
            throw conflictError('Vehicle cannot be marked sold.');
          if (command.name === 'publish') {
            const mapping = await trx
              .selectFrom('vehicle_markets')
              .select('market_id')
              .where('vehicle_id', '=', id)
              .where('is_active', '=', true)
              .executeTakeFirst();
            if (!mapping)
              throw conflictError('Configure an active vehicle-market mapping before publication.');
          }
          if (command.name === 'mark-available' || command.name === 'mark-sold') {
            const hold = await trx
              .selectFrom('vehicle_reservations')
              .select('id')
              .where('vehicle_id', '=', id)
              .where('status', '=', 'active')
              .executeTakeFirst();
            if (hold) throw conflictError('An active reservation protects this vehicle.');
          }
          const values =
            command.column === 'status'
              ? {
                  status: command.target as VehicleStatus,
                  ...(command.name === 'publish' ? { published_at: new Date() } : {})
                }
              : {
                  availability_status: command.target as VehicleAvailabilityStatus,
                  ...(command.name === 'mark-sold' ? { sold_at: new Date() } : {})
                };
          const updated = await trx
            .updateTable('vehicles')
            .set(values)
            .where('id', '=', id)
            .returningAll()
            .executeTakeFirstOrThrow();
          await audit(trx, req.auth!.user.id, `vehicle.${command.name}`, 'vehicle', id, {
            from: command.column === 'status' ? current.status : current.availability_status,
            to: command.target
          });
          return updated;
        });
        sendData(res, toAdminVehicle(row, req.auth!.permissions.has('inventory_source.read')));
      }
    );
  }
  router.put('/vehicles/:id/features', requirePermission('vehicle.update'), async (req, res) => {
    const input = parseInput(
      z.strictObject({ featureIds: z.array(z.number().int().positive()).max(200) }),
      req.body
    );
    if (new Set(input.featureIds).size !== input.featureIds.length)
      throw validationError('featureIds must be unique.');
    const id = parseUuid(req.params.id);
    await db.transaction().execute(async (trx) => {
      const vehicle = await trx
        .selectFrom('vehicles')
        .select('id')
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .forUpdate()
        .executeTakeFirst();
      if (!vehicle) throw notFoundError;
      if (input.featureIds.length) {
        const found = await trx
          .selectFrom('features')
          .select('id')
          .where('id', 'in', input.featureIds)
          .execute();
        if (found.length !== input.featureIds.length)
          throw validationError('One or more featureIds are invalid.');
      }
      await trx.deleteFrom('vehicle_features').where('vehicle_id', '=', id).execute();
      if (input.featureIds.length)
        await trx
          .insertInto('vehicle_features')
          .values(input.featureIds.map((featureId) => ({ vehicle_id: id, feature_id: featureId })))
          .execute();
      await audit(trx, req.auth!.user.id, 'vehicle.features.replace', 'vehicle', id, {
        count: input.featureIds.length
      });
    });
    sendData(res, { featureIds: input.featureIds });
  });
  router.get('/vehicles/:id/features', requirePermission('vehicle.read_all'), async (req, res) => {
    const id = parseUuid(req.params.id);
    await ensureVehicle(db, id);
    const rows = await db
      .selectFrom('vehicle_features')
      .innerJoin('features', 'features.id', 'vehicle_features.feature_id')
      .select(['features.id', 'features.name', 'features.category'])
      .where('vehicle_features.vehicle_id', '=', id)
      .execute();
    sendData(res, rows);
  });
  router.get('/vehicles/:id/markets', requirePermission('vehicle.read_all'), async (req, res) => {
    const id = parseUuid(req.params.id);
    await ensureVehicle(db, id);
    const rows = await db
      .selectFrom('vehicle_markets')
      .selectAll()
      .where('vehicle_id', '=', id)
      .execute();
    sendData(
      res,
      rows.map((row) => ({
        marketId: row.market_id,
        isActive: row.is_active,
        featured: row.featured,
        priority: row.priority,
        availableFrom: row.available_from,
        availableUntil: row.available_until,
        marketNotes: row.market_notes
      }))
    );
  });
  router.put(
    '/vehicles/:id/markets',
    requirePermission('vehicle_market.manage'),
    async (req, res) => {
      const input = parseInput(eligibilityInput, req.body);
      if (new Set(input.markets.map((item) => item.marketId)).size !== input.markets.length)
        throw validationError('Duplicate marketId.');
      const id = parseUuid(req.params.id);
      await db.transaction().execute(async (trx) => {
        const vehicle = await trx
          .selectFrom('vehicles')
          .select('id')
          .where('id', '=', id)
          .where('deleted_at', 'is', null)
          .forUpdate()
          .executeTakeFirst();
        if (!vehicle) throw notFoundError;
        if (input.markets.length) {
          const found = await trx
            .selectFrom('markets')
            .select('id')
            .where(
              'id',
              'in',
              input.markets.map((item) => item.marketId)
            )
            .execute();
          if (found.length !== input.markets.length)
            throw validationError('One or more marketIds are invalid.');
        }
        await trx.deleteFrom('vehicle_markets').where('vehicle_id', '=', id).execute();
        if (input.markets.length)
          await trx
            .insertInto('vehicle_markets')
            .values(
              input.markets.map((item) => ({
                vehicle_id: id,
                market_id: item.marketId,
                is_active: item.isActive,
                featured: item.featured,
                priority: item.priority,
                available_from: item.availableFrom ? new Date(item.availableFrom) : null,
                available_until: item.availableUntil ? new Date(item.availableUntil) : null,
                market_notes: item.marketNotes ?? null,
                created_by: req.auth!.user.id
              }))
            )
            .execute();
        await audit(trx, req.auth!.user.id, 'vehicle.markets.replace', 'vehicle', id, {
          count: input.markets.length
        });
      });
      sendData(res, { markets: input.markets });
    }
  );
  router.get('/vehicles/:id/costing', requirePermission('vehicle.cost.read'), async (req, res) => {
    const row = await ensureVehicle(db, parseUuid(req.params.id));
    sendData(res, {
      vehicleId: row.id,
      purchaseCostMinor: row.purchase_cost_minor,
      purchaseCostCurrency: row.purchase_cost_currency,
      estimatedLocalCostMinor: row.estimated_local_cost_minor,
      costNotes: row.cost_notes
    });
  });
  router.put(
    '/vehicles/:id/costing',
    requirePermission('vehicle.cost.update'),
    async (req, res) => {
      const input = parseInput(costingInput, req.body);
      const id = parseUuid(req.params.id);
      const row = await db.transaction().execute(async (trx) => {
        const updated = await trx
          .updateTable('vehicles')
          .set({
            purchase_cost_minor: input.purchaseCostMinor,
            purchase_cost_currency: input.purchaseCostCurrency,
            estimated_local_cost_minor: input.estimatedLocalCostMinor,
            cost_notes: input.costNotes
          })
          .where('id', '=', id)
          .where('deleted_at', 'is', null)
          .returningAll()
          .executeTakeFirst();
        if (!updated) throw notFoundError;
        await audit(trx, req.auth!.user.id, 'vehicle.cost.update', 'vehicle', id);
        return updated;
      });
      sendData(res, {
        vehicleId: row.id,
        purchaseCostMinor: row.purchase_cost_minor,
        purchaseCostCurrency: row.purchase_cost_currency,
        estimatedLocalCostMinor: row.estimated_local_cost_minor,
        costNotes: row.cost_notes
      });
    }
  );
  return router;
}
