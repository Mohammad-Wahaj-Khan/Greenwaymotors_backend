import { Router } from 'express';
import { z } from 'zod';
import type { DatabaseConnection } from '../../core/db/database.js';
import { validationError } from '../../core/errors/http-errors.js';
import { getRequestContext } from '../../core/http/request-context.js';
import { PublicCatalogService } from './public-catalog.service.js';

const integerQuery = z.coerce.number().int().positive();
const optionalIntegerQuery = integerQuery.optional();
const listVehiclesQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(100).optional(),
    makeId: optionalIntegerQuery,
    modelId: optionalIntegerQuery,
    bodyTypeId: optionalIntegerQuery,
    condition: z.enum(['new', 'used']).optional(),
    yearMin: z.coerce.number().int().min(1950).max(2100).optional(),
    yearMax: z.coerce.number().int().min(1950).max(2100).optional(),
    mileageMax: z.coerce.number().int().min(0).max(10_000_000).optional(),
    engineCcMin: z.coerce.number().int().min(0).max(20_000).optional(),
    engineCcMax: z.coerce.number().int().min(0).max(20_000).optional(),
    fuel: z
      .enum(['cng', 'diesel', 'electric', 'hybrid', 'lpg', 'other', 'petrol', 'plug_in_hybrid'])
      .optional(),
    transmission: z.enum(['automatic', 'cvt', 'manual', 'semi_automatic']).optional(),
    drive: z.enum(['4wd', 'awd', 'fwd', 'rwd']).optional(),
    steering: z.enum(['lhd', 'rhd']).optional(),
    seats: optionalIntegerQuery,
    doors: optionalIntegerQuery,
    exteriorColor: z.string().trim().min(1).max(100).optional(),
    interiorColor: z.string().trim().min(1).max(100).optional(),
    stockCountryId: optionalIntegerQuery,
    featureIds: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .transform((value, context) => {
        if (!value) return [];
        const raw = Array.isArray(value) ? value : value.split(',');
        const ids = raw.map((item) => Number(item));
        if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
          context.addIssue({
            code: 'custom',
            message: 'featureIds must contain positive integer identifiers.'
          });
          return z.NEVER;
        }
        return [...new Set(ids)];
      }),
    sort: z.enum(['newest', 'oldest', 'year_desc', 'mileage_asc']).default('newest'),
    cursor: z.string().min(1).max(500).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20)
  })
  .superRefine((value, context) => {
    if (
      value.yearMin !== undefined &&
      value.yearMax !== undefined &&
      value.yearMin > value.yearMax
    ) {
      context.addIssue({
        code: 'custom',
        path: ['yearMax'],
        message: 'yearMax must be greater than or equal to yearMin.'
      });
    }
    if (
      value.engineCcMin !== undefined &&
      value.engineCcMax !== undefined &&
      value.engineCcMin > value.engineCcMax
    ) {
      context.addIssue({
        code: 'custom',
        path: ['engineCcMax'],
        message: 'engineCcMax must be greater than or equal to engineCcMin.'
      });
    }
  });

function queryObject(query: unknown): Record<string, string | string[] | undefined> {
  return query as Record<string, string | string[] | undefined>;
}

export function createPublicRouter(database: DatabaseConnection): Router {
  const router = Router();
  const service = new PublicCatalogService(database.db);

  router.get('/countries', async (request, response) => {
    const region =
      typeof request.query.region === 'string' ? request.query.region.trim() : undefined;
    if (region !== undefined && (region.length === 0 || region.length > 100)) {
      throw validationError('region must be between 1 and 100 characters.');
    }
    response.status(200).json({
      data: await service.listCountries(region),
      meta: { requestId: getRequestContext()?.requestId }
    });
  });
  router.get('/catalog/makes', async (_request, response) =>
    response.json({ data: await service.listMakes() })
  );
  router.get('/catalog/models', async (request, response) => {
    const parsed = z
      .object({ makeId: integerQuery.optional() })
      .safeParse(queryObject(request.query));
    if (!parsed.success)
      throw validationError(parsed.error.issues.map((issue) => issue.message).join('; '));
    response.json({ data: await service.listModels(parsed.data.makeId) });
  });
  router.get('/catalog/body-types', async (_request, response) =>
    response.json({ data: await service.listBodyTypes() })
  );
  router.get('/catalog/features', async (_request, response) =>
    response.json({ data: await service.listFeatures() })
  );
  router.get('/vehicles', async (request, response) => {
    const parsed = listVehiclesQuerySchema.safeParse(queryObject(request.query));
    if (!parsed.success)
      throw validationError(parsed.error.issues.map((issue) => issue.message).join('; '));
    const result = await service.listPublishedVehicles(parsed.data);
    response.status(200).json({
      data: result.data,
      meta: { ...result.meta, requestId: getRequestContext()?.requestId }
    });
  });
  router.get('/vehicles/:referenceNo', async (request, response) => {
    const referenceNo = z
      .string()
      .trim()
      .regex(/^GW-\d+$/)
      .safeParse(request.params.referenceNo);
    if (!referenceNo.success) throw validationError('referenceNo must use the GW-<number> format.');
    const vehicle = await service.getPublishedVehicle(referenceNo.data);
    response
      .status(200)
      .json({ data: vehicle, meta: { requestId: getRequestContext()?.requestId } });
  });
  return router;
}
