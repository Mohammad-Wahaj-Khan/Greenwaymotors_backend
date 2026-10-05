import { Router } from 'express';
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { DB, Json } from '../../generated/database.types.js';
import { audit } from '../../core/db/audit.js';
import { notFoundError } from '../../core/errors/app-error.js';
import { parseInput, sendData } from '../../core/http/api-response.js';
import { requirePermission } from '../../middleware/authorize.middleware.js';

const rowSchema = z
  .object({
    makeId: z.number().int().positive(),
    modelId: z.number().int().positive(),
    stockCountryId: z.number().int().positive(),
    title: z.string().trim().min(1).max(200),
    year: z.number().int().min(1950).max(2100),
    inventorySourceId: z.uuid().nullable().optional(),
    stockNumber: z.string().trim().max(100).nullable().optional(),
    vin: z.string().trim().max(100).nullable().optional(),
    condition: z.enum(['new', 'used']).default('used'),
    variant: z.string().trim().max(150).nullable().optional(),
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
    exteriorColor: z.string().trim().max(100).nullable().optional(),
    interiorColor: z.string().trim().max(100).nullable().optional(),
    stockCity: z.string().trim().max(100).nullable().optional(),
    description: z.string().max(10000).nullable().optional()
  })
  .strict();
const createSchema = z
  .union([
    z.object({ rows: z.array(z.unknown()).min(1).max(100) }).strict(),
    z.object({ csv: z.string().min(1).max(1_000_000) }).strict()
  ])
  .transform((input, ctx) => {
    if ('rows' in input) return input.rows;
    try {
      return parseCsvRows(input.csv);
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'Invalid CSV.'
      });
      return z.NEVER;
    }
  });

const numericCsvFields = new Set([
  'makeId',
  'modelId',
  'stockCountryId',
  'year',
  'bodyTypeId',
  'mileageKm',
  'engineCc',
  'seats',
  'doors'
]);
const nullableCsvFields = new Set([
  'inventorySourceId',
  'stockNumber',
  'vin',
  'variant',
  'bodyTypeId',
  'mileageKm',
  'engineCc',
  'fuel',
  'transmission',
  'drive',
  'steering',
  'seats',
  'doors',
  'exteriorColor',
  'interiorColor',
  'stockCity',
  'description'
]);
function parseCsvRows(csv: string): unknown[] {
  const records: string[][] = [];
  let record: string[] = [],
    field = '',
    quoted = false,
    closedQuote = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i]!;
    if (quoted) {
      if (c === '"' && csv[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closedQuote = true;
      } else field += c;
      continue;
    }
    if (c === '"') {
      if (field.length || closedQuote) throw new Error('Unexpected quote in CSV field.');
      quoted = true;
    } else if (c === ',') {
      record.push(field);
      field = '';
      closedQuote = false;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && csv[i + 1] === '\n') i++;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      closedQuote = false;
    } else {
      if (closedQuote) throw new Error('Unexpected characters after a quoted CSV field.');
      field += c;
    }
  }
  if (quoted) throw new Error('CSV ends inside a quoted field.');
  if (field.length || record.length || closedQuote) {
    record.push(field);
    records.push(record);
  }
  while (
    records.length &&
    records[records.length - 1]!.length === 1 &&
    records[records.length - 1]![0] === ''
  )
    records.pop();
  const headers = records.shift()?.map((header) => header.trim()) ?? [];
  if (headers.length === 0 || headers.some((header) => !header))
    throw new Error('CSV must start with named columns.');
  if (new Set(headers).size !== headers.length)
    throw new Error('CSV contains duplicate column names.');
  const allowed = new Set(Object.keys(rowSchema.shape));
  const unknown = headers.filter((header) => !allowed.has(header));
  if (unknown.length) throw new Error(`Unknown CSV columns: ${unknown.join(', ')}.`);
  if (
    !['makeId', 'modelId', 'stockCountryId', 'title', 'year'].every((required) =>
      headers.includes(required)
    )
  )
    throw new Error('CSV must include makeId, modelId, stockCountryId, title, and year.');
  if (records.length < 1 || records.length > 100)
    throw new Error('CSV must contain between 1 and 100 data rows.');
  return records.map((values, index) => {
    if (values.length !== headers.length)
      throw new Error(`CSV row ${index + 2} has a different number of columns than the header.`);
    const row: Record<string, unknown> = {};
    headers.forEach((header, column) => {
      const value = values[column]!;
      if (value === '' && nullableCsvFields.has(header)) row[header] = null;
      else if (numericCsvFields.has(header)) {
        const numeric = Number(value);
        if (!Number.isSafeInteger(numeric))
          throw new Error(`CSV row ${index + 2} has an invalid number in ${header}.`);
        row[header] = numeric;
      } else row[header] = value;
    });
    return row;
  });
}
const paging = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100000).default(0)
});
function failure(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')
    return 'Stock number or VIN already exists.';
  return error instanceof Error ? error.message : 'Row could not be imported.';
}
async function processRow(
  db: Kysely<DB>,
  jobId: string,
  rowNo: number,
  raw: unknown,
  existingId?: string
) {
  const parsed = rowSchema.safeParse(raw);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => ({
      field: i.path.join('.'),
      message: i.message
    }));
    if (existingId)
      await db
        .updateTable('vehicle_import_rows')
        .set({ status: 'failed', errors: errors as Json })
        .where('id', '=', existingId)
        .execute();
    else
      await db
        .insertInto('vehicle_import_rows')
        .values({
          job_id: jobId,
          row_no: rowNo,
          raw_data: raw as Json,
          status: 'failed',
          errors: errors as Json
        })
        .execute();
    return false;
  }
  const x = parsed.data;
  try {
    await db.transaction().execute(async (trx) => {
      if (existingId)
        await trx
          .updateTable('vehicle_import_rows')
          .set({ status: 'queued', errors: [] })
          .where('id', '=', existingId)
          .execute();
      else
        await trx
          .insertInto('vehicle_import_rows')
          .values({
            job_id: jobId,
            row_no: rowNo,
            raw_data: raw as Json,
            status: 'queued',
            errors: []
          })
          .execute();
      const [make, model, country, source] = await Promise.all([
        trx
          .selectFrom('makes')
          .select('id')
          .where('id', '=', x.makeId)
          .where('is_active', '=', true)
          .executeTakeFirst(),
        trx
          .selectFrom('models')
          .select('id')
          .where('id', '=', x.modelId)
          .where('make_id', '=', x.makeId)
          .where('is_active', '=', true)
          .executeTakeFirst(),
        trx
          .selectFrom('countries')
          .select('id')
          .where('id', '=', x.stockCountryId)
          .where('is_active', '=', true)
          .executeTakeFirst(),
        x.inventorySourceId
          ? trx
              .selectFrom('inventory_sources')
              .select('id')
              .where('id', '=', x.inventorySourceId)
              .where('status', '=', 'active')
              .executeTakeFirst()
          : Promise.resolve(true)
      ]);
      if (!make || !model || !country || !source)
        throw new Error('Invalid make, model, country, or inactive inventory source.');
      const vehicle = await trx
        .insertInto('vehicles')
        .values({
          make_id: x.makeId,
          model_id: x.modelId,
          stock_country_id: x.stockCountryId,
          title: x.title,
          year: x.year,
          inventory_source_id: x.inventorySourceId ?? null,
          stock_number: x.stockNumber ?? null,
          vin: x.vin ?? null,
          condition: x.condition,
          status: 'draft',
          variant: x.variant ?? null,
          body_type_id: x.bodyTypeId ?? null,
          mileage_km: x.mileageKm ?? null,
          engine_cc: x.engineCc ?? null,
          fuel: x.fuel ?? null,
          transmission: x.transmission ?? null,
          drive: x.drive ?? null,
          steering: x.steering ?? null,
          seats: x.seats ?? null,
          doors: x.doors ?? null,
          exterior_color: x.exteriorColor ?? null,
          interior_color: x.interiorColor ?? null,
          stock_city: x.stockCity ?? null,
          description: x.description ?? null
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      let update = trx
        .updateTable('vehicle_import_rows')
        .set({ status: 'imported', vehicle_id: vehicle.id, errors: [] })
        .where('job_id', '=', jobId)
        .where('row_no', '=', rowNo);
      if (existingId) update = update.where('id', '=', existingId);
      await update.execute();
    });
    return true;
  } catch (error) {
    const errors = [{ field: 'row', message: failure(error) }] as Json;
    if (existingId)
      await db
        .updateTable('vehicle_import_rows')
        .set({ status: 'failed', vehicle_id: null, errors })
        .where('id', '=', existingId)
        .execute();
    else
      await db
        .insertInto('vehicle_import_rows')
        .values({ job_id: jobId, row_no: rowNo, raw_data: raw as Json, status: 'failed', errors })
        .execute();
    return false;
  }
}
async function finishJob(db: Kysely<DB>, jobId: string, total: number) {
  const rows = await db
    .selectFrom('vehicle_import_rows')
    .select(['status'])
    .where('job_id', '=', jobId)
    .execute();
  const imported = rows.filter((r) => r.status === 'imported').length,
    failed = rows.filter((r) => r.status === 'failed').length;
  const status = failed === 0 ? 'completed' : imported === 0 ? 'failed' : 'partial';
  await db
    .updateTable('vehicle_import_jobs')
    .set({ status, imported_count: imported, failed_count: failed, completed_at: new Date() })
    .where('id', '=', jobId)
    .execute();
  return { status, total, imported, failed };
}
export function createVehicleImportRouter(db: Kysely<DB>): Router {
  const r = Router();
  r.post('/vehicle-imports', requirePermission('vehicle.import'), async (req, res) => {
    const rows = parseInput(createSchema, req.body),
      actor = req.auth!.user.id;
    const job = await db
      .insertInto('vehicle_import_jobs')
      .values({
        created_by: actor,
        row_count: rows.length,
        status: 'processing',
        started_at: new Date()
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (let i = 0; i < rows.length; i++) await processRow(db, job.id, i + 1, rows[i]);
    const result = await finishJob(db, job.id, rows.length);
    await audit(db, actor, 'vehicle_import.create', 'vehicle_import_job', job.id, {
      rowCount: rows.length,
      ...result
    });
    sendData(res, { jobId: job.id, ...result }, 201);
  });
  r.get('/vehicle-imports', requirePermission('vehicle.import'), async (req, res) => {
    const page = parseInput(paging, req.query);
    const rows = await db
      .selectFrom('vehicle_import_jobs')
      .selectAll()
      .orderBy('created_at', 'desc')
      .limit(page.limit)
      .offset(page.offset)
      .execute();
    sendData(res, rows);
  });
  r.get('/vehicle-imports/:id', requirePermission('vehicle.import'), async (req, res) => {
    const id = parseInput(z.uuid(), req.params.id);
    const job = await db
      .selectFrom('vehicle_import_jobs')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!job) throw notFoundError;
    const page = parseInput(paging, req.query);
    const rows = await db
      .selectFrom('vehicle_import_rows')
      .selectAll()
      .where('job_id', '=', id)
      .orderBy('row_no')
      .limit(page.limit)
      .offset(page.offset)
      .execute();
    sendData(res, { ...job, rows });
  });
  r.post('/vehicle-imports/:id/retry', requirePermission('vehicle.import'), async (req, res) => {
    const id = parseInput(z.uuid(), req.params.id),
      actor = req.auth!.user.id;
    const job = await db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('vehicle_import_jobs')
        .selectAll()
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!row) throw notFoundError;
      if (row.status === 'processing') throw new Error('Import is already processing.');
      const failed = await trx
        .selectFrom('vehicle_import_rows')
        .selectAll()
        .where('job_id', '=', id)
        .where('status', '=', 'failed')
        .orderBy('row_no')
        .execute();
      await trx
        .updateTable('vehicle_import_jobs')
        .set({ status: 'processing', started_at: new Date(), completed_at: null })
        .where('id', '=', id)
        .execute();
      return { failed, row_count: row.row_count };
    });
    for (const row of job.failed) await processRow(db, id, row.row_no, row.raw_data, row.id);
    const result = await finishJob(db, id, job.row_count);
    await audit(db, actor, 'vehicle_import.retry', 'vehicle_import_job', id, result);
    sendData(res, { jobId: id, ...result });
  });
  return r;
}
