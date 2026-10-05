import { Router } from 'express';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import type { DB } from '../../generated/database.types.js';
import { notFoundError } from '../../core/errors/app-error.js';
import { parseInput, sendData } from '../../core/http/api-response.js';
import { validationError } from '../../core/errors/http-errors.js';
import { requirePermission } from '../../middleware/authorize.middleware.js';

const idSchema = z.uuid();
const filtersSchema = z
  .object({
    market: z.string().trim().min(1).max(100),
    q: z.string().trim().max(100).optional(),
    makeId: z.number().int().positive().optional(),
    modelId: z.number().int().positive().optional(),
    bodyTypeId: z.number().int().positive().optional(),
    condition: z.enum(['new', 'used']).optional(),
    yearMin: z.number().int().min(1950).max(2100).optional(),
    yearMax: z.number().int().min(1950).max(2100).optional(),
    mileageMax: z.number().int().min(0).max(10000000).optional(),
    fuel: z.array(z.string().max(40)).max(20).optional(),
    transmission: z.array(z.string().max(40)).max(20).optional(),
    drive: z.array(z.string().max(40)).max(20).optional(),
    steering: z.array(z.string().max(40)).max(20).optional()
  })
  .strict();
const createSearch = z
  .object({
    name: z.string().trim().min(1).max(120).nullable().optional(),
    filters: filtersSchema,
    notify: z.boolean().default(true)
  })
  .strict();
const patchSearch = z
  .object({
    name: z.string().trim().min(1).max(120).nullable().optional(),
    filters: filtersSchema.optional(),
    notify: z.boolean().optional()
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0);
const paging = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100000).default(0)
});

export function createMeRouter(db: Kysely<DB>): Router {
  const r = Router();
  r.get('/favorites', async (req, res) => {
    const p = parseInput(paging, req.query);
    const rows = await sql<{
      vehicle_id: string;
      reference_no: string;
      title: string;
      make: string;
      model: string;
      year: number;
      created_at: Date;
    }>`
   SELECT f.vehicle_id,v.reference_no,v.title,mk.name AS make,mo.name AS model,v.year,f.created_at
   FROM favorites f JOIN vehicles v ON v.id=f.vehicle_id JOIN makes mk ON mk.id=v.make_id
   JOIN models mo ON mo.id=v.model_id WHERE f.user_id=${req.auth!.user.id}
    AND v.status='published' AND v.availability_status='available' AND v.deleted_at IS NULL
    AND EXISTS(SELECT 1 FROM vehicle_markets vm JOIN markets m ON m.id=vm.market_id
     WHERE vm.vehicle_id=v.id AND vm.is_active AND m.status='active'
     AND (vm.available_from IS NULL OR vm.available_from<=now())
     AND (vm.available_until IS NULL OR vm.available_until>now()))
   ORDER BY f.created_at DESC,f.vehicle_id DESC LIMIT ${p.limit} OFFSET ${p.offset}
  `.execute(db);
    sendData(res, rows.rows);
  });
  r.put('/favorites/:vehicleId', async (req, res) => {
    const id = parseInput(idSchema, req.params.vehicleId);
    const rows = await sql<{ vehicle_id: string }>`
   INSERT INTO favorites(user_id,vehicle_id)
   SELECT ${req.auth!.user.id},v.id FROM vehicles v
   WHERE v.id=${id} AND v.status='published' AND v.availability_status='available' AND v.deleted_at IS NULL
    AND EXISTS(SELECT 1 FROM vehicle_markets vm JOIN markets m ON m.id=vm.market_id
     WHERE vm.vehicle_id=v.id AND vm.is_active AND m.status='active'
     AND (vm.available_from IS NULL OR vm.available_from<=now())
     AND (vm.available_until IS NULL OR vm.available_until>now()))
   ON CONFLICT(user_id,vehicle_id) DO UPDATE SET user_id=EXCLUDED.user_id RETURNING vehicle_id
  `.execute(db);
    if (!rows.rows[0]) throw notFoundError;
    sendData(res, { vehicleId: rows.rows[0].vehicle_id });
  });
  r.delete('/favorites/:vehicleId', async (req, res) => {
    const id = parseInput(idSchema, req.params.vehicleId);
    await db
      .deleteFrom('favorites')
      .where('user_id', '=', req.auth!.user.id)
      .where('vehicle_id', '=', id)
      .execute();
    res.status(204).end();
  });
  r.get('/saved-searches', async (req, res) => {
    const p = parseInput(paging, req.query);
    const rows = await db
      .selectFrom('saved_searches')
      .select(['id', 'name', 'filters', 'notify', 'last_notified_at', 'created_at'])
      .where('user_id', '=', req.auth!.user.id)
      .orderBy('created_at', 'desc')
      .limit(p.limit)
      .offset(p.offset)
      .execute();
    sendData(res, rows);
  });
  r.post('/saved-searches', async (req, res) => {
    const x = parseInput(createSearch, req.body);
    const row = await db
      .insertInto('saved_searches')
      .values({
        user_id: req.auth!.user.id,
        name: x.name ?? null,
        filters: x.filters,
        notify: x.notify
      })
      .returning(['id', 'name', 'filters', 'notify', 'created_at'])
      .executeTakeFirstOrThrow();
    sendData(res, row, 201);
  });
  r.get('/saved-searches/:id', async (req, res) => {
    const id = parseInput(idSchema, req.params.id);
    const row = await db
      .selectFrom('saved_searches')
      .select(['id', 'name', 'filters', 'notify', 'last_notified_at', 'created_at'])
      .where('id', '=', id)
      .where('user_id', '=', req.auth!.user.id)
      .executeTakeFirst();
    if (!row) throw notFoundError;
    sendData(res, row);
  });
  r.patch('/saved-searches/:id', async (req, res) => {
    const id = parseInput(idSchema, req.params.id),
      x = parseInput(patchSearch, req.body);
    const row = await db
      .updateTable('saved_searches')
      .set({
        ...(x.name === undefined ? {} : { name: x.name }),
        ...(x.filters === undefined ? {} : { filters: x.filters }),
        ...(x.notify === undefined ? {} : { notify: x.notify })
      })
      .where('id', '=', id)
      .where('user_id', '=', req.auth!.user.id)
      .returning(['id', 'name', 'filters', 'notify', 'last_notified_at', 'created_at'])
      .executeTakeFirst();
    if (!row) throw notFoundError;
    sendData(res, row);
  });
  r.delete('/saved-searches/:id', async (req, res) => {
    const id = parseInput(idSchema, req.params.id);
    const row = await db
      .deleteFrom('saved_searches')
      .where('id', '=', id)
      .where('user_id', '=', req.auth!.user.id)
      .executeTakeFirst();
    if (BigInt(row.numDeletedRows) === 0n) throw notFoundError;
    res.status(204).end();
  });
  r.get('/leads', async (req, res) => {
    if (req.auth!.user.userType !== 'customer') throw validationError('Customer account required.');
    const p = parseInput(paging, req.query);
    const rows = await db
      .selectFrom('leads')
      .select(['reference_no', 'status', 'vehicle_snapshot', 'created_at', 'updated_at'])
      .where('customer_id', '=', req.auth!.user.id)
      .orderBy('created_at', 'desc')
      .limit(p.limit)
      .offset(p.offset)
      .execute();
    sendData(res, rows);
  });
  r.get('/leads/:referenceNo', async (req, res) => {
    if (req.auth!.user.userType !== 'customer') throw validationError('Customer account required.');
    const row = await db
      .selectFrom('leads')
      .select(['reference_no', 'status', 'vehicle_snapshot', 'message', 'created_at', 'updated_at'])
      .where('reference_no', '=', req.params.referenceNo)
      .where('customer_id', '=', req.auth!.user.id)
      .executeTakeFirst();
    if (!row) throw notFoundError;
    sendData(res, row);
  });
  r.get('/notifications', async (req, res) => {
    const p = parseInput(paging, req.query);
    const rows = await db
      .selectFrom('notifications')
      .select(['id', 'type', 'title', 'body', 'data', 'read_at', 'created_at'])
      .where('user_id', '=', req.auth!.user.id)
      .orderBy('created_at', 'desc')
      .limit(p.limit)
      .offset(p.offset)
      .execute();
    sendData(res, rows);
  });
  r.patch('/notifications/:id/read', async (req, res) => {
    const id = parseInput(idSchema, req.params.id);
    const row = await db
      .updateTable('notifications')
      .set({ read_at: new Date() })
      .where('id', '=', id)
      .where('user_id', '=', req.auth!.user.id)
      .returning(['id', 'read_at'])
      .executeTakeFirst();
    if (!row) throw notFoundError;
    sendData(res, row);
  });
  r.post('/notifications/read-all', async (req, res) => {
    const row = await db
      .updateTable('notifications')
      .set({ read_at: new Date() })
      .where('user_id', '=', req.auth!.user.id)
      .where('read_at', 'is', null)
      .executeTakeFirst();
    sendData(res, { updated: Number(row.numUpdatedRows) });
  });
  return r;
}

export function createStaffNotificationRouter(db: Kysely<DB>): Router {
  const r = Router();
  r.use(requirePermission('notification.read'));
  r.get('/notifications', async (req, res) => {
    const p = parseInput(paging, req.query);
    const rows = await db
      .selectFrom('notifications')
      .select(['id', 'type', 'title', 'body', 'data', 'read_at', 'created_at'])
      .where('user_id', '=', req.auth!.user.id)
      .orderBy('created_at', 'desc')
      .limit(p.limit)
      .offset(p.offset)
      .execute();
    sendData(res, rows);
  });
  r.patch('/notifications/:id/read', async (req, res) => {
    const id = parseInput(idSchema, req.params.id);
    const row = await db
      .updateTable('notifications')
      .set({ read_at: new Date() })
      .where('id', '=', id)
      .where('user_id', '=', req.auth!.user.id)
      .returning(['id', 'read_at'])
      .executeTakeFirst();
    if (!row) throw notFoundError;
    sendData(res, row);
  });
  return r;
}
