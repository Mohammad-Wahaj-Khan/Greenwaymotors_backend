import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Kysely, Selectable } from 'kysely';
import type {
  DB,
  QuoteItems,
  QuoteVersionStatus,
  QuoteVersions,
  Deals
} from '../../generated/database.types.js';
import { notFoundError } from '../../core/errors/app-error.js';
import { conflictError, forbiddenError, validationError } from '../../core/errors/http-errors.js';
import {
  parseInput,
  pageQuery,
  sendData,
  sendPage,
  encodePageCursor,
  decodePageCursor
} from '../../core/http/api-response.js';
import { audit, demandLeadUpdate, idempotent, writeActivity } from './commercial-utils.js';

const quoteRefSchema = z.string().regex(/^Q-\d+$/);
const idempotencyKey = z.string().min(8).max(200);
const versionInput = z.strictObject({
  otherInternalCostMinor: z.number().int().safe().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  markupBps: z.number().int().min(0).max(1_000_000).default(0),
  validUntil: z.iso.datetime(),
  terms: z.string().trim().max(8000).nullable().optional(),
  customerNotes: z.string().trim().max(4000).nullable().optional(),
  internalNotes: z.string().trim().max(4000).nullable().optional(),
  items: z
    .array(
      z.strictObject({
        kind: z.enum([
          'freight',
          'inspection',
          'insurance',
          'documentation',
          'service',
          'tax',
          'discount',
          'other'
        ]),
        label: z.string().trim().min(1).max(200),
        quantity: z.number().int().min(1).max(10_000),
        unitAmountMinor: z
          .number()
          .int()
          .safe()
          .min(-Number.MAX_SAFE_INTEGER)
          .max(Number.MAX_SAFE_INTEGER)
      })
    )
    .max(50)
    .default([])
});

function permits(...codes: string[]): RequestHandler {
  return (req, _res, next) =>
    codes.some((code) => req.auth?.permissions.has(code)) ? next() : next(forbiddenError());
}
function has(req: Request, permission: string): boolean {
  return req.auth!.permissions.has(permission);
}
function money(value: string | number | bigint | null): bigint {
  return BigInt(value ?? 0);
}
function moneyOut(value: string | number | bigint | null): string | null {
  return value === null ? null : String(value);
}
function checkedPgBigint(value: bigint): string {
  if (value < -(2n ** 63n) || value > 2n ** 63n - 1n)
    throw validationError('Calculated amount exceeds the supported range.');
  return value.toString();
}
function versionDto(
  row: Selectable<QuoteVersions> & { currency_code: string },
  items: Selectable<QuoteItems>[],
  lifecycle: QuoteVersionStatus | undefined,
  includeCost: boolean,
  source?: {
    companyName: string;
    sourceCode: string | null;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    whatsapp: string | null;
  }
) {
  return {
    versionNo: row.version_no,
    status: lifecycle ?? 'draft',
    vehicle: row.vehicle_snapshot,
    currency: row.currency_code,
    validUntil: row.valid_until,
    customerTotalMinor: String(row.customer_total_minor),
    terms: row.terms_text,
    customerNotes: row.customer_notes,
    items: items
      .filter((item) => item.visibility === 'customer')
      .map((item) => ({
        kind: item.kind,
        label: item.label,
        quantity: item.quantity,
        unitAmountMinor: String(item.unit_amount_minor),
        lineTotalMinor: String(item.line_total_minor)
      })),
    ...(includeCost || source
      ? {
          internal: {
            ...(includeCost
              ? {
                  sourceCostMinor: moneyOut(row.source_cost_minor),
                  logisticsCostMinor: moneyOut(row.shipping_cost_minor),
                  otherCostMinor: moneyOut(row.other_cost_minor),
                  internalTotalCostMinor: moneyOut(row.internal_total_cost_minor),
                  marginMinor: moneyOut(row.estimated_margin_minor),
                  marginBps: row.estimated_margin_bps,
                  notes: row.internal_notes,
                  items: items.filter((item) => item.visibility === 'internal')
                }
              : {}),
            ...(source ? { source } : {})
          }
        }
      : {})
  };
}

async function loadQuote(db: Kysely<DB>, ref: string) {
  const quote = await db
    .selectFrom('quotes')
    .innerJoin('leads', 'leads.id', 'quotes.lead_id')
    .selectAll('quotes')
    .select(['leads.assigned_to', 'leads.status as lead_status'])
    .where('quotes.reference_no', '=', ref)
    .executeTakeFirst();
  if (!quote) throw notFoundError;
  return quote;
}
async function lockQuote(trx: Kysely<DB>, ref: string) {
  const initial = await trx
    .selectFrom('quotes')
    .select(['id', 'lead_id'])
    .where('reference_no', '=', ref)
    .executeTakeFirst();
  if (!initial) throw notFoundError;
  const lead = await trx
    .selectFrom('leads')
    .select(['assigned_to', 'status as lead_status', 'market_id as lead_market_id'])
    .where('id', '=', initial.lead_id)
    .forUpdate()
    .executeTakeFirst();
  if (!lead) throw notFoundError;
  const quote = await trx
    .selectFrom('quotes')
    .selectAll()
    .where('id', '=', initial.id)
    .forUpdate()
    .executeTakeFirst();
  if (!quote) throw notFoundError;
  return { ...quote, ...lead };
}
function assertScope(req: Request, quote: { assigned_to: string | null }) {
  if (
    !has(req, 'quote.read_all') &&
    !(has(req, 'quote.read_assigned') && quote.assigned_to === req.auth!.user.id)
  )
    throw notFoundError;
}
async function loadVersion(
  db: Kysely<DB>,
  quoteId: string,
  versionNo: number,
  includeCost: boolean,
  includeSource: boolean
) {
  const version = await db
    .selectFrom('quote_versions')
    .innerJoin('quotes', 'quotes.id', 'quote_versions.quote_id')
    .selectAll('quote_versions')
    .select(['quotes.currency_code', 'quotes.vehicle_id'])
    .where('quote_versions.quote_id', '=', quoteId)
    .where('quote_versions.version_no', '=', versionNo)
    .executeTakeFirst();
  if (!version) throw notFoundError;
  const items = await db
    .selectFrom('quote_items')
    .selectAll()
    .where('quote_version_id', '=', version.id)
    .orderBy('sort_order')
    .execute();
  const lifecycle = await db
    .selectFrom('quote_version_lifecycle')
    .select('status')
    .where('quote_version_id', '=', version.id)
    .executeTakeFirst();
  const sourceRow = includeSource
    ? await db
        .selectFrom('vehicles')
        .innerJoin('inventory_sources', 'inventory_sources.id', 'vehicles.inventory_source_id')
        .select([
          'inventory_sources.company_name',
          'inventory_sources.source_code',
          'inventory_sources.contact_name',
          'inventory_sources.email',
          'inventory_sources.phone',
          'inventory_sources.whatsapp'
        ])
        .where('vehicles.id', '=', version.vehicle_id)
        .executeTakeFirst()
    : undefined;
  const source = sourceRow
    ? {
        companyName: sourceRow.company_name,
        sourceCode: sourceRow.source_code,
        contactName: sourceRow.contact_name,
        email: sourceRow.email,
        phone: sourceRow.phone,
        whatsapp: sourceRow.whatsapp
      }
    : undefined;
  return versionDto(version, items, lifecycle?.status, includeCost, source);
}

export async function expireActiveReservations(
  trx: Kysely<DB>,
  onlyVehicleId?: string
): Promise<void> {
  let candidates = trx
    .selectFrom('vehicle_reservations')
    .select('vehicle_id')
    .distinct()
    .where('status', '=', 'active')
    .where('expires_at', '<=', new Date())
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('deals')
            .select('id')
            .whereRef('deals.reservation_id', '=', 'vehicle_reservations.id')
            .where('deals.status', '!=', 'cancelled')
        )
      )
    );
  if (onlyVehicleId) candidates = candidates.where('vehicle_id', '=', onlyVehicleId);
  const vehicleIds = await candidates.orderBy('vehicle_id').execute();
  for (const { vehicle_id: vehicleId } of vehicleIds) {
    await trx
      .selectFrom('vehicles')
      .select('id')
      .where('id', '=', vehicleId)
      .forUpdate()
      .executeTakeFirst();
    const expired = await trx
      .updateTable('vehicle_reservations')
      .set({ status: 'expired', released_at: new Date() })
      .where('vehicle_id', '=', vehicleId)
      .where('status', '=', 'active')
      .where('expires_at', '<=', new Date())
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('deals')
              .select('id')
              .whereRef('deals.reservation_id', '=', 'vehicle_reservations.id')
              .where('deals.status', '!=', 'cancelled')
          )
        )
      )
      .returning('id')
      .execute();
    if (expired.length === 0) continue;
    const active = await trx
      .selectFrom('vehicle_reservations')
      .select('id')
      .where('vehicle_id', '=', vehicleId)
      .where('status', '=', 'active')
      .executeTakeFirst();
    if (!active) {
      await trx
        .updateTable('vehicles')
        .set({ availability_status: 'available', reserved_at: null })
        .where('id', '=', vehicleId)
        .where('availability_status', '=', 'reserved')
        .execute();
    }
  }
}

export async function convertAcceptedQuote(
  trx: Kysely<DB>,
  req: Request,
  quoteId: string,
  versionId: string,
  actorId: string
) {
  const relation = await trx
    .selectFrom('quotes')
    .select('lead_id')
    .where('id', '=', quoteId)
    .executeTakeFirst();
  if (!relation) throw notFoundError;
  const lead = await trx
    .selectFrom('leads')
    .selectAll()
    .where('id', '=', relation.lead_id)
    .forUpdate()
    .executeTakeFirst();
  if (!lead) throw notFoundError;
  const quote = await trx
    .selectFrom('quotes')
    .selectAll()
    .where('id', '=', quoteId)
    .forUpdate()
    .executeTakeFirst();
  if (!quote) throw notFoundError;
  demandLeadUpdate(req, lead);
  const existing = await trx
    .selectFrom('deals')
    .selectAll()
    .where('lead_id', '=', lead.id)
    .executeTakeFirst();
  if (existing) {
    if (
      existing.accepted_quote_id === quote.id &&
      existing.accepted_quote_version_id === versionId &&
      quote.status === 'accepted'
    )
      return dealDto(existing, has(req, 'quote.cost.read'));
    throw conflictError('Lead has already been converted using a different quote.');
  }
  const vehicle = await trx
    .selectFrom('vehicles')
    .selectAll()
    .where('id', '=', quote.vehicle_id)
    .forUpdate()
    .executeTakeFirst();
  if (!vehicle) throw notFoundError;
  const version = await trx
    .selectFrom('quote_versions')
    .selectAll()
    .where('id', '=', versionId)
    .where('quote_id', '=', quote.id)
    .executeTakeFirst();
  if (!version || version.version_no !== quote.current_version_no)
    throw conflictError('Only the current quote version can be accepted.');
  const state = await trx
    .selectFrom('quote_version_lifecycle')
    .select('status')
    .where('quote_version_id', '=', version.id)
    .forUpdate()
    .executeTakeFirst();
  if (!state || state.status !== 'sent')
    throw conflictError('Only a sent quote version can be accepted.');
  const now = new Date();
  if (!version.valid_until || version.valid_until <= now)
    throw conflictError('This quote version has expired.');
  if (quote.status === 'cancelled' || quote.status === 'expired' || quote.status === 'accepted')
    throw conflictError('This quote cannot be accepted in its current state.');
  if (
    lead.status === 'won' ||
    lead.status === 'lost' ||
    lead.status === 'cancelled' ||
    lead.status === 'spam'
  )
    throw conflictError('Lead is closed and cannot be converted.');
  if (
    !lead.market_id ||
    !(await trx
      .selectFrom('markets')
      .select('id')
      .where('id', '=', lead.market_id)
      .where('status', '=', 'active')
      .executeTakeFirst())
  )
    throw conflictError('Lead destination market is inactive.');
  if (
    !(await trx
      .selectFrom('vehicle_markets')
      .select('vehicle_id')
      .where('vehicle_id', '=', vehicle.id)
      .where('market_id', '=', lead.market_id)
      .where('is_active', '=', true)
      .executeTakeFirst())
  )
    throw conflictError('Vehicle is no longer eligible for the lead market.');
  if (vehicle.status !== 'published' || vehicle.deleted_at)
    throw conflictError('Vehicle is no longer published.');
  await expireActiveReservations(trx, vehicle.id);
  const active = await trx
    .selectFrom('vehicle_reservations')
    .selectAll()
    .where('vehicle_id', '=', vehicle.id)
    .where('status', '=', 'active')
    .executeTakeFirst();
  if (active && (active.lead_id !== lead.id || (active.quote_id && active.quote_id !== quote.id)))
    throw conflictError('The vehicle is already reserved.');
  if (
    vehicle.availability_status !== 'available' &&
    !(vehicle.availability_status === 'reserved' && active?.lead_id === lead.id)
  )
    throw conflictError('The vehicle is not available for conversion.');
  let reservationId = active?.id;
  if (!reservationId) {
    const reservation = await trx
      .insertInto('vehicle_reservations')
      .values({
        vehicle_id: vehicle.id,
        lead_id: lead.id,
        quote_id: quote.id,
        expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        created_by: actorId
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    reservationId = reservation.id;
  }
  const market = lead.market_id
    ? await trx
        .selectFrom('markets')
        .selectAll()
        .where('id', '=', lead.market_id)
        .executeTakeFirst()
    : undefined;
  const source = vehicle.inventory_source_id
    ? await trx
        .selectFrom('inventory_sources')
        .select(['id', 'company_name', 'source_code'])
        .where('id', '=', vehicle.inventory_source_id)
        .executeTakeFirst()
    : undefined;
  const salesperson = await trx
    .selectFrom('users')
    .select(['id', 'full_name', 'email'])
    .where('id', '=', lead.assigned_to ?? actorId)
    .executeTakeFirst();
  const created = await trx
    .insertInto('deals')
    .values({
      lead_id: lead.id,
      accepted_quote_id: quote.id,
      accepted_quote_version_id: version.id,
      vehicle_id: vehicle.id,
      reservation_id: reservationId,
      customer_id: lead.customer_id,
      market_id: lead.market_id,
      owner_salesperson_id: lead.assigned_to ?? actorId,
      status: 'source_confirming',
      agreed_amount_minor: version.customer_total_minor,
      currency_code: quote.currency_code,
      source_id: vehicle.inventory_source_id,
      source_cost_minor: version.source_cost_minor,
      margin_minor: version.estimated_margin_minor,
      commercial_terms: version.terms_text,
      customer_snapshot: {
        name: lead.contact_name,
        email: lead.contact_email,
        phone: lead.contact_phone
      },
      market_snapshot: market
        ? { slug: market.slug, currency: market.currency_code, locale: market.locale }
        : null,
      salesperson_snapshot: salesperson
        ? { id: salesperson.id, name: salesperson.full_name, email: salesperson.email }
        : null,
      vehicle_snapshot: version.vehicle_snapshot,
      source_snapshot: source
        ? {
            id: source.id,
            companyName: source.company_name,
            sourceCode: source.source_code,
            costMinor: String(version.source_cost_minor ?? 0)
          }
        : null
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await trx
    .updateTable('quote_version_lifecycle')
    .set({ status: 'accepted', changed_by: actorId, changed_at: now })
    .where('quote_version_id', '=', version.id)
    .execute();
  await trx
    .updateTable('quotes')
    .set({ status: 'accepted', accepted_at: now })
    .where('id', '=', quote.id)
    .execute();
  await trx
    .updateTable('leads')
    .set({ status: 'won', closed_at: now })
    .where('id', '=', lead.id)
    .execute();
  await trx
    .updateTable('vehicles')
    .set({ availability_status: 'reserved', reserved_at: active?.created_at ?? now })
    .where('id', '=', vehicle.id)
    .execute();
  await writeActivity(trx, lead.id, actorId, 'status_changed', 'Accepted quote converted to deal', {
    quoteId: quote.id,
    versionNo: version.version_no,
    dealId: created.id
  });
  await audit(trx, actorId, 'quote.accepted', 'quote', quote.id, {
    versionNo: version.version_no,
    dealId: created.id
  });
  await audit(trx, actorId, 'deal.created', 'deal', created.id, {
    quoteId: quote.id,
    versionNo: version.version_no,
    reservationId
  });
  return dealDto(created, has(req, 'quote.cost.read'));
}

export function dealDto(row: Selectable<Deals>, includeCost = false) {
  return {
    id: row.id,
    referenceNo: row.reference_no,
    leadId: row.lead_id,
    quoteId: row.accepted_quote_id,
    quoteVersionId: row.accepted_quote_version_id,
    vehicleId: row.vehicle_id,
    reservationId: row.reservation_id,
    status: row.status,
    amountMinor: String(row.agreed_amount_minor),
    currency: row.currency_code,
    marketId: row.market_id,
    ownerSalespersonId: row.owner_salesperson_id,
    ...(includeCost
      ? {
          sourceCostMinor: row.source_cost_minor == null ? null : String(row.source_cost_minor),
          marginMinor: row.margin_minor == null ? null : String(row.margin_minor)
        }
      : {}),
    completedAt: row.completed_at,
    createdAt: row.created_at
  };
}

export function createQuoteRouter(db: Kysely<DB>): Router {
  const router = Router();
  router.get('/quotes', permits('quote.read_all', 'quote.read_assigned'), async (req, res) => {
    const input = parseInput(
      pageQuery.extend({
        status: z
          .enum(['draft', 'sent', 'accepted', 'rejected', 'expired', 'superseded', 'cancelled'])
          .optional(),
        leadReference: z
          .string()
          .regex(/^LEAD-\d+$/)
          .optional()
      }),
      req.query
    );
    const cursor = decodePageCursor(input.cursor);
    let query = db
      .selectFrom('quotes')
      .innerJoin('leads', 'leads.id', 'quotes.lead_id')
      .select([
        'quotes.id',
        'quotes.reference_no',
        'quotes.status',
        'quotes.current_version_no',
        'quotes.currency_code',
        'quotes.created_at',
        'quotes.valid_until',
        'leads.reference_no as lead_reference',
        'leads.assigned_to'
      ]);
    if (!has(req, 'quote.read_all'))
      query = query.where('leads.assigned_to', '=', req.auth!.user.id);
    if (input.status) query = query.where('quotes.status', '=', input.status);
    if (input.leadReference) query = query.where('leads.reference_no', '=', input.leadReference);
    if (input.q)
      query = query.where((eb) =>
        eb.or([
          eb('quotes.reference_no', 'ilike', `%${input.q}%`),
          eb('leads.reference_no', 'ilike', `%${input.q}%`)
        ])
      );
    if (cursor)
      query = query.where((eb) =>
        eb.or([
          eb('quotes.created_at', '<', cursor.createdAt),
          eb.and([eb('quotes.created_at', '=', cursor.createdAt), eb('quotes.id', '<', cursor.id)])
        ])
      );
    const rows = await query
      .orderBy('quotes.created_at', 'desc')
      .orderBy('quotes.id', 'desc')
      .limit(input.limit + 1)
      .execute();
    const list = rows.slice(0, input.limit);
    sendPage(
      res,
      list.map((q) => ({
        referenceNo: q.reference_no,
        status: q.status,
        currentVersionNo: q.current_version_no,
        currency: q.currency_code,
        leadReferenceNo: q.lead_reference,
        validUntil: q.valid_until,
        createdAt: q.created_at
      })),
      input.limit,
      rows.length > input.limit && list.at(-1) ? encodePageCursor(list.at(-1)!) : null
    );
  });
  router.post('/leads/:referenceNo/quotes', permits('quote.create'), async (req, res) => {
    const ref = parseInput(z.string().regex(/^LEAD-\d+$/), req.params.referenceNo);
    const body = parseInput(
      z.strictObject({
        currency: z
          .string()
          .regex(/^[A-Z]{3}$/)
          .optional()
      }),
      req.body
    );
    const created = await db.transaction().execute(async (trx) => {
      const lead = await trx
        .selectFrom('leads')
        .selectAll()
        .where('reference_no', '=', ref)
        .forUpdate()
        .executeTakeFirst();
      if (!lead) throw notFoundError;
      demandLeadUpdate(req, lead);
      if (
        !lead.market_id ||
        !['qualified', 'quote_preparing', 'quote_sent', 'negotiating'].includes(lead.status)
      )
        throw conflictError('Lead must be qualified before quote preparation.');
      const vehicle = await trx
        .selectFrom('vehicles')
        .select([
          'id',
          'availability_status',
          'title',
          'year',
          'reference_no',
          'make_id',
          'model_id',
          'inventory_source_id',
          'purchase_cost_currency',
          'status',
          'deleted_at'
        ])
        .where('id', '=', lead.vehicle_id)
        .executeTakeFirst();
      if (!vehicle || vehicle.availability_status !== 'available')
        throw conflictError('Lead vehicle is not available.');
      if (vehicle.status !== 'published' || vehicle.deleted_at)
        throw conflictError('Only published vehicles can be quoted.');
      if (
        !(await trx
          .selectFrom('vehicle_markets')
          .select('vehicle_id')
          .where('vehicle_id', '=', vehicle.id)
          .where('market_id', '=', lead.market_id)
          .where('is_active', '=', true)
          .executeTakeFirst())
      )
        throw conflictError('Vehicle is not eligible for the lead market.');
      const market = await trx
        .selectFrom('markets')
        .select('currency_code')
        .where('id', '=', lead.market_id)
        .where('status', '=', 'active')
        .executeTakeFirst();
      if (!market) throw conflictError('Lead destination market is inactive.');
      if (body.currency && body.currency !== market.currency_code)
        throw conflictError(
          'Quotes must use the active market currency; currency conversion is not configured.'
        );
      if (vehicle.purchase_cost_currency && vehicle.purchase_cost_currency !== market.currency_code)
        throw conflictError(
          'Vehicle source cost currency must match the active market currency; currency conversion is not configured.'
        );
      const quote = await trx
        .insertInto('quotes')
        .values({
          lead_id: lead.id,
          vehicle_id: lead.vehicle_id,
          currency_code: body.currency ?? market.currency_code,
          created_by: req.auth!.user.id
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      if (lead.status === 'qualified')
        await trx
          .updateTable('leads')
          .set({ status: 'quote_preparing' })
          .where('id', '=', lead.id)
          .execute();
      await writeActivity(
        trx,
        lead.id,
        req.auth!.user.id,
        'status_changed',
        'Quote preparation started',
        { quoteId: quote.id }
      );
      await audit(trx, req.auth!.user.id, 'quote.created', 'quote', quote.id, { leadId: lead.id });
      return {
        referenceNo: quote.reference_no,
        status: quote.status,
        leadReferenceNo: ref,
        currency: quote.currency_code,
        currentVersionNo: 0
      };
    });
    sendData(res, created, 201);
  });
  router.get(
    '/quotes/:quoteRef',
    permits('quote.read_all', 'quote.read_assigned'),
    async (req, res) => {
      const quote = await loadQuote(db, parseInput(quoteRefSchema, req.params.quoteRef));
      assertScope(req, quote);
      const version = quote.current_version_no
        ? await loadVersion(
            db,
            quote.id,
            quote.current_version_no,
            has(req, 'quote.cost.read'),
            has(req, 'inventory_source.read')
          )
        : null;
      sendData(res, {
        referenceNo: quote.reference_no,
        status: quote.status,
        leadId: quote.lead_id,
        vehicleId: quote.vehicle_id,
        currency: quote.currency_code,
        currentVersionNo: quote.current_version_no,
        validUntil: quote.valid_until,
        sentAt: quote.sent_at,
        acceptedAt: quote.accepted_at,
        currentVersion: version
      });
    }
  );
  router.patch('/quotes/:quoteRef', permits('quote.update'), async (req, res) => {
    const quote = await loadQuote(db, parseInput(quoteRefSchema, req.params.quoteRef));
    assertScope(req, quote);
    demandLeadUpdate(req, { assigned_to: quote.assigned_to });
    const body = parseInput(
      z.strictObject({ validUntil: z.iso.datetime().nullable().optional() }),
      req.body
    );
    if (quote.status !== 'draft') throw conflictError('Only draft quote metadata can be edited.');
    const row = await db
      .updateTable('quotes')
      .set({
        valid_until:
          body.validUntil === undefined
            ? quote.valid_until
            : body.validUntil === null
              ? null
              : new Date(body.validUntil)
      })
      .where('id', '=', quote.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit(db, req.auth!.user.id, 'quote.updated', 'quote', quote.id, {
      validUntil: row.valid_until?.toISOString() ?? null
    });
    sendData(res, {
      referenceNo: row.reference_no,
      status: row.status,
      validUntil: row.valid_until
    });
  });
  router.post('/quotes/:quoteRef/versions', permits('quote.update'), async (req, res) => {
    const ref = parseInput(quoteRefSchema, req.params.quoteRef),
      input = parseInput(versionInput, req.body);
    const result = await db.transaction().execute(async (trx) => {
      const quote = await lockQuote(trx, ref);
      assertScope(req, quote);
      demandLeadUpdate(req, { assigned_to: quote.assigned_to });
      if (['accepted', 'cancelled', 'expired'].includes(quote.status))
        throw conflictError('This quote cannot be revised.');
      if (input.otherInternalCostMinor > 0 && !has(req, 'quote.cost.input'))
        throw forbiddenError('Submitting additional internal cost requires quote.cost.input.');
      if (new Date(input.validUntil) <= new Date())
        throw validationError('validUntil must be in the future.');
      const vehicle = await trx
        .selectFrom('vehicles')
        .select([
          'id',
          'reference_no',
          'title',
          'year',
          'make_id',
          'model_id',
          'inventory_source_id',
          'purchase_cost_minor',
          'purchase_cost_currency',
          'estimated_local_cost_minor',
          'availability_status',
          'status',
          'deleted_at'
        ])
        .where('id', '=', quote.vehicle_id)
        .forUpdate()
        .executeTakeFirst();
      if (!vehicle) throw notFoundError;
      if (vehicle.availability_status === 'sold')
        throw conflictError('Sold vehicles cannot be quoted.');
      if (vehicle.purchase_cost_currency && vehicle.purchase_cost_currency !== quote.currency_code)
        throw conflictError(
          'Vehicle cost currency does not match the quote currency. Configure an approved currency conversion before quoting.'
        );
      if (vehicle.status !== 'published' || vehicle.deleted_at)
        throw conflictError('Only published vehicles can be quoted.');
      if (
        !quote.lead_market_id ||
        !(await trx
          .selectFrom('vehicle_markets')
          .select('vehicle_id')
          .where('vehicle_id', '=', vehicle.id)
          .where('market_id', '=', quote.lead_market_id)
          .where('is_active', '=', true)
          .executeTakeFirst())
      )
        throw conflictError('Vehicle is not eligible for the lead market.');
      const sourceCost = money(vehicle.purchase_cost_minor),
        logistics = money(vehicle.estimated_local_cost_minor),
        other = BigInt(input.otherInternalCostMinor);
      const internal = sourceCost + logistics + other;
      const markup = (internal * BigInt(input.markupBps)) / 10000n;
      let customerCharges = 0n;
      for (const item of input.items)
        customerCharges += BigInt(item.unitAmountMinor) * BigInt(item.quantity);
      const customerTotal = internal + markup + customerCharges;
      if (customerTotal < 0n)
        throw validationError('Calculated customer total cannot be negative.');
      const margin = customerTotal - internal;
      const calculatedBps = internal === 0n ? null : (margin * 10000n) / internal;
      if (
        calculatedBps !== null &&
        (calculatedBps < -(2n ** 31n) || calculatedBps > 2n ** 31n - 1n)
      )
        throw validationError('Calculated margin rate exceeds the supported range.');
      const marginBps = calculatedBps === null ? null : Number(calculatedBps);
      const versionNo = quote.current_version_no + 1;
      const snapshot = {
        referenceNo: vehicle.reference_no,
        title: vehicle.title,
        year: vehicle.year,
        makeId: vehicle.make_id,
        modelId: vehicle.model_id
      };
      const version = await trx
        .insertInto('quote_versions')
        .values({
          quote_id: quote.id,
          version_no: versionNo,
          vehicle_snapshot: snapshot,
          source_cost_minor: checkedPgBigint(sourceCost),
          shipping_cost_minor: checkedPgBigint(logistics),
          other_cost_minor: checkedPgBigint(other),
          internal_total_cost_minor: checkedPgBigint(internal),
          customer_total_minor: checkedPgBigint(customerTotal),
          estimated_margin_minor: checkedPgBigint(margin),
          estimated_margin_bps: marginBps,
          terms_text: input.terms ?? null,
          internal_notes: input.internalNotes ?? null,
          customer_notes: input.customerNotes ?? null,
          created_by: req.auth!.user.id,
          valid_until: new Date(input.validUntil)
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const rows = [
        {
          quote_version_id: version.id,
          kind: 'vehicle' as const,
          label: 'Vehicle',
          quantity: 1,
          unit_amount_minor: checkedPgBigint(internal + markup),
          line_total_minor: checkedPgBigint(internal + markup),
          visibility: 'customer' as const,
          sort_order: 0
        },
        ...input.items.map((item, index) => {
          const total = BigInt(item.unitAmountMinor) * BigInt(item.quantity);
          return {
            quote_version_id: version.id,
            kind: item.kind,
            label: item.label,
            quantity: item.quantity,
            unit_amount_minor: checkedPgBigint(BigInt(item.unitAmountMinor)),
            line_total_minor: checkedPgBigint(total),
            visibility: 'customer' as const,
            sort_order: index + 1
          };
        })
      ];
      await trx.insertInto('quote_items').values(rows).execute();
      await trx
        .insertInto('quote_version_lifecycle')
        .values({ quote_version_id: version.id, status: 'draft', changed_by: req.auth!.user.id })
        .execute();
      await trx
        .updateTable('quotes')
        .set({
          current_version_no: versionNo,
          status: 'draft',
          valid_until: new Date(input.validUntil)
        })
        .where('id', '=', quote.id)
        .execute();
      if (versionNo > 1)
        await trx
          .updateTable('leads')
          .set({ status: 'negotiating' })
          .where('id', '=', quote.lead_id)
          .where('status', '=', 'quote_sent')
          .execute();
      await writeActivity(
        trx,
        quote.lead_id,
        req.auth!.user.id,
        'note',
        `Quote version ${versionNo} prepared`,
        { quoteReference: ref, versionNo }
      );
      await audit(trx, req.auth!.user.id, 'quote.version.created', 'quote', quote.id, {
        versionNo,
        customerTotalMinor: checkedPgBigint(customerTotal)
      });
      const items = await trx
        .selectFrom('quote_items')
        .selectAll()
        .where('quote_version_id', '=', version.id)
        .orderBy('sort_order')
        .execute();
      const sourceRow =
        has(req, 'inventory_source.read') && vehicle.inventory_source_id
          ? await trx
              .selectFrom('inventory_sources')
              .select(['company_name', 'source_code', 'contact_name', 'email', 'phone', 'whatsapp'])
              .where('id', '=', vehicle.inventory_source_id)
              .executeTakeFirst()
          : undefined;
      const sourceInfo = sourceRow
        ? {
            companyName: sourceRow.company_name,
            sourceCode: sourceRow.source_code,
            contactName: sourceRow.contact_name,
            email: sourceRow.email,
            phone: sourceRow.phone,
            whatsapp: sourceRow.whatsapp
          }
        : undefined;
      return {
        quoteReference: ref,
        ...versionDto(
          { ...version, currency_code: quote.currency_code },
          items,
          'draft',
          has(req, 'quote.cost.read'),
          sourceInfo
        )
      };
    });
    sendData(res, result, 201);
  });
  router.get(
    '/quotes/:quoteRef/versions',
    permits('quote.read_all', 'quote.read_assigned'),
    async (req, res) => {
      const quote = await loadQuote(db, parseInput(quoteRefSchema, req.params.quoteRef));
      assertScope(req, quote);
      const versions = await db
        .selectFrom('quote_versions')
        .leftJoin(
          'quote_version_lifecycle',
          'quote_version_lifecycle.quote_version_id',
          'quote_versions.id'
        )
        .select([
          'quote_versions.id',
          'quote_versions.version_no',
          'quote_versions.customer_total_minor',
          'quote_versions.valid_until',
          'quote_version_lifecycle.status'
        ])
        .where('quote_versions.quote_id', '=', quote.id)
        .orderBy('quote_versions.version_no')
        .execute();
      sendData(
        res,
        versions.map((v) => ({
          versionNo: v.version_no,
          status: v.status,
          customerTotalMinor: String(v.customer_total_minor),
          validUntil: v.valid_until
        }))
      );
    }
  );
  router.get(
    '/quotes/:quoteRef/versions/:versionNo',
    permits('quote.read_all', 'quote.read_assigned'),
    async (req, res) => {
      const quote = await loadQuote(db, parseInput(quoteRefSchema, req.params.quoteRef));
      assertScope(req, quote);
      const no = parseInput(z.coerce.number().int().positive(), req.params.versionNo);
      sendData(
        res,
        await loadVersion(
          db,
          quote.id,
          no,
          has(req, 'quote.cost.read'),
          has(req, 'inventory_source.read')
        )
      );
    }
  );
  router.post('/quotes/:quoteRef/send', permits('quote.send'), async (req, res) => {
    const ref = parseInput(quoteRefSchema, req.params.quoteRef),
      key = parseInput(idempotencyKey, req.header('Idempotency-Key'));
    const result = await db.transaction().execute(async (trx) =>
      idempotent(trx, `quote.send:${ref}`, key, { ref }, async () => {
        const quote = await lockQuote(trx, ref);
        assertScope(req, quote);
        demandLeadUpdate(req, { assigned_to: quote.assigned_to });
        if (quote.status === 'sent' && quote.current_version_no)
          return {
            referenceNo: ref,
            status: 'sent',
            versionNo: quote.current_version_no,
            sentAt: quote.sent_at
          };
        if (!['draft', 'rejected'].includes(quote.status) || !quote.current_version_no)
          throw conflictError('Quote must have a draft version before it can be sent.');
        const version = await trx
          .selectFrom('quote_versions')
          .selectAll()
          .where('quote_id', '=', quote.id)
          .where('version_no', '=', quote.current_version_no)
          .forUpdate()
          .executeTakeFirst();
        if (!version) throw conflictError('Current quote version is missing.');
        const now = new Date();
        if (!version.valid_until || version.valid_until <= now)
          throw conflictError('Quote validity must be in the future.');
        await trx
          .updateTable('quote_version_lifecycle')
          .set({ status: 'superseded', changed_by: req.auth!.user.id, changed_at: now })
          .where(
            'quote_version_id',
            'in',
            trx
              .selectFrom('quote_versions')
              .innerJoin(
                'quote_version_lifecycle',
                'quote_version_lifecycle.quote_version_id',
                'quote_versions.id'
              )
              .select('quote_versions.id')
              .where('quote_versions.quote_id', '=', quote.id)
              .where('quote_versions.version_no', '<', quote.current_version_no)
              .where('quote_version_lifecycle.status', '=', 'sent')
          )
          .execute();
        await trx
          .updateTable('quote_version_lifecycle')
          .set({ status: 'sent', changed_by: req.auth!.user.id, changed_at: now })
          .where('quote_version_id', '=', version.id)
          .execute();
        await trx
          .updateTable('quotes')
          .set({ status: 'sent', sent_at: now, sent_by: req.auth!.user.id })
          .where('id', '=', quote.id)
          .execute();
        const toStatus = quote.current_version_no > 1 ? 'negotiating' : 'quote_sent';
        await trx
          .updateTable('leads')
          .set({ status: toStatus })
          .where('id', '=', quote.lead_id)
          .where('status', 'in', ['quote_preparing', 'quote_sent', 'negotiating'])
          .execute();
        await writeActivity(
          trx,
          quote.lead_id,
          req.auth!.user.id,
          'status_changed',
          `Quote version ${quote.current_version_no} recorded as sent`,
          { quoteReference: ref, versionNo: quote.current_version_no }
        );
        await audit(trx, req.auth!.user.id, 'quote.sent', 'quote', quote.id, {
          versionNo: quote.current_version_no
        });
        return {
          referenceNo: ref,
          status: 'sent',
          versionNo: quote.current_version_no,
          sentAt: now.toISOString()
        };
      })
    );
    sendData(res, result);
  });
  router.post('/quotes/:quoteRef/accept', permits('quote.accept'), async (req, res) => {
    const ref = parseInput(quoteRefSchema, req.params.quoteRef),
      key = parseInput(idempotencyKey, req.header('Idempotency-Key'));
    const result = await db.transaction().execute(async (trx) =>
      idempotent(trx, `quote.accept:${ref}`, key, { ref }, async () => {
        const quote = await trx
          .selectFrom('quotes')
          .select(['id', 'current_version_no'])
          .where('reference_no', '=', ref)
          .executeTakeFirst();
        if (!quote) throw notFoundError;
        const version = await trx
          .selectFrom('quote_versions')
          .select('id')
          .where('quote_id', '=', quote.id)
          .where('version_no', '=', quote.current_version_no)
          .executeTakeFirst();
        if (!version) throw conflictError('Current quote version is missing.');
        return await convertAcceptedQuote(trx, req, quote.id, version.id, req.auth!.user.id);
      })
    );
    sendData(res, result);
  });
  for (const action of ['reject', 'cancel', 'expire'] as const) {
    router.post(
      `/quotes/:quoteRef/${action}`,
      permits(
        action === 'reject' ? 'quote.reject' : action === 'cancel' ? 'quote.cancel' : 'quote.expire'
      ),
      async (req, res) => {
        const ref = parseInput(quoteRefSchema, req.params.quoteRef);
        const body = parseInput(
          z.strictObject({ reason: z.string().trim().min(1).max(1000).optional() }),
          req.body ?? {}
        );
        const result = await db.transaction().execute(async (trx) => {
          const quote = await lockQuote(trx, ref);
          assertScope(req, quote);
          demandLeadUpdate(req, { assigned_to: quote.assigned_to });
          const target =
            action === 'reject' ? 'rejected' : action === 'cancel' ? 'cancelled' : 'expired';
          if (quote.status === target) return { referenceNo: ref, status: target };
          if (action === 'reject' && quote.status !== 'sent')
            throw conflictError('Only a sent quote can be rejected.');
          if (action === 'cancel' && !['draft', 'sent', 'rejected'].includes(quote.status))
            throw conflictError('This quote cannot be cancelled.');
          if (action === 'expire') {
            const version = await trx
              .selectFrom('quote_versions')
              .select('valid_until')
              .where('quote_id', '=', quote.id)
              .where('version_no', '=', quote.current_version_no)
              .executeTakeFirst();
            if (
              quote.status !== 'sent' ||
              !version?.valid_until ||
              version.valid_until > new Date()
            )
              throw conflictError('Only a sent quote past validity can be expired.');
          }
          const now = new Date();
          await trx
            .updateTable('quotes')
            .set({ status: target })
            .where('id', '=', quote.id)
            .execute();
          if (quote.current_version_no) {
            const currentVersion = await trx
              .selectFrom('quote_versions')
              .select('id')
              .where('quote_id', '=', quote.id)
              .where('version_no', '=', quote.current_version_no)
              .executeTakeFirst();
            if (currentVersion)
              await trx
                .updateTable('quote_version_lifecycle')
                .set({
                  status: target,
                  changed_by: req.auth!.user.id,
                  changed_at: now,
                  reason: body.reason ?? null
                })
                .where('quote_version_id', '=', currentVersion.id)
                .execute();
          }
          if (quote.lead_status === 'quote_sent' && ['reject', 'expire', 'cancel'].includes(action))
            await trx
              .updateTable('leads')
              .set({ status: 'negotiating' })
              .where('id', '=', quote.lead_id)
              .where('status', '=', 'quote_sent')
              .execute();
          if (action === 'cancel' && quote.lead_status === 'quote_preparing') {
            const otherOpenQuote = await trx
              .selectFrom('quotes')
              .select('id')
              .where('lead_id', '=', quote.lead_id)
              .where('id', '!=', quote.id)
              .where('status', 'in', ['draft', 'sent'])
              .executeTakeFirst();
            if (!otherOpenQuote)
              await trx
                .updateTable('leads')
                .set({ status: 'qualified' })
                .where('id', '=', quote.lead_id)
                .where('status', '=', 'quote_preparing')
                .execute();
          }
          const pastVerb =
            action === 'cancel' ? 'cancelled' : action === 'reject' ? 'rejected' : 'expired';
          await writeActivity(trx, quote.lead_id, req.auth!.user.id, 'note', `Quote ${pastVerb}`, {
            quoteReference: ref,
            reason: body.reason ?? null
          });
          await audit(trx, req.auth!.user.id, `quote.${pastVerb}`, 'quote', quote.id, {
            reason: body.reason ?? null
          });
          return { referenceNo: ref, status: target };
        });
        sendData(res, result);
      }
    );
  }
  router.get(
    '/quotes/:quoteRef/preview',
    permits('quote.read_all', 'quote.read_assigned'),
    async (req, res) => {
      const quote = await loadQuote(db, parseInput(quoteRefSchema, req.params.quoteRef));
      assertScope(req, quote);
      const version = await db
        .selectFrom('quote_versions')
        .selectAll()
        .where('quote_id', '=', quote.id)
        .where('version_no', '=', quote.current_version_no)
        .executeTakeFirst();
      if (!version) throw notFoundError;
      const items = await db
        .selectFrom('quote_items')
        .select(['kind', 'label', 'quantity', 'unit_amount_minor', 'line_total_minor'])
        .where('quote_version_id', '=', version.id)
        .where('visibility', '=', 'customer')
        .orderBy('sort_order')
        .execute();
      sendData(res, {
        quoteReference: quote.reference_no,
        versionNo: version.version_no,
        currency: quote.currency_code,
        vehicle: version.vehicle_snapshot,
        items: items.map((i) => ({
          kind: i.kind,
          label: i.label,
          quantity: i.quantity,
          unitAmountMinor: String(i.unit_amount_minor),
          lineTotalMinor: String(i.line_total_minor)
        })),
        totalMinor: String(version.customer_total_minor),
        validUntil: version.valid_until,
        terms: version.terms_text,
        customerNotes: version.customer_notes
      });
    }
  );
  return router;
}
