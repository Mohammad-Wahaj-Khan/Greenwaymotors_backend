import { sql, type Kysely } from 'kysely';
import { notFoundError } from '../../core/errors/app-error.js';
import { validationError } from '../../core/errors/http-errors.js';
import type { DB } from '../../generated/database.types.js';

type Sort = 'newest' | 'oldest' | 'year_desc' | 'year_asc' | 'mileage_asc' | 'mileage_desc';

export interface VehicleListFilters {
  market: string;
  q?: string | undefined;
  makeId?: number | undefined;
  modelId?: number | undefined;
  bodyTypeId?: number | undefined;
  condition?: 'new' | 'used' | undefined;
  yearMin?: number | undefined;
  yearMax?: number | undefined;
  yearFrom?: number | undefined;
  yearTo?: number | undefined;
  mileageFrom?: number | undefined;
  mileageTo?: number | undefined;
  mileageMax?: number | undefined;
  engineCcFrom?: number | undefined;
  engineCcTo?: number | undefined;
  engineCcMin?: number | undefined;
  engineCcMax?: number | undefined;
  fuel?: string[] | undefined;
  transmission?: string[] | undefined;
  drive?: string[] | undefined;
  steering?: string[] | undefined;
  seats?: number | undefined;
  doors?: number | undefined;
  exteriorColor?: string | undefined;
  interiorColor?: string | undefined;
  stockCountryId?: number | undefined;
  featureIds: number[];
  sort: Sort;
  cursor?: string | undefined;
  limit: number;
}

interface VehicleRow {
  id: string;
  reference_no: string;
  title: string;
  description: string | null;
  condition: string;
  variant: string | null;
  year: number;
  mileage_km: number | null;
  engine_cc: number | null;
  fuel: string | null;
  transmission: string | null;
  drive: string | null;
  steering: string | null;
  seats: number | null;
  doors: number | null;
  exterior_color: string | null;
  interior_color: string | null;
  stock_city: string | null;
  published_at: Date;
  make_id: number;
  make_name: string;
  make_slug: string;
  make_logo_url: string | null;
  model_id: number;
  model_name: string;
  model_slug: string;
  body_type_id: number | null;
  body_type_name: string | null;
  body_type_slug: string | null;
  stock_country_id: number;
  stock_country_iso2: string;
  stock_country_iso3: string;
  stock_country_name: string;
  media_id: string | null;
  media_type: string | null;
  media_url: string | null;
  media_thumb_url: string | null;
  media_sort_order: number | null;
}

interface Cursor {
  sort: Sort;
  value: string | number;
  id: string;
}

function decodeCursor(encoded: string | undefined, sort: Sort): Cursor | undefined {
  if (!encoded) return undefined;
  try {
    const cursor = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Cursor;
    if (!cursor || cursor.sort !== sort || typeof cursor.id !== 'string' || !cursor.id)
      throw new Error();
    if ((sort === 'newest' || sort === 'oldest') && typeof cursor.value !== 'string')
      throw new Error();
    if (
      ['year_desc', 'year_asc', 'mileage_asc', 'mileage_desc'].includes(sort) &&
      typeof cursor.value !== 'number'
    )
      throw new Error();
    return cursor;
  } catch {
    throw validationError('cursor is invalid for the selected sort order.');
  }
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function toPublicVehicle(row: VehicleRow, detail = false) {
  const base = {
    referenceNo: row.reference_no,
    title: row.title,
    condition: row.condition,
    variant: row.variant,
    year: row.year,
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
    stockCity: row.stock_city,
    make: { id: row.make_id, name: row.make_name, slug: row.make_slug, logoUrl: row.make_logo_url },
    model: { id: row.model_id, name: row.model_name, slug: row.model_slug },
    bodyType:
      row.body_type_id === null
        ? null
        : { id: row.body_type_id, name: row.body_type_name, slug: row.body_type_slug },
    stockCountry: {
      id: row.stock_country_id,
      iso2: row.stock_country_iso2,
      iso3: row.stock_country_iso3,
      name: row.stock_country_name
    },
    primaryMedia:
      row.media_id === null
        ? null
        : {
            id: row.media_id,
            type: row.media_type,
            url: row.media_url,
            thumbUrl: row.media_thumb_url,
            sortOrder: row.media_sort_order
          }
  };
  return detail ? { ...base, description: row.description } : base;
}

export class PublicCatalogService {
  constructor(private readonly db: Kysely<DB>) {}

  async listMarkets() {
    const result = await sql<{
      slug: string;
      currency_code: string;
      locale: string;
      iso2: string;
      name: string;
    }>`
      SELECT m.slug, m.currency_code, m.locale, c.iso2, c.name FROM markets m
      JOIN countries c ON c.id = m.country_id WHERE m.status = 'active' AND c.is_active
      ORDER BY c.name`.execute(this.db);
    return result.rows.map((row) => ({
      slug: row.slug,
      currencyCode: row.currency_code,
      locale: row.locale,
      country: { iso2: row.iso2, name: row.name }
    }));
  }

  async getMarket(slug: string) {
    const result = await sql<{
      slug: string;
      currency_code: string;
      locale: string;
      sales_email: string | null;
      sales_phone: string | null;
      sales_whatsapp: string | null;
      seo_title: string | null;
      seo_description: string | null;
      iso2: string;
      name: string;
    }>`
      SELECT m.slug, m.currency_code, m.locale, m.sales_email, m.sales_phone, m.sales_whatsapp,
        m.seo_title, m.seo_description, c.iso2, c.name FROM markets m
      JOIN countries c ON c.id = m.country_id WHERE m.slug = ${slug} AND m.status = 'active' AND c.is_active`.execute(
      this.db
    );
    const market = result.rows[0];
    if (!market) throw notFoundError;
    return {
      slug: market.slug,
      currencyCode: market.currency_code,
      locale: market.locale,
      salesEmail: market.sales_email,
      salesPhone: market.sales_phone,
      salesWhatsapp: market.sales_whatsapp,
      seoTitle: market.seo_title,
      seoDescription: market.seo_description,
      country: { iso2: market.iso2, name: market.name }
    };
  }

  async listCountries(region?: string) {
    let query = this.db
      .selectFrom('countries')
      .select(['id', 'iso2', 'iso3', 'name', 'phone_code', 'region'])
      .where('is_active', '=', true);
    if (region) query = query.where('region', '=', region);
    const rows = await query.orderBy('name').execute();
    return rows.map((row) => ({
      id: row.id,
      iso2: row.iso2,
      iso3: row.iso3,
      name: row.name,
      phoneCode: row.phone_code,
      region: row.region
    }));
  }
  async listMakes() {
    const rows = await this.db
      .selectFrom('makes')
      .select(['id', 'name', 'slug', 'logo_url'])
      .where('is_active', '=', true)
      .orderBy('name')
      .execute();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      logoUrl: row.logo_url
    }));
  }
  async listModels(makeId?: number) {
    let query = this.db
      .selectFrom('models')
      .innerJoin('makes', 'makes.id', 'models.make_id')
      .select(['models.id', 'models.make_id', 'models.name', 'models.slug'])
      .where('models.is_active', '=', true)
      .where('makes.is_active', '=', true);
    if (makeId) query = query.where('models.make_id', '=', makeId);
    const rows = await query.orderBy('models.name').execute();
    return rows.map((row) => ({ id: row.id, makeId: row.make_id, name: row.name, slug: row.slug }));
  }
  async listBodyTypes() {
    return this.db.selectFrom('body_types').selectAll().orderBy('name').execute();
  }
  async listFeatures() {
    return this.db.selectFrom('features').selectAll().orderBy('category').orderBy('name').execute();
  }

  async listPublishedVehicles(filters: VehicleListFilters) {
    const cursor = decodeCursor(filters.cursor, filters.sort);
    const where = [
      sql`v.status = 'published' AND v.published_at IS NOT NULL AND (v.availability_status = 'available' OR (v.availability_status = 'reserved' AND EXISTS (SELECT 1 FROM vehicle_reservations vr WHERE vr.vehicle_id = v.id AND vr.status = 'active' AND vr.expires_at <= now()) AND NOT EXISTS (SELECT 1 FROM vehicle_reservations vr WHERE vr.vehicle_id = v.id AND vr.status = 'active' AND vr.expires_at > now()))) AND v.deleted_at IS NULL`,
      sql`EXISTS (SELECT 1 FROM vehicle_markets vm JOIN markets mk ON mk.id = vm.market_id JOIN countries mc ON mc.id = mk.country_id WHERE vm.vehicle_id = v.id AND vm.is_active AND mk.status = 'active' AND mc.is_active AND mk.slug = ${filters.market} AND (vm.available_from IS NULL OR vm.available_from <= now()) AND (vm.available_until IS NULL OR vm.available_until > now()))`
    ];
    if (filters.q)
      where.push(
        sql`(v.reference_no ILIKE ${`%${filters.q}%`} OR v.title ILIKE ${`%${filters.q}%`} OR COALESCE(v.variant, '') ILIKE ${`%${filters.q}%`})`
      );
    if (filters.makeId) where.push(sql`v.make_id = ${filters.makeId}`);
    if (filters.modelId) where.push(sql`v.model_id = ${filters.modelId}`);
    if (filters.bodyTypeId) where.push(sql`v.body_type_id = ${filters.bodyTypeId}`);
    if (filters.condition) where.push(sql`v.condition = ${filters.condition}`);
    if (filters.yearMin !== undefined) where.push(sql`v.year >= ${filters.yearMin}`);
    if (filters.yearMax !== undefined) where.push(sql`v.year <= ${filters.yearMax}`);
    if (filters.yearFrom !== undefined) where.push(sql`v.year >= ${filters.yearFrom}`);
    if (filters.yearTo !== undefined) where.push(sql`v.year <= ${filters.yearTo}`);
    if (filters.mileageFrom !== undefined) where.push(sql`v.mileage_km >= ${filters.mileageFrom}`);
    if (filters.mileageTo !== undefined) where.push(sql`v.mileage_km <= ${filters.mileageTo}`);
    if (filters.mileageMax !== undefined) where.push(sql`v.mileage_km <= ${filters.mileageMax}`);
    if (filters.engineCcFrom !== undefined) where.push(sql`v.engine_cc >= ${filters.engineCcFrom}`);
    if (filters.engineCcTo !== undefined) where.push(sql`v.engine_cc <= ${filters.engineCcTo}`);
    if (filters.engineCcMin !== undefined) where.push(sql`v.engine_cc >= ${filters.engineCcMin}`);
    if (filters.engineCcMax !== undefined) where.push(sql`v.engine_cc <= ${filters.engineCcMax}`);
    if (filters.fuel?.length) where.push(sql`v.fuel::text IN (${sql.join(filters.fuel)})`);
    if (filters.transmission?.length)
      where.push(sql`v.transmission::text IN (${sql.join(filters.transmission)})`);
    if (filters.drive?.length) where.push(sql`v.drive::text IN (${sql.join(filters.drive)})`);
    if (filters.steering?.length)
      where.push(sql`v.steering::text IN (${sql.join(filters.steering)})`);
    if (filters.seats !== undefined) where.push(sql`v.seats = ${filters.seats}`);
    if (filters.doors !== undefined) where.push(sql`v.doors = ${filters.doors}`);
    if (filters.exteriorColor) where.push(sql`v.exterior_color ILIKE ${filters.exteriorColor}`);
    if (filters.interiorColor) where.push(sql`v.interior_color ILIKE ${filters.interiorColor}`);
    if (filters.stockCountryId) where.push(sql`v.stock_country_id = ${filters.stockCountryId}`);
    if (filters.featureIds.length)
      where.push(
        sql`v.id IN (SELECT vf.vehicle_id FROM vehicle_features vf WHERE vf.feature_id IN (${sql.join(filters.featureIds)}) GROUP BY vf.vehicle_id HAVING COUNT(DISTINCT vf.feature_id) = ${filters.featureIds.length})`
      );
    if (cursor) where.push(this.cursorCondition(cursor));
    const result = await sql<VehicleRow>`
      SELECT v.id, v.reference_no, v.title, v.description, v.condition::text, v.variant, v.year, v.mileage_km, v.engine_cc,
        v.fuel::text, v.transmission::text, v.drive::text, v.steering::text, v.seats, v.doors, v.exterior_color, v.interior_color, v.stock_city, v.published_at,
        m.id AS make_id, m.name AS make_name, m.slug AS make_slug, m.logo_url AS make_logo_url, mo.id AS model_id, mo.name AS model_name, mo.slug AS model_slug,
        bt.id AS body_type_id, bt.name AS body_type_name, bt.slug AS body_type_slug, c.id AS stock_country_id, c.iso2 AS stock_country_iso2, c.iso3 AS stock_country_iso3, c.name AS stock_country_name,
        media.id AS media_id, media.type::text AS media_type, media.url AS media_url, media.thumb_url AS media_thumb_url, media.sort_order AS media_sort_order
      FROM vehicles v JOIN makes m ON m.id = v.make_id JOIN models mo ON mo.id = v.model_id JOIN countries c ON c.id = v.stock_country_id
      LEFT JOIN body_types bt ON bt.id = v.body_type_id
      LEFT JOIN LATERAL (SELECT id, type, url, thumb_url, sort_order FROM vehicle_media WHERE vehicle_id = v.id ORDER BY is_primary DESC, sort_order, created_at LIMIT 1) media ON TRUE
      WHERE ${sql.join(where, sql` AND `)} ORDER BY ${this.ordering(filters.sort)} LIMIT ${filters.limit + 1}`.execute(
      this.db
    );
    const rows = result.rows.slice(0, filters.limit);
    const last = rows.at(-1);
    return {
      data: rows.map((row) => toPublicVehicle(row)),
      meta: {
        limit: filters.limit,
        nextCursor:
          result.rows.length > filters.limit && last
            ? encodeCursor(this.cursorFor(last, filters.sort))
            : null
      }
    };
  }

  async getPublishedVehicle(referenceNo: string, market: string) {
    const result = await sql<VehicleRow>`
      SELECT v.id, v.reference_no, v.title, v.description, v.condition::text, v.variant, v.year, v.mileage_km, v.engine_cc, v.fuel::text, v.transmission::text, v.drive::text, v.steering::text, v.seats, v.doors, v.exterior_color, v.interior_color, v.stock_city, v.published_at,
        m.id AS make_id, m.name AS make_name, m.slug AS make_slug, m.logo_url AS make_logo_url, mo.id AS model_id, mo.name AS model_name, mo.slug AS model_slug, bt.id AS body_type_id, bt.name AS body_type_name, bt.slug AS body_type_slug, c.id AS stock_country_id, c.iso2 AS stock_country_iso2, c.iso3 AS stock_country_iso3, c.name AS stock_country_name,
        media.id AS media_id, media.type::text AS media_type, media.url AS media_url, media.thumb_url AS media_thumb_url, media.sort_order AS media_sort_order
      FROM vehicles v JOIN makes m ON m.id = v.make_id JOIN models mo ON mo.id = v.model_id JOIN countries c ON c.id = v.stock_country_id LEFT JOIN body_types bt ON bt.id = v.body_type_id
      LEFT JOIN LATERAL (SELECT id, type, url, thumb_url, sort_order FROM vehicle_media WHERE vehicle_id = v.id ORDER BY is_primary DESC, sort_order, created_at LIMIT 1) media ON TRUE
      WHERE v.reference_no = ${referenceNo} AND v.status = 'published' AND v.published_at IS NOT NULL AND (v.availability_status = 'available' OR (v.availability_status = 'reserved' AND EXISTS (SELECT 1 FROM vehicle_reservations vr WHERE vr.vehicle_id = v.id AND vr.status = 'active' AND vr.expires_at <= now()) AND NOT EXISTS (SELECT 1 FROM vehicle_reservations vr WHERE vr.vehicle_id = v.id AND vr.status = 'active' AND vr.expires_at > now()))) AND v.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM vehicle_markets vm JOIN markets mk ON mk.id = vm.market_id JOIN countries mc ON mc.id = mk.country_id WHERE vm.vehicle_id = v.id AND vm.is_active AND mk.status = 'active' AND mc.is_active AND mk.slug = ${market} AND (vm.available_from IS NULL OR vm.available_from <= now()) AND (vm.available_until IS NULL OR vm.available_until > now()))`.execute(
      this.db
    );
    const row = result.rows[0];
    if (!row) throw notFoundError;
    const [media, features] = await Promise.all([
      this.db
        .selectFrom('vehicle_media')
        .select(['id', 'type', 'url', 'thumb_url', 'sort_order', 'is_primary'])
        .where('vehicle_id', '=', row.id)
        .orderBy('is_primary', 'desc')
        .orderBy('sort_order')
        .orderBy('created_at')
        .execute(),
      this.db
        .selectFrom('vehicle_features')
        .innerJoin('features', 'features.id', 'vehicle_features.feature_id')
        .select(['features.id', 'features.name', 'features.category'])
        .where('vehicle_features.vehicle_id', '=', row.id)
        .orderBy('features.category')
        .orderBy('features.name')
        .execute()
    ]);
    return {
      ...toPublicVehicle(row, true),
      media: media.map((item) => ({
        id: item.id,
        type: item.type,
        url: item.url,
        thumbUrl: item.thumb_url,
        sortOrder: item.sort_order,
        isPrimary: item.is_primary
      })),
      features: features.map((item) => ({ id: item.id, name: item.name, category: item.category }))
    };
  }

  private ordering(sort: Sort) {
    if (sort === 'oldest') return sql`v.published_at ASC NULLS LAST, v.id ASC`;
    if (sort === 'year_desc') return sql`v.year DESC, v.id DESC`;
    if (sort === 'year_asc') return sql`v.year ASC, v.id ASC`;
    if (sort === 'mileage_asc') return sql`COALESCE(v.mileage_km, 2147483647) ASC, v.id ASC`;
    if (sort === 'mileage_desc') return sql`COALESCE(v.mileage_km, -1) DESC, v.id DESC`;
    return sql`v.published_at DESC NULLS LAST, v.id DESC`;
  }
  private cursorCondition(cursor: Cursor) {
    if (cursor.sort === 'oldest')
      return sql`(v.published_at, v.id) > (${cursor.value}::timestamptz, ${cursor.id}::uuid)`;
    if (cursor.sort === 'year_desc')
      return sql`(v.year, v.id) < (${cursor.value}::smallint, ${cursor.id}::uuid)`;
    if (cursor.sort === 'year_asc')
      return sql`(v.year, v.id) > (${cursor.value}::smallint, ${cursor.id}::uuid)`;
    if (cursor.sort === 'mileage_asc')
      return sql`(COALESCE(v.mileage_km, 2147483647), v.id) > (${cursor.value}::integer, ${cursor.id}::uuid)`;
    if (cursor.sort === 'mileage_desc')
      return sql`(COALESCE(v.mileage_km, -1), v.id) < (${cursor.value}::integer, ${cursor.id}::uuid)`;
    return sql`(v.published_at, v.id) < (${cursor.value}::timestamptz, ${cursor.id}::uuid)`;
  }
  private cursorFor(row: VehicleRow, sort: Sort): Cursor {
    if (sort === 'year_desc') return { sort, value: row.year, id: row.id };
    if (sort === 'year_asc') return { sort, value: row.year, id: row.id };
    if (sort === 'mileage_asc') return { sort, value: row.mileage_km ?? 2147483647, id: row.id };
    if (sort === 'mileage_desc') return { sort, value: row.mileage_km ?? -1, id: row.id };
    return { sort, value: row.published_at.toISOString(), id: row.id };
  }
}
