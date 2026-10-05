import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Kysely, Selectable } from 'kysely';
import type { DB, Deals } from '../../generated/database.types.js';
import { notFoundError } from '../../core/errors/app-error.js';
import { conflictError, forbiddenError, validationError } from '../../core/errors/http-errors.js';
import {
  parseInput,
  pageQuery,
  sendData,
  sendPage,
  encodePageCursor,
  decodePageCursor,
  parseUuid
} from '../../core/http/api-response.js';
import {
  audit,
  canAccessDeal,
  demandLeadUpdate,
  idempotent,
  notifyUser,
  writeActivity
} from './commercial-utils.js';
import { convertAcceptedQuote, dealDto, expireActiveReservations } from './quote.routes.js';

const idempotencyKey = z.string().min(8).max(200);
const leadReference = z.string().regex(/^LEAD-\d+$/);
const dealReference = z.string().regex(/^DEAL-\d+$/);

function permit(...codes: string[]): RequestHandler {
  return (req, _res, next) =>
    codes.some((code) => req.auth?.permissions.has(code)) ? next() : next(forbiddenError());
}
function includeCost(req: Parameters<RequestHandler>[0]): boolean {
  return Boolean(req.auth?.permissions.has('quote.cost.read'));
}
function mapDeal(row: Selectable<Deals>, req: Parameters<RequestHandler>[0]) {
  return dealDto(row, includeCost(req));
}
async function loadDeal(db: Kysely<DB>, ref: string) {
  const deal = await db
    .selectFrom('deals')
    .selectAll()
    .where('reference_no', '=', ref)
    .executeTakeFirst();
  if (!deal) throw notFoundError;
  return deal;
}
function assertDealScope(
  req: Parameters<RequestHandler>[0],
  deal: { owner_salesperson_id: string }
) {
  if (!canAccessDeal(req, deal)) throw notFoundError;
}

export function createDealRouter(db: Kysely<DB>): Router {
  const router = Router();
  router.post(
    '/vehicles/:vehicleId/reservations',
    permit('deal.reserve', 'deal.manage'),
    async (req, res) => {
      const vehicleId = parseUuid(req.params.vehicleId),
        key = parseInput(idempotencyKey, req.header('Idempotency-Key'));
      const input = parseInput(
        z.strictObject({
          leadReferenceNo: leadReference,
          quoteReferenceNo: z
            .string()
            .regex(/^Q-\d+$/)
            .optional(),
          expiresInHours: z.number().int().min(1).max(168).default(24)
        }),
        req.body
      );
      try {
        const result = await db.transaction().execute(async (trx) =>
          idempotent(
            trx,
            `reservation.create:${vehicleId}`,
            key,
            { vehicleId, ...input },
            async () => {
              const lead = await trx
                .selectFrom('leads')
                .selectAll()
                .where('reference_no', '=', input.leadReferenceNo)
                .forUpdate()
                .executeTakeFirst();
              if (!lead) throw notFoundError;
              demandLeadUpdate(req, lead);
              if (lead.vehicle_id !== vehicleId)
                throw validationError('Lead does not refer to this exact vehicle.');
              if (
                !['qualified', 'quote_preparing', 'quote_sent', 'negotiating'].includes(lead.status)
              )
                throw conflictError('Lead is not eligible for a reservation.');
              let quoteId: string | null = null;
              if (input.quoteReferenceNo) {
                const quote = await trx
                  .selectFrom('quotes')
                  .selectAll()
                  .where('reference_no', '=', input.quoteReferenceNo)
                  .forUpdate()
                  .executeTakeFirst();
                if (!quote) throw notFoundError;
                if (quote.lead_id !== lead.id || quote.vehicle_id !== vehicleId)
                  throw validationError('Quote, lead, and vehicle must match.');
                if (!['sent', 'accepted'].includes(quote.status))
                  throw conflictError(
                    'Only a sent or accepted quote can be linked to a reservation.'
                  );
                quoteId = quote.id;
              }
              const vehicle = await trx
                .selectFrom('vehicles')
                .selectAll()
                .where('id', '=', vehicleId)
                .forUpdate()
                .executeTakeFirst();
              if (!vehicle) throw notFoundError;
              await expireActiveReservations(trx);
              const refreshedVehicle = await trx
                .selectFrom('vehicles')
                .select('availability_status')
                .where('id', '=', vehicleId)
                .executeTakeFirstOrThrow();
              const active = await trx
                .selectFrom('vehicle_reservations')
                .selectAll()
                .where('vehicle_id', '=', vehicleId)
                .where('status', '=', 'active')
                .executeTakeFirst();
              if (active)
                throw conflictError('The exact vehicle already has an active reservation.');
              if (refreshedVehicle.availability_status !== 'available')
                throw conflictError('The exact vehicle is not available.');
              const expiry = new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000);
              const row = await trx
                .insertInto('vehicle_reservations')
                .values({
                  vehicle_id: vehicleId,
                  lead_id: lead.id,
                  quote_id: quoteId,
                  expires_at: expiry,
                  created_by: req.auth!.user.id
                })
                .returningAll()
                .executeTakeFirstOrThrow();
              await trx
                .updateTable('vehicles')
                .set({ availability_status: 'reserved', reserved_at: new Date() })
                .where('id', '=', vehicleId)
                .execute();
              await writeActivity(
                trx,
                lead.id,
                req.auth!.user.id,
                'note',
                'Exact vehicle reserved',
                { reservationId: row.id, vehicleId, expiresAt: expiry.toISOString() }
              );
              await audit(trx, req.auth!.user.id, 'reservation.created', 'reservation', row.id, {
                vehicleId,
                leadId: lead.id,
                quoteId
              });
              return {
                id: row.id,
                vehicleId: row.vehicle_id,
                leadId: row.lead_id,
                quoteId: row.quote_id,
                status: row.status,
                expiresAt: expiry.toISOString()
              };
            }
          )
        );
        sendData(res, result, 201);
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === '23505'
        )
          throw conflictError('The exact vehicle already has an active reservation.');
        throw error;
      }
    }
  );
  router.get(
    '/vehicles/:vehicleId/reservation',
    permit('deal.read_all', 'deal.read_assigned', 'deal.manage', 'deal.reserve'),
    async (req, res) => {
      const vehicleId = parseUuid(req.params.vehicleId);
      await db.transaction().execute(async (trx) => expireActiveReservations(trx));
      const row = await db
        .selectFrom('vehicle_reservations')
        .innerJoin('leads', 'leads.id', 'vehicle_reservations.lead_id')
        .select([
          'vehicle_reservations.id',
          'vehicle_reservations.vehicle_id',
          'vehicle_reservations.lead_id',
          'vehicle_reservations.quote_id',
          'vehicle_reservations.status',
          'vehicle_reservations.expires_at',
          'leads.reference_no',
          'leads.assigned_to'
        ])
        .where('vehicle_reservations.vehicle_id', '=', vehicleId)
        .where('vehicle_reservations.status', '=', 'active')
        .executeTakeFirst();
      if (!row) throw notFoundError;
      if (
        !req.auth!.permissions.has('deal.read_all') &&
        !(req.auth!.permissions.has('deal.read_assigned') && row.assigned_to === req.auth!.user.id)
      )
        throw notFoundError;
      sendData(res, {
        id: row.id,
        vehicleId: row.vehicle_id,
        leadReferenceNo: row.reference_no,
        quoteId: row.quote_id,
        status: row.status,
        expiresAt: row.expires_at
      });
    }
  );
  router.post(
    '/reservations/:id/release',
    permit('deal.reserve', 'deal.manage'),
    async (req, res) => {
      const id = parseUuid(req.params.id),
        body = parseInput(z.strictObject({ reason: z.string().trim().min(1).max(1000) }), req.body);
      const row = await db.transaction().execute(async (trx) => {
        const reservationRef = await trx
          .selectFrom('vehicle_reservations')
          .select('vehicle_id')
          .where('id', '=', id)
          .executeTakeFirst();
        if (!reservationRef) throw notFoundError;
        await trx
          .selectFrom('vehicles')
          .select('id')
          .where('id', '=', reservationRef.vehicle_id)
          .forUpdate()
          .executeTakeFirst();
        const reservation = await trx
          .selectFrom('vehicle_reservations')
          .selectAll()
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (!reservation) throw notFoundError;
        const lead = await trx
          .selectFrom('leads')
          .select(['id', 'assigned_to'])
          .where('id', '=', reservation.lead_id)
          .executeTakeFirstOrThrow();
        if (!req.auth!.permissions.has('deal.manage') && lead.assigned_to !== req.auth!.user.id)
          throw notFoundError;
        if (reservation.status !== 'active') return reservation;
        const linkedDeal = await trx
          .selectFrom('deals')
          .select('id')
          .where('reservation_id', '=', id)
          .where('status', '!=', 'cancelled')
          .executeTakeFirst();
        if (linkedDeal)
          throw conflictError('A reservation protecting an active deal cannot be released.');
        const released = await trx
          .updateTable('vehicle_reservations')
          .set({ status: 'released', released_at: new Date() })
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirstOrThrow();
        if (
          !(await trx
            .selectFrom('vehicle_reservations')
            .select('id')
            .where('vehicle_id', '=', reservation.vehicle_id)
            .where('status', '=', 'active')
            .where('id', '!=', id)
            .executeTakeFirst())
        )
          await trx
            .updateTable('vehicles')
            .set({ availability_status: 'available', reserved_at: null })
            .where('id', '=', reservation.vehicle_id)
            .where('availability_status', '=', 'reserved')
            .execute();
        await writeActivity(
          trx,
          reservation.lead_id,
          req.auth!.user.id,
          'note',
          'Vehicle reservation released',
          { reservationId: id, reason: body.reason }
        );
        await audit(trx, req.auth!.user.id, 'reservation.released', 'reservation', id, {
          reason: body.reason
        });
        return released;
      });
      sendData(res, { id: row.id, status: row.status, releasedAt: row.released_at });
    }
  );
  router.post(
    '/reservations/:id/extend',
    permit('deal.reserve', 'deal.manage'),
    async (req, res) => {
      const id = parseUuid(req.params.id),
        body = parseInput(
          z.strictObject({ extendByHours: z.number().int().min(1).max(168) }),
          req.body
        );
      const row = await db.transaction().execute(async (trx) => {
        const reservationRef = await trx
          .selectFrom('vehicle_reservations')
          .select('vehicle_id')
          .where('id', '=', id)
          .executeTakeFirst();
        if (!reservationRef) throw notFoundError;
        await trx
          .selectFrom('vehicles')
          .select('id')
          .where('id', '=', reservationRef.vehicle_id)
          .forUpdate()
          .executeTakeFirst();
        const reservation = await trx
          .selectFrom('vehicle_reservations')
          .selectAll()
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (!reservation) throw notFoundError;
        const lead = await trx
          .selectFrom('leads')
          .select(['id', 'assigned_to'])
          .where('id', '=', reservation.lead_id)
          .executeTakeFirstOrThrow();
        if (!req.auth!.permissions.has('deal.manage') && lead.assigned_to !== req.auth!.user.id)
          throw notFoundError;
        if (reservation.status !== 'active' || reservation.expires_at <= new Date())
          throw conflictError('Only an unexpired active reservation can be extended.');
        const expiry = new Date(
          Math.max(reservation.expires_at.getTime(), Date.now()) + body.extendByHours * 3600000
        );
        if (expiry.getTime() > Date.now() + 14 * 86400000)
          throw validationError('Reservation cannot be extended beyond fourteen days from now.');
        const updated = await trx
          .updateTable('vehicle_reservations')
          .set({ expires_at: expiry })
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirstOrThrow();
        await audit(trx, req.auth!.user.id, 'reservation.extended', 'reservation', id, {
          expiresAt: expiry.toISOString()
        });
        await writeActivity(
          trx,
          lead.id,
          req.auth!.user.id,
          'note',
          'Vehicle reservation extended',
          { reservationId: id, expiresAt: expiry.toISOString() }
        );
        return updated;
      });
      sendData(res, { id: row.id, status: row.status, expiresAt: row.expires_at });
    }
  );

  router.get('/deals', permit('deal.read_all', 'deal.read_assigned'), async (req, res) => {
    const input = parseInput(
      pageQuery.extend({
        status: z
          .enum([
            'won',
            'source_confirming',
            'source_confirmed',
            'awaiting_customer',
            'processing',
            'ready_for_delivery',
            'completed',
            'cancelled'
          ])
          .optional()
      }),
      req.query
    );
    const cursor = decodePageCursor(input.cursor);
    let q = db.selectFrom('deals').selectAll();
    if (!req.auth!.permissions.has('deal.read_all'))
      q = q.where('owner_salesperson_id', '=', req.auth!.user.id);
    if (input.status) q = q.where('status', '=', input.status);
    if (input.q) q = q.where('reference_no', 'ilike', `%${input.q}%`);
    if (cursor)
      q = q.where((eb) =>
        eb.or([
          eb('created_at', '<', cursor.createdAt),
          eb.and([eb('created_at', '=', cursor.createdAt), eb('id', '<', cursor.id)])
        ])
      );
    const rows = await q
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(input.limit + 1)
      .execute();
    const list = rows.slice(0, input.limit);
    sendPage(
      res,
      list.map((d) => mapDeal(d, req)),
      input.limit,
      rows.length > input.limit && list.at(-1) ? encodePageCursor(list.at(-1)!) : null
    );
  });
  router.post(
    '/leads/:referenceNo/deal',
    permit('deal.manage', 'deal.reserve'),
    async (req, res) => {
      const ref = parseInput(leadReference, req.params.referenceNo),
        key = parseInput(idempotencyKey, req.header('Idempotency-Key'));
      const result = await db.transaction().execute(async (trx) =>
        idempotent(trx, `deal.create:${ref}`, key, { ref }, async () => {
          const lead = await trx
            .selectFrom('leads')
            .selectAll()
            .where('reference_no', '=', ref)
            .forUpdate()
            .executeTakeFirst();
          if (!lead) throw notFoundError;
          demandLeadUpdate(req, lead);
          const existing = await trx
            .selectFrom('deals')
            .selectAll()
            .where('lead_id', '=', lead.id)
            .executeTakeFirst();
          if (existing) return mapDeal(existing, req);
          const quote = await trx
            .selectFrom('quotes')
            .selectAll()
            .where('lead_id', '=', lead.id)
            .where('status', '=', 'accepted')
            .executeTakeFirst();
          if (!quote) throw conflictError('Lead has no accepted quote.');
          const version = await trx
            .selectFrom('quote_versions')
            .select('id')
            .where('quote_id', '=', quote.id)
            .where('version_no', '=', quote.current_version_no)
            .executeTakeFirst();
          if (!version) throw conflictError('Accepted quote version is missing.');
          return await convertAcceptedQuote(trx, req, quote.id, version.id, req.auth!.user.id);
        })
      );
      sendData(res, result, 201);
    }
  );
  router.get('/deals/:dealRef', permit('deal.read_all', 'deal.read_assigned'), async (req, res) => {
    const deal = await loadDeal(db, parseInput(dealReference, req.params.dealRef));
    assertDealScope(req, deal);
    sendData(res, {
      ...mapDeal(deal, req),
      sourceConfirmationReference: deal.source_confirmation_reference,
      sourceConfirmedAt: deal.source_confirmed_at,
      internalNotes: includeCost(req) ? deal.internal_notes : undefined,
      customerSnapshot: deal.customer_snapshot,
      marketSnapshot: deal.market_snapshot,
      salespersonSnapshot: deal.salesperson_snapshot,
      vehicleSnapshot: deal.vehicle_snapshot,
      sourceSnapshot: req.auth!.permissions.has('inventory_source.read')
        ? deal.source_snapshot
        : undefined,
      commercialTerms: deal.commercial_terms
    });
  });
  router.patch('/deals/:dealRef', permit('deal.update', 'deal.manage'), async (req, res) => {
    const ref = parseInput(dealReference, req.params.dealRef),
      input = parseInput(
        z.strictObject({
          internalNotes: z.string().trim().max(8000).nullable().optional(),
          sourceConfirmationReference: z.string().trim().max(200).nullable().optional()
        }),
        req.body
      );
    const row = await db.transaction().execute(async (trx) => {
      const deal = await trx
        .selectFrom('deals')
        .selectAll()
        .where('reference_no', '=', ref)
        .forUpdate()
        .executeTakeFirst();
      if (!deal) throw notFoundError;
      assertDealScope(req, deal);
      if (
        !['source_confirming', 'source_confirmed', 'processing', 'ready_for_delivery'].includes(
          deal.status
        )
      )
        throw conflictError('Deal can no longer be edited.');
      const updated = await trx
        .updateTable('deals')
        .set({
          ...(input.internalNotes !== undefined ? { internal_notes: input.internalNotes } : {}),
          ...(input.sourceConfirmationReference !== undefined
            ? { source_confirmation_reference: input.sourceConfirmationReference }
            : {})
        })
        .where('id', '=', deal.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await audit(trx, req.auth!.user.id, 'deal.updated', 'deal', deal.id, {
        sourceConfirmationReference: updated.source_confirmation_reference
      });
      return updated;
    });
    sendData(res, mapDeal(row, req));
  });
  router.patch('/deals/:dealRef/status', permit('deal.update', 'deal.manage'), async (req, res) => {
    const ref = parseInput(dealReference, req.params.dealRef),
      input = parseInput(
        z.strictObject({
          status: z.enum([
            'source_confirming',
            'source_confirmed',
            'processing',
            'ready_for_delivery'
          ]),
          sourceConfirmationReference: z.string().trim().max(200).optional()
        }),
        req.body
      );
    const row = await db.transaction().execute(async (trx) => {
      const d = await trx
        .selectFrom('deals')
        .selectAll()
        .where('reference_no', '=', ref)
        .forUpdate()
        .executeTakeFirst();
      if (!d) throw notFoundError;
      assertDealScope(req, d);
      const next: Record<string, string[]> = {
        source_confirming: ['source_confirmed'],
        source_confirmed: ['processing'],
        processing: ['ready_for_delivery'],
        ready_for_delivery: []
      };
      if (d.status !== input.status && !next[d.status]?.includes(input.status))
        throw conflictError('Invalid deal status transition.');
      if (d.status === 'completed' || d.status === 'cancelled')
        throw conflictError('Closed deal cannot change status.');
      const now = new Date();
      const updated = await trx
        .updateTable('deals')
        .set({
          status: input.status,
          ...(input.sourceConfirmationReference
            ? { source_confirmation_reference: input.sourceConfirmationReference }
            : {}),
          ...(input.status === 'source_confirmed' ? { source_confirmed_at: now } : {})
        })
        .where('id', '=', d.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await audit(trx, req.auth!.user.id, 'deal.status_changed', 'deal', d.id, {
        from: d.status,
        to: input.status
      });
      await writeActivity(
        trx,
        d.lead_id,
        req.auth!.user.id,
        'note',
        `Deal moved to ${input.status}`,
        { dealReference: ref, from: d.status, to: input.status }
      );
      return updated;
    });
    sendData(res, mapDeal(row, req));
  });
  router.post('/deals/:dealRef/cancel', permit('deal.cancel', 'deal.manage'), async (req, res) => {
    const ref = parseInput(dealReference, req.params.dealRef),
      input = parseInput(z.strictObject({ reason: z.string().trim().min(1).max(1000) }), req.body);
    const row = await db.transaction().execute(async (trx) => {
      const d = await trx
        .selectFrom('deals')
        .selectAll()
        .where('reference_no', '=', ref)
        .forUpdate()
        .executeTakeFirst();
      if (!d) throw notFoundError;
      assertDealScope(req, d);
      if (d.status === 'cancelled') return d;
      if (['completed', 'won'].includes(d.status))
        throw conflictError('This deal cannot be cancelled.');
      const now = new Date();
      const updated = await trx
        .updateTable('deals')
        .set({ status: 'cancelled', cancelled_at: now, cancel_reason: input.reason })
        .where('id', '=', d.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      if (d.reservation_id)
        await trx
          .updateTable('vehicle_reservations')
          .set({ status: 'released', released_at: now })
          .where('id', '=', d.reservation_id)
          .where('status', '=', 'active')
          .execute();
      if (
        !(await trx
          .selectFrom('vehicle_reservations')
          .select('id')
          .where('vehicle_id', '=', d.vehicle_id)
          .where('status', '=', 'active')
          .executeTakeFirst())
      )
        await trx
          .updateTable('vehicles')
          .set({ availability_status: 'available', reserved_at: null })
          .where('id', '=', d.vehicle_id)
          .where('availability_status', '=', 'reserved')
          .execute();
      await trx
        .updateTable('leads')
        .set({ status: 'cancelled', closed_at: now })
        .where('id', '=', d.lead_id)
        .where('status', '=', 'won')
        .execute();
      await writeActivity(trx, d.lead_id, req.auth!.user.id, 'note', 'Deal cancelled', {
        dealReference: ref,
        reason: input.reason
      });
      await audit(trx, req.auth!.user.id, 'deal.cancelled', 'deal', d.id, { reason: input.reason });
      await notifyUser(trx, d.owner_salesperson_id, 'deal.cancelled', 'Deal cancelled', {
        dealReferenceNo: d.reference_no
      });
      await notifyUser(trx, d.customer_id, 'deal.cancelled', 'Deal cancelled', {
        dealReferenceNo: d.reference_no
      });
      return updated;
    });
    sendData(res, mapDeal(row, req));
  });
  router.post(
    '/deals/:dealRef/complete',
    permit('deal.complete', 'deal.manage'),
    async (req, res) => {
      const ref = parseInput(dealReference, req.params.dealRef),
        key = parseInput(idempotencyKey, req.header('Idempotency-Key'));
      const result = await db.transaction().execute(async (trx) =>
        idempotent(trx, `deal.complete:${ref}`, key, { ref }, async () => {
          const d = await trx
            .selectFrom('deals')
            .selectAll()
            .where('reference_no', '=', ref)
            .forUpdate()
            .executeTakeFirst();
          if (!d) throw notFoundError;
          assertDealScope(req, d);
          if (d.status === 'completed') return mapDeal(d, req);
          if (d.status !== 'ready_for_delivery')
            throw conflictError('Only a ready-for-delivery deal can be completed.');
          const now = new Date();
          const vehicle = await trx
            .selectFrom('vehicles')
            .select(['id', 'availability_status'])
            .where('id', '=', d.vehicle_id)
            .forUpdate()
            .executeTakeFirst();
          if (!vehicle) throw notFoundError;
          if (vehicle.availability_status === 'sold')
            throw conflictError('Vehicle is already sold.');
          if (vehicle.availability_status !== 'reserved' || !d.reservation_id)
            throw conflictError('Deal no longer has an active exact-vehicle reservation.');
          const reservation = await trx
            .selectFrom('vehicle_reservations')
            .selectAll()
            .where('id', '=', d.reservation_id)
            .forUpdate()
            .executeTakeFirst();
          if (
            !reservation ||
            reservation.status !== 'active' ||
            reservation.expires_at <= now ||
            reservation.vehicle_id !== d.vehicle_id ||
            reservation.lead_id !== d.lead_id
          )
            throw conflictError('Deal reservation is no longer valid.');
          const updated = await trx
            .updateTable('deals')
            .set({ status: 'completed', completed_at: now })
            .where('id', '=', d.id)
            .returningAll()
            .executeTakeFirstOrThrow();
          await trx
            .updateTable('vehicles')
            .set({ status: 'sold', availability_status: 'sold', sold_at: now, reserved_at: null })
            .where('id', '=', d.vehicle_id)
            .execute();
          if (d.reservation_id)
            await trx
              .updateTable('vehicle_reservations')
              .set({ status: 'converted' })
              .where('id', '=', d.reservation_id)
              .execute();
          await writeActivity(
            trx,
            d.lead_id,
            req.auth!.user.id,
            'note',
            'Deal completed and vehicle marked sold',
            { dealReference: ref }
          );
          await audit(trx, req.auth!.user.id, 'deal.completed', 'deal', d.id, {
            vehicleId: d.vehicle_id
          });
          await notifyUser(trx, d.owner_salesperson_id, 'deal.completed', 'Deal completed', {
            dealReferenceNo: d.reference_no
          });
          await notifyUser(trx, d.customer_id, 'deal.completed', 'Deal completed', {
            dealReferenceNo: d.reference_no
          });
          await writeActivity(
            trx,
            d.lead_id,
            req.auth!.user.id,
            'note',
            'Deal completed and vehicle marked sold',
            { dealReference: ref }
          );
          return mapDeal(updated, req);
        })
      );
      sendData(res, result);
    }
  );

  router.get(
    '/deals/:dealRef/tasks',
    permit('deal.read_all', 'deal.read_assigned'),
    async (req, res) => {
      const d = await loadDeal(db, parseInput(dealReference, req.params.dealRef));
      assertDealScope(req, d);
      const tasks = await db
        .selectFrom('fulfillment_tasks')
        .selectAll()
        .where('deal_id', '=', d.id)
        .orderBy('created_at')
        .execute();
      sendData(
        res,
        tasks.map((t) => ({
          id: t.id,
          taskType: t.task_type,
          status: t.status,
          assignedTo: t.assigned_to,
          dueAt: t.due_at,
          notes: t.notes,
          completedAt: t.completed_at,
          createdAt: t.created_at
        }))
      );
    }
  );
  router.post(
    '/deals/:dealRef/tasks',
    permit('deal.task.manage', 'deal.manage'),
    async (req, res) => {
      const ref = parseInput(dealReference, req.params.dealRef),
        input = parseInput(
          z.strictObject({
            taskType: z.string().trim().min(1).max(80),
            assignedTo: z.uuid().nullable().optional(),
            dueAt: z.iso.datetime().nullable().optional(),
            notes: z.string().trim().max(4000).nullable().optional()
          }),
          req.body
        );
      const row = await db.transaction().execute(async (trx) => {
        const d = await trx
          .selectFrom('deals')
          .selectAll()
          .where('reference_no', '=', ref)
          .forUpdate()
          .executeTakeFirst();
        if (!d) throw notFoundError;
        assertDealScope(req, d);
        if (['completed', 'cancelled'].includes(d.status))
          throw conflictError('Closed deals cannot receive tasks.');
        if (input.assignedTo) {
          const user = await trx
            .selectFrom('users')
            .select(['id', 'user_type', 'status'])
            .where('id', '=', input.assignedTo)
            .executeTakeFirst();
          if (!user || user.user_type !== 'staff' || user.status !== 'active')
            throw validationError('Task assignee must be active staff.');
        }
        const task = await trx
          .insertInto('fulfillment_tasks')
          .values({
            deal_id: d.id,
            task_type: input.taskType,
            assigned_to: input.assignedTo ?? null,
            due_at: input.dueAt ? new Date(input.dueAt) : null,
            notes: input.notes ?? null,
            created_by: req.auth!.user.id
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await audit(trx, req.auth!.user.id, 'deal.task.created', 'fulfillment_task', task.id, {
          dealId: d.id,
          taskType: task.task_type
        });
        await writeActivity(trx, d.lead_id, req.auth!.user.id, 'note', 'Fulfillment task created', {
          dealId: d.id,
          taskId: task.id,
          taskType: task.task_type
        });
        return task;
      });
      sendData(
        res,
        {
          id: row.id,
          taskType: row.task_type,
          status: row.status,
          assignedTo: row.assigned_to,
          dueAt: row.due_at,
          notes: row.notes,
          completedAt: row.completed_at
        },
        201
      );
    }
  );
  router.patch('/deal-tasks/:id', permit('deal.task.manage', 'deal.manage'), async (req, res) => {
    const id = parseUuid(req.params.id),
      input = parseInput(
        z
          .strictObject({
            status: z.enum(['open', 'in_progress', 'cancelled']).optional(),
            assignedTo: z.uuid().nullable().optional(),
            dueAt: z.iso.datetime().nullable().optional(),
            notes: z.string().trim().max(4000).nullable().optional()
          })
          .refine((o) => Object.keys(o).length > 0),
        req.body
      );
    const row = await db.transaction().execute(async (trx) => {
      const task = await trx
        .selectFrom('fulfillment_tasks')
        .selectAll()
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!task) throw notFoundError;
      const deal = await trx
        .selectFrom('deals')
        .selectAll()
        .where('id', '=', task.deal_id)
        .executeTakeFirstOrThrow();
      assertDealScope(req, deal);
      if (task.status === 'completed') throw conflictError('Completed task cannot be edited.');
      if (input.assignedTo) {
        const assignee = await trx
          .selectFrom('users')
          .select(['id', 'user_type', 'status'])
          .where('id', '=', input.assignedTo)
          .executeTakeFirst();
        if (!assignee || assignee.user_type !== 'staff' || assignee.status !== 'active')
          throw validationError('Task assignee must be active staff.');
      }
      const updated = await trx
        .updateTable('fulfillment_tasks')
        .set({
          ...(input.status ? { status: input.status } : {}),
          ...(input.assignedTo !== undefined ? { assigned_to: input.assignedTo } : {}),
          ...(input.dueAt !== undefined
            ? { due_at: input.dueAt ? new Date(input.dueAt) : null }
            : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {})
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await audit(trx, req.auth!.user.id, 'deal.task.updated', 'fulfillment_task', id, {
        status: updated.status
      });
      return updated;
    });
    sendData(res, {
      id: row.id,
      taskType: row.task_type,
      status: row.status,
      assignedTo: row.assigned_to,
      dueAt: row.due_at,
      notes: row.notes,
      completedAt: row.completed_at
    });
  });
  router.post(
    '/deal-tasks/:id/complete',
    permit('deal.task.manage', 'deal.manage'),
    async (req, res) => {
      const id = parseUuid(req.params.id);
      const row = await db.transaction().execute(async (trx) => {
        const task = await trx
          .selectFrom('fulfillment_tasks')
          .selectAll()
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (!task) throw notFoundError;
        const deal = await trx
          .selectFrom('deals')
          .selectAll()
          .where('id', '=', task.deal_id)
          .executeTakeFirstOrThrow();
        assertDealScope(req, deal);
        if (task.status === 'completed') return task;
        const updated = await trx
          .updateTable('fulfillment_tasks')
          .set({ status: 'completed', completed_at: new Date() })
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirstOrThrow();
        await audit(trx, req.auth!.user.id, 'deal.task.completed', 'fulfillment_task', id, {
          dealId: deal.id
        });
        await writeActivity(
          trx,
          deal.lead_id,
          req.auth!.user.id,
          'note',
          'Fulfillment task completed',
          { dealId: deal.id, taskId: id }
        );
        return updated;
      });
      sendData(res, { id: row.id, status: row.status, completedAt: row.completed_at });
    }
  );
  return router;
}
