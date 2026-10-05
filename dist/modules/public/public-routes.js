import { Router } from 'express';
import { z } from 'zod';
import { validationError } from '../../core/errors/http-errors.js';
import { getRequestContext } from '../../core/http/request-context.js';
import { parseInput } from '../../core/http/api-response.js';
import { PublicCatalogService } from './public-catalog.service.js';
const integerQuery = z.coerce.number().int().positive();
const optionalIntegerQuery = integerQuery.optional();
function multiEnum(values) {
    return z
        .union([z.string(), z.array(z.string())])
        .optional()
        .transform((value, context) => {
        if (value === undefined)
            return undefined;
        const entries = (Array.isArray(value) ? value : [value]).flatMap((item) => item.split(','));
        if (entries.some((item) => !values.includes(item))) {
            context.addIssue({ code: 'custom', message: `Allowed values: ${values.join(', ')}.` });
            return z.NEVER;
        }
        return [...new Set(entries)];
    });
}
const listVehiclesQuerySchema = z
    .object({
    market: z.string().trim().min(1).max(100),
    q: z.string().trim().min(1).max(100).optional(),
    makeId: optionalIntegerQuery,
    modelId: optionalIntegerQuery,
    bodyTypeId: optionalIntegerQuery,
    condition: z.enum(['new', 'used']).optional(),
    yearMin: z.coerce.number().int().min(1950).max(2100).optional(),
    yearMax: z.coerce.number().int().min(1950).max(2100).optional(),
    yearFrom: z.coerce.number().int().min(1950).max(2100).optional(),
    yearTo: z.coerce.number().int().min(1950).max(2100).optional(),
    mileageFrom: z.coerce.number().int().min(0).max(10_000_000).optional(),
    mileageTo: z.coerce.number().int().min(0).max(10_000_000).optional(),
    mileageMax: z.coerce.number().int().min(0).max(10_000_000).optional(),
    engineCcFrom: z.coerce.number().int().min(0).max(20_000).optional(),
    engineCcTo: z.coerce.number().int().min(0).max(20_000).optional(),
    engineCcMin: z.coerce.number().int().min(0).max(20_000).optional(),
    engineCcMax: z.coerce.number().int().min(0).max(20_000).optional(),
    fuel: multiEnum([
        'cng',
        'diesel',
        'electric',
        'hybrid',
        'lpg',
        'other',
        'petrol',
        'plug_in_hybrid'
    ]),
    transmission: multiEnum(['automatic', 'cvt', 'manual', 'semi_automatic']),
    drive: multiEnum(['4wd', 'awd', 'fwd', 'rwd']),
    steering: multiEnum(['lhd', 'rhd']),
    seats: optionalIntegerQuery,
    doors: optionalIntegerQuery,
    exteriorColor: z.string().trim().min(1).max(100).optional(),
    interiorColor: z.string().trim().min(1).max(100).optional(),
    stockCountryId: optionalIntegerQuery,
    featureIds: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .transform((value, context) => {
        if (!value)
            return [];
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
    sort: z
        .enum(['newest', 'oldest', 'year_desc', 'year_asc', 'mileage_asc', 'mileage_desc'])
        .default('newest'),
    cursor: z.string().min(1).max(500).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20)
})
    .superRefine((value, context) => {
    if (value.yearMin !== undefined &&
        value.yearMax !== undefined &&
        value.yearMin > value.yearMax) {
        context.addIssue({
            code: 'custom',
            path: ['yearMax'],
            message: 'yearMax must be greater than or equal to yearMin.'
        });
    }
    if (value.engineCcMin !== undefined &&
        value.engineCcMax !== undefined &&
        value.engineCcMin > value.engineCcMax) {
        context.addIssue({
            code: 'custom',
            path: ['engineCcMax'],
            message: 'engineCcMax must be greater than or equal to engineCcMin.'
        });
    }
    for (const [from, to, path] of [
        [value.yearFrom, value.yearTo, 'yearTo'],
        [value.mileageFrom, value.mileageTo, 'mileageTo'],
        [value.engineCcFrom, value.engineCcTo, 'engineCcTo']
    ]) {
        if (from !== undefined && to !== undefined && from > to)
            context.addIssue({
                code: 'custom',
                path: [path],
                message: `${path} must be greater than or equal to its lower bound.`
            });
    }
});
function queryObject(query) {
    return query;
}
export function createPublicRouter(database) {
    const router = Router();
    const service = new PublicCatalogService(database.db);
    router.get('/countries', async (request, response) => {
        const region = typeof request.query.region === 'string' ? request.query.region.trim() : undefined;
        if (region !== undefined && (region.length === 0 || region.length > 100)) {
            throw validationError('region must be between 1 and 100 characters.');
        }
        response.status(200).json({
            data: await service.listCountries(region),
            meta: { requestId: getRequestContext()?.requestId }
        });
    });
    router.get('/markets', async (_request, response) => {
        response.json({
            data: await service.listMarkets(),
            meta: { requestId: getRequestContext()?.requestId }
        });
    });
    router.get('/markets/:marketSlug', async (request, response) => {
        const slug = z.string().trim().min(1).max(100).safeParse(request.params.marketSlug);
        if (!slug.success)
            throw validationError('marketSlug is invalid.');
        response.json({
            data: await service.getMarket(slug.data),
            meta: { requestId: getRequestContext()?.requestId }
        });
    });
    router.get('/market-context', async (request, response) => {
        const parsed = z
            .object({ market: z.string().trim().min(1).max(100).optional() })
            .safeParse(queryObject(request.query));
        if (!parsed.success)
            throw validationError('market must be a valid market slug.');
        let query = database.db
            .selectFrom('markets')
            .innerJoin('countries', 'countries.id', 'markets.country_id')
            .select([
            'markets.id',
            'markets.slug',
            'markets.currency_code',
            'markets.locale',
            'markets.sales_email',
            'markets.sales_phone',
            'markets.sales_whatsapp',
            'countries.iso2',
            'countries.iso3',
            'countries.name as country_name'
        ])
            .where('markets.status', '=', 'active')
            .where('countries.is_active', '=', true);
        if (parsed.data.market)
            query = query.where('markets.slug', '=', parsed.data.market);
        const market = await query.orderBy('markets.slug').executeTakeFirst();
        response.json({
            data: {
                market: market ?? null,
                selection: parsed.data.market ? 'client' : 'default',
                geolocation: 'not_configured'
            },
            meta: { requestId: getRequestContext()?.requestId }
        });
    });
    router.get('/catalog/makes', async (_request, response) => response.json({
        data: await service.listMakes(),
        meta: { requestId: getRequestContext()?.requestId }
    }));
    router.get('/catalog/models', async (request, response) => {
        const parsed = z
            .object({ makeId: integerQuery.optional() })
            .safeParse(queryObject(request.query));
        if (!parsed.success)
            throw validationError(parsed.error.issues.map((issue) => issue.message).join('; '));
        response.json({
            data: await service.listModels(parsed.data.makeId),
            meta: { requestId: getRequestContext()?.requestId }
        });
    });
    router.get('/catalog/makes/:makeId/models', async (request, response) => {
        const makeId = parseInput(integerQuery, request.params.makeId);
        response.json({
            data: await service.listModels(makeId),
            meta: { requestId: getRequestContext()?.requestId }
        });
    });
    router.get('/catalog/body-types', async (_request, response) => response.json({
        data: await service.listBodyTypes(),
        meta: { requestId: getRequestContext()?.requestId }
    }));
    router.get('/catalog/features', async (_request, response) => response.json({
        data: await service.listFeatures(),
        meta: { requestId: getRequestContext()?.requestId }
    }));
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
    router.get('/vehicles/featured', async (request, response) => {
        const parsed = z
            .object({
            market: z.string().trim().min(1).max(100),
            limit: z.coerce.number().int().min(1).max(50).default(12)
        })
            .safeParse(queryObject(request.query));
        if (!parsed.success)
            throw validationError('market and a valid limit are required.');
        const result = await service.listPublishedVehicles({
            market: parsed.data.market,
            limit: parsed.data.limit,
            sort: 'newest',
            featureIds: [],
            featuredOnly: true
        });
        response.json({
            data: result.data,
            meta: { ...result.meta, requestId: getRequestContext()?.requestId }
        });
    });
    router.get('/vehicles/new-arrivals', async (request, response) => {
        const parsed = z
            .object({
            market: z.string().trim().min(1).max(100),
            limit: z.coerce.number().int().min(1).max(50).default(12)
        })
            .safeParse(queryObject(request.query));
        if (!parsed.success)
            throw validationError('market and a valid limit are required.');
        const result = await service.listPublishedVehicles({
            market: parsed.data.market,
            limit: parsed.data.limit,
            sort: 'newest',
            featureIds: []
        });
        response.json({
            data: result.data,
            meta: { ...result.meta, requestId: getRequestContext()?.requestId }
        });
    });
    router.get('/vehicles/:referenceNo/similar', async (request, response) => {
        const market = z.string().trim().min(1).max(100).safeParse(request.query.market);
        if (!market.success)
            throw validationError('market is required.');
        const referenceNo = z
            .string()
            .trim()
            .regex(/^GW-\d+$/)
            .safeParse(request.params.referenceNo);
        if (!referenceNo.success)
            throw validationError('referenceNo is invalid.');
        const vehicle = await service.getPublishedVehicle(referenceNo.data, market.data);
        const result = await service.listPublishedVehicles({
            market: market.data,
            makeId: vehicle.make.id,
            modelId: vehicle.model.id,
            limit: 12,
            sort: 'newest',
            featureIds: []
        });
        response.json({
            data: result.data.filter((item) => item.referenceNo !== referenceNo.data),
            meta: { requestId: getRequestContext()?.requestId }
        });
    });
    router.get('/vehicles/:referenceNo', async (request, response) => {
        const market = z.string().trim().min(1).max(100).safeParse(request.query.market);
        if (!market.success)
            throw validationError('market is required.');
        const referenceNo = z
            .string()
            .trim()
            .regex(/^GW-\d+$/)
            .safeParse(request.params.referenceNo);
        if (!referenceNo.success)
            throw validationError('referenceNo must use the GW-<number> format.');
        const vehicle = await service.getPublishedVehicle(referenceNo.data, market.data);
        response
            .status(200)
            .json({ data: vehicle, meta: { requestId: getRequestContext()?.requestId } });
    });
    return router;
}
//# sourceMappingURL=public-routes.js.map