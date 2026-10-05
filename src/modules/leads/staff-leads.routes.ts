import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Kysely, Selectable } from 'kysely';
import type { DB, Leads, LeadStatus } from '../../generated/database.types.js';
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

const reference = z.string().regex(/^LEAD-\d+$/);
const statusSchema = z.strictObject({
  status: z.enum([
    'contacted',
    'qualified',
    'quote_preparing',
    'lost',
    'unresponsive',
    'spam',
    'cancelled'
  ]),
  reason: z.string().trim().min(1).max(1000).optional()
});
const activitySchema = z.strictObject({
  type: z.enum(['note', 'call', 'email', 'whatsapp']),
  body: z.string().trim().min(1).max(5000)
});
const followupSchema = z.strictObject({
  dueAt: z.iso.datetime(),
  note: z.string().trim().max(2000).nullable().optional(),
  assignedTo: z.uuid().optional()
});

function permitAny(...permissions: string[]): RequestHandler {
  return (req, _res, next) => {
    if (!permissions.some((permission) => req.auth?.permissions.has(permission))) {
      next(forbiddenError());
      return;
    }
    next();
  };
}
function canRead(req: Parameters<RequestHandler>[0], lead: Selectable<Leads>) {
  return (
    req.auth!.permissions.has('lead.read_all') ||
    (req.auth!.permissions.has('lead.read_assigned') && lead.assigned_to === req.auth!.user.id)
  );
}
function canUpdate(req: Parameters<RequestHandler>[0], lead: Selectable<Leads>) {
  return (
    req.auth!.permissions.has('lead.update') ||
    (req.auth!.permissions.has('lead.update_assigned') && lead.assigned_to === req.auth!.user.id)
  );
}
function leadDto(row: Selectable<Leads>) {
  return {
    id: row.id,
    referenceNo: row.reference_no,
    status: row.status,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    contactWhatsapp: row.contact_whatsapp,
    preferredContact: row.preferred_contact,
    customerId: row.customer_id,
    customerCountryId: row.customer_country_id,
    destinationCountryId: row.destination_country_id,
    marketId: row.market_id,
    city: row.city,
    destinationPort: row.destination_port,
    message: row.message,
    vehicleId: row.vehicle_id,
    vehicleSnapshot: row.vehicle_snapshot,
    assignedTo: row.assigned_to,
    assignedAt: row.assigned_at,
    qualificationNotes: row.qualification_notes,
    lostReason: row.lost_reason,
    lostReasonCode: row.lost_reason_code,
    possibleDuplicateOf: row.possible_duplicate_of,
    source: row.source,
    utmSource: row.utm_source,
    utmMedium: row.utm_medium,
    utmCampaign: row.utm_campaign,
    firstContactedAt: row.first_contacted_at,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
async function loadLead(db: Kysely<DB>, ref: string) {
  const lead = await db
    .selectFrom('leads')
    .selectAll()
    .where('reference_no', '=', ref)
    .executeTakeFirst();
  if (!lead) throw notFoundError;
  return lead;
}
async function salesAssignee(db: Kysely<DB>, id: string) {
  const user = await db
    .selectFrom('users')
    .select(['id', 'status', 'user_type'])
    .where('id', '=', id)
    .executeTakeFirst();
  if (!user || user.status !== 'active' || user.user_type !== 'staff')
    throw validationError('Assignee must be an active staff user.');
  const role = await db
    .selectFrom('user_roles')
    .innerJoin('roles', 'roles.id', 'user_roles.role_id')
    .select('roles.id')
    .where('user_roles.user_id', '=', id)
    .where('roles.name', 'in', ['sales_agent', 'sales_manager', 'super_admin'])
    .executeTakeFirst();
  if (!role) throw validationError('Assignee must have a sales role.');
}
const transitions: Partial<Record<LeadStatus, readonly LeadStatus[]>> = {
  new: ['contacted', 'lost', 'unresponsive', 'spam', 'cancelled'],
  contacted: ['qualified', 'lost', 'unresponsive', 'spam', 'cancelled'],
  qualified: ['quote_preparing', 'lost', 'unresponsive', 'cancelled'],
  quote_preparing: ['lost', 'unresponsive', 'cancelled']
};

export function createStaffLeadsRouter(db: Kysely<DB>): Router {
  const router = Router();
  router.get('/leads', permitAny('lead.read_all', 'lead.read_assigned'), async (req, res) => {
    const input = parseInput(
      pageQuery.extend({
        status: z
          .enum([
            'new',
            'contacted',
            'qualified',
            'quote_preparing',
            'quote_sent',
            'negotiating',
            'won',
            'lost',
            'spam',
            'unresponsive',
            'cancelled'
          ])
          .optional(),
        assignedTo: z.uuid().optional(),
        unassigned: z
          .enum(['true', 'false'])
          .transform((v) => v === 'true')
          .optional(),
        marketId: z.uuid().optional(),
        vehicleReference: z
          .string()
          .regex(/^GW-\d+$/)
          .optional(),
        destinationCountryId: z.coerce.number().int().positive().optional(),
        customerCountryId: z.coerce.number().int().positive().optional(),
        source: z.string().trim().max(100).optional(),
        utmSource: z.string().trim().max(100).optional(),
        createdFrom: z.iso.datetime().optional(),
        createdTo: z.iso.datetime().optional()
      }),
      req.query
    );
    const cursor = decodePageCursor(input.cursor);
    let query = db.selectFrom('leads').selectAll();
    if (!req.auth!.permissions.has('lead.read_all'))
      query = query.where('assigned_to', '=', req.auth!.user.id);
    if (input.status) query = query.where('status', '=', input.status);
    if (input.assignedTo) query = query.where('assigned_to', '=', input.assignedTo);
    if (input.unassigned) query = query.where('assigned_to', 'is', null);
    if (input.marketId) query = query.where('market_id', '=', input.marketId);
    if (input.destinationCountryId)
      query = query.where('destination_country_id', '=', input.destinationCountryId);
    if (input.customerCountryId)
      query = query.where('customer_country_id', '=', input.customerCountryId);
    if (input.source) query = query.where('source', '=', input.source);
    if (input.utmSource) query = query.where('utm_source', '=', input.utmSource);
    if (input.createdFrom) query = query.where('created_at', '>=', new Date(input.createdFrom));
    if (input.createdTo) query = query.where('created_at', '<=', new Date(input.createdTo));
    if (input.q)
      query = query.where((eb) =>
        eb.or([
          eb('reference_no', 'ilike', `%${input.q}%`),
          eb('contact_name', 'ilike', `%${input.q}%`),
          eb('contact_email', 'ilike', `%${input.q}%`)
        ])
      );
    if (input.vehicleReference)
      query = query.where(
        'vehicle_id',
        'in',
        db.selectFrom('vehicles').select('id').where('reference_no', '=', input.vehicleReference)
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
      data.map(leadDto),
      input.limit,
      rows.length > input.limit && data.at(-1) ? encodePageCursor(data.at(-1)!) : null
    );
  });
  router.get(
    '/leads/:referenceNo',
    permitAny('lead.read_all', 'lead.read_assigned'),
    async (req, res) => {
      const lead = await loadLead(db, parseInput(reference, req.params.referenceNo));
      if (!canRead(req, lead)) throw notFoundError;
      const [activities, followups, market, vehicle] = await Promise.all([
        db
          .selectFrom('lead_activities')
          .select(['id', 'type', 'body', 'meta', 'actor_id', 'created_at'])
          .where('lead_id', '=', lead.id)
          .orderBy('created_at', 'desc')
          .limit(100)
          .execute(),
        db
          .selectFrom('lead_followups')
          .select(['id', 'assigned_to', 'due_at', 'note', 'completed_at', 'created_at'])
          .where('lead_id', '=', lead.id)
          .where('completed_at', 'is', null)
          .orderBy('due_at')
          .execute(),
        lead.market_id
          ? db
              .selectFrom('markets')
              .select(['slug', 'country_id'])
              .where('id', '=', lead.market_id)
              .executeTakeFirst()
          : null,
        db
          .selectFrom('vehicles')
          .select(['reference_no', 'title', 'status', 'availability_status'])
          .where('id', '=', lead.vehicle_id)
          .executeTakeFirst()
      ]);
      sendData(res, {
        ...leadDto(lead),
        market: market ?? null,
        currentVehicle: vehicle ?? null,
        activities: activities.map((a) => ({
          id: a.id,
          type: a.type,
          body: a.body,
          meta: a.meta,
          actorId: a.actor_id,
          createdAt: a.created_at
        })),
        openFollowups: followups.map((f) => ({
          id: f.id,
          assignedTo: f.assigned_to,
          dueAt: f.due_at,
          note: f.note,
          createdAt: f.created_at
        }))
      });
    }
  );
  router.post('/leads/:referenceNo/assign', permitAny('lead.assign'), async (req, res) => {
    const ref = parseInput(reference, req.params.referenceNo);
    const input = parseInput(z.strictObject({ assignedTo: z.uuid() }), req.body);
    await salesAssignee(db, input.assignedTo);
    const result = await db.transaction().execute(async (trx) => {
      const lead = await trx
        .selectFrom('leads')
        .selectAll()
        .where('reference_no', '=', ref)
        .forUpdate()
        .executeTakeFirst();
      if (!lead) throw notFoundError;
      const updated = await trx
        .updateTable('leads')
        .set({ assigned_to: input.assignedTo, assigned_at: new Date() })
        .where('id', '=', lead.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('lead_activities')
        .values({
          lead_id: lead.id,
          actor_id: req.auth!.user.id,
          type: 'assigned',
          meta: { from: lead.assigned_to, to: input.assignedTo }
        })
        .execute();
      await trx
        .insertInto('notifications')
        .values({
          user_id: input.assignedTo,
          type: 'lead.assigned',
          title: 'Lead assigned',
          data: { leadReferenceNo: ref }
        })
        .execute();
      await audit(trx, req.auth!.user.id, 'lead.assign', 'lead', lead.id, {
        assignedTo: input.assignedTo
      });
      return updated;
    });
    sendData(res, leadDto(result));
  });
  router.patch(
    '/leads/:referenceNo/status',
    permitAny('lead.update', 'lead.update_assigned'),
    async (req, res) => {
      const ref = parseInput(reference, req.params.referenceNo);
      const input = parseInput(statusSchema, req.body);
      const result = await db.transaction().execute(async (trx) => {
        const lead = await trx
          .selectFrom('leads')
          .selectAll()
          .where('reference_no', '=', ref)
          .forUpdate()
          .executeTakeFirst();
        if (!lead) throw notFoundError;
        if (!canUpdate(req, lead)) throw notFoundError;
        if (!transitions[lead.status]?.includes(input.status))
          throw conflictError('Invalid lead state transition.');
        if (['lost', 'unresponsive', 'cancelled'].includes(input.status) && !input.reason)
          throw validationError('A reason is required for closure.');
        const updated = await trx
          .updateTable('leads')
          .set({
            status: input.status,
            ...(input.status === 'contacted' && !lead.first_contacted_at
              ? { first_contacted_at: new Date() }
              : {}),
            ...(['lost', 'unresponsive', 'cancelled', 'spam'].includes(input.status)
              ? { closed_at: new Date() }
              : {}),
            ...(input.status === 'lost' ? { lost_reason: input.reason ?? null } : {})
          })
          .where('id', '=', lead.id)
          .returningAll()
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('lead_activities')
          .values({
            lead_id: lead.id,
            actor_id: req.auth!.user.id,
            type: 'status_changed',
            meta: { from: lead.status, to: input.status, reason: input.reason ?? null }
          })
          .execute();
        await audit(trx, req.auth!.user.id, 'lead.status', 'lead', lead.id, {
          from: lead.status,
          to: input.status
        });
        return updated;
      });
      sendData(res, leadDto(result));
    }
  );
  router.patch(
    '/leads/:referenceNo/qualification',
    permitAny('lead.update', 'lead.update_assigned'),
    async (req, res) => {
      const ref = parseInput(reference, req.params.referenceNo);
      const input = parseInput(
        z
          .strictObject({
            qualificationNotes: z.string().trim().max(4000).nullable().optional(),
            customerLanguage: z.string().trim().max(35).nullable().optional(),
            destinationPort: z.string().trim().max(150).nullable().optional(),
            city: z.string().trim().max(100).nullable().optional()
          })
          .refine((v) => Object.keys(v).length > 0),
        req.body
      );
      const updated = await db.transaction().execute(async (trx) => {
        const lead = await trx
          .selectFrom('leads')
          .selectAll()
          .where('reference_no', '=', ref)
          .forUpdate()
          .executeTakeFirst();
        if (!lead) throw notFoundError;
        if (!canUpdate(req, lead)) throw notFoundError;
        const row = await trx
          .updateTable('leads')
          .set({
            ...(input.qualificationNotes !== undefined && {
              qualification_notes: input.qualificationNotes
            }),
            ...(input.customerLanguage !== undefined && {
              customer_language: input.customerLanguage
            }),
            ...(input.destinationPort !== undefined && { destination_port: input.destinationPort }),
            ...(input.city !== undefined && { city: input.city })
          })
          .where('id', '=', lead.id)
          .returningAll()
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('lead_activities')
          .values({
            lead_id: lead.id,
            actor_id: req.auth!.user.id,
            type: 'note',
            body: 'Qualification updated'
          })
          .execute();
        await audit(trx, req.auth!.user.id, 'lead.qualification', 'lead', lead.id);
        return row;
      });
      sendData(res, leadDto(updated));
    }
  );
  router.post(
    '/leads/:referenceNo/mark-lost',
    permitAny('lead.update', 'lead.update_assigned'),
    async (req, res) => {
      const ref = parseInput(reference, req.params.referenceNo);
      const input = parseInput(
        z.strictObject({
          reason: z.string().trim().min(1).max(1000),
          reasonCode: z.string().trim().max(100).optional()
        }),
        req.body
      );
      const updated = await db.transaction().execute(async (trx) => {
        const lead = await trx
          .selectFrom('leads')
          .selectAll()
          .where('reference_no', '=', ref)
          .forUpdate()
          .executeTakeFirst();
        if (!lead) throw notFoundError;
        if (!canUpdate(req, lead)) throw notFoundError;
        if (!transitions[lead.status]?.includes('lost'))
          throw conflictError('Invalid lead state transition.');
        const row = await trx
          .updateTable('leads')
          .set({
            status: 'lost',
            lost_reason: input.reason,
            lost_reason_code: input.reasonCode ?? null,
            closed_at: new Date()
          })
          .where('id', '=', lead.id)
          .returningAll()
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('lead_activities')
          .values({
            lead_id: lead.id,
            actor_id: req.auth!.user.id,
            type: 'status_changed',
            meta: { from: lead.status, to: 'lost', reason: input.reason }
          })
          .execute();
        await audit(trx, req.auth!.user.id, 'lead.lost', 'lead', lead.id, {
          from: lead.status,
          to: 'lost'
        });
        return row;
      });
      sendData(res, leadDto(updated));
    }
  );
  router.post('/leads/:referenceNo/reopen', permitAny('lead.update'), async (req, res) => {
    const ref = parseInput(reference, req.params.referenceNo);
    const updated = await db.transaction().execute(async (trx) => {
      const lead = await trx
        .selectFrom('leads')
        .selectAll()
        .where('reference_no', '=', ref)
        .forUpdate()
        .executeTakeFirst();
      if (!lead) throw notFoundError;
      if (!['lost', 'unresponsive', 'spam', 'cancelled'].includes(lead.status))
        throw conflictError('Only closed leads can be reopened.');
      const row = await trx
        .updateTable('leads')
        .set({ status: 'new', closed_at: null, lost_reason: null, lost_reason_code: null })
        .where('id', '=', lead.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('lead_activities')
        .values({
          lead_id: lead.id,
          actor_id: req.auth!.user.id,
          type: 'status_changed',
          meta: { from: lead.status, to: 'new' }
        })
        .execute();
      await audit(trx, req.auth!.user.id, 'lead.reopen', 'lead', lead.id, {
        from: lead.status,
        to: 'new'
      });
      return row;
    });
    sendData(res, leadDto(updated));
  });
  router.get('/leads/:referenceNo/related', permitAny('lead.read_all'), async (req, res) => {
    const lead = await loadLead(db, parseInput(reference, req.params.referenceNo));
    const rows = await db
      .selectFrom('leads')
      .select(['reference_no', 'vehicle_id', 'status', 'created_at'])
      .where('contact_email', '=', lead.contact_email)
      .where('id', '!=', lead.id)
      .orderBy('created_at', 'desc')
      .limit(25)
      .execute();
    sendData(
      res,
      rows.map((row) => ({
        referenceNo: row.reference_no,
        vehicleId: row.vehicle_id,
        status: row.status,
        createdAt: row.created_at
      }))
    );
  });
  router.get(
    '/leads/:referenceNo/activities',
    permitAny('lead.read_all', 'lead.read_assigned'),
    async (req, res) => {
      const lead = await loadLead(db, parseInput(reference, req.params.referenceNo));
      if (!canRead(req, lead)) throw notFoundError;
      const rows = await db
        .selectFrom('lead_activities')
        .select(['id', 'type', 'body', 'meta', 'actor_id', 'created_at'])
        .where('lead_id', '=', lead.id)
        .orderBy('created_at', 'desc')
        .limit(200)
        .execute();
      sendData(
        res,
        rows.map((row) => ({
          id: row.id,
          type: row.type,
          body: row.body,
          meta: row.meta,
          actorId: row.actor_id,
          createdAt: row.created_at
        }))
      );
    }
  );
  router.post(
    '/leads/:referenceNo/activities',
    permitAny('lead.activity.create'),
    async (req, res) => {
      const lead = await loadLead(db, parseInput(reference, req.params.referenceNo));
      if (!canUpdate(req, lead)) throw notFoundError;
      const input = parseInput(activitySchema, req.body);
      const created = await db
        .insertInto('lead_activities')
        .values({
          lead_id: lead.id,
          actor_id: req.auth!.user.id,
          type: input.type,
          body: input.body
        })
        .returning(['id', 'type', 'body', 'created_at'])
        .executeTakeFirstOrThrow();
      sendData(
        res,
        { id: created.id, type: created.type, body: created.body, createdAt: created.created_at },
        201
      );
    }
  );
  router.post(
    '/leads/:referenceNo/followups',
    permitAny('lead.followup.manage', 'lead.followup.manage_assigned'),
    async (req, res) => {
      const lead = await loadLead(db, parseInput(reference, req.params.referenceNo));
      if (!canUpdate(req, lead)) throw notFoundError;
      const input = parseInput(followupSchema, req.body);
      const assignee = input.assignedTo ?? req.auth!.user.id;
      if (assignee !== req.auth!.user.id && !req.auth!.permissions.has('lead.followup.manage'))
        throw forbiddenError();
      await salesAssignee(db, assignee);
      const created = await db.transaction().execute(async (trx) => {
        const row = await trx
          .insertInto('lead_followups')
          .values({
            lead_id: lead.id,
            assigned_to: assignee,
            due_at: new Date(input.dueAt),
            note: input.note ?? null
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('lead_activities')
          .values({
            lead_id: lead.id,
            actor_id: req.auth!.user.id,
            type: 'note',
            body: 'Follow-up scheduled',
            meta: { followupId: row.id }
          })
          .execute();
        await audit(trx, req.auth!.user.id, 'lead.followup.create', 'lead', lead.id, {
          followupId: row.id
        });
        return row;
      });
      sendData(
        res,
        {
          id: created.id,
          leadReferenceNo: lead.reference_no,
          assignedTo: created.assigned_to,
          dueAt: created.due_at,
          note: created.note,
          completedAt: created.completed_at
        },
        201
      );
    }
  );
  router.get(
    '/followups',
    permitAny('lead.followup.manage', 'lead.followup.manage_assigned'),
    async (req, res) => {
      const input = parseInput(
        pageQuery.extend({
          assignedTo: z.uuid().optional(),
          dueBefore: z.iso.datetime().optional(),
          dueAfter: z.iso.datetime().optional(),
          status: z.enum(['open', 'completed']).default('open')
        }),
        req.query
      );
      const cursor = decodePageCursor(input.cursor);
      let query = db
        .selectFrom('lead_followups')
        .innerJoin('leads', 'leads.id', 'lead_followups.lead_id')
        .select([
          'lead_followups.id',
          'lead_followups.assigned_to',
          'lead_followups.due_at',
          'lead_followups.note',
          'lead_followups.completed_at',
          'lead_followups.created_at',
          'leads.reference_no'
        ]);
      if (!req.auth!.permissions.has('lead.followup.manage'))
        query = query.where('lead_followups.assigned_to', '=', req.auth!.user.id);
      if (input.assignedTo)
        query = query.where('lead_followups.assigned_to', '=', input.assignedTo);
      query =
        input.status === 'open'
          ? query.where('lead_followups.completed_at', 'is', null)
          : query.where('lead_followups.completed_at', 'is not', null);
      if (input.dueBefore)
        query = query.where('lead_followups.due_at', '<=', new Date(input.dueBefore));
      if (input.dueAfter)
        query = query.where('lead_followups.due_at', '>=', new Date(input.dueAfter));
      if (cursor)
        query = query.where((eb) =>
          eb.or([
            eb('lead_followups.created_at', '<', cursor.createdAt),
            eb.and([
              eb('lead_followups.created_at', '=', cursor.createdAt),
              eb('lead_followups.id', '<', cursor.id)
            ])
          ])
        );
      const rows = await query
        .orderBy('lead_followups.created_at', 'desc')
        .orderBy('lead_followups.id', 'desc')
        .limit(input.limit + 1)
        .execute();
      const data = rows.slice(0, input.limit);
      sendPage(
        res,
        data.map((r) => ({
          id: r.id,
          leadReferenceNo: r.reference_no,
          assignedTo: r.assigned_to,
          dueAt: r.due_at,
          note: r.note,
          completedAt: r.completed_at,
          createdAt: r.created_at
        })),
        input.limit,
        rows.length > input.limit && data.at(-1) ? encodePageCursor(data.at(-1)!) : null
      );
    }
  );
  router.post(
    '/followups/:id/complete',
    permitAny('lead.followup.manage', 'lead.followup.manage_assigned'),
    async (req, res) => {
      const id = parseUuid(req.params.id);
      const row = await db.transaction().execute(async (trx) => {
        const current = await trx
          .selectFrom('lead_followups')
          .selectAll()
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (!current) throw notFoundError;
        if (
          !req.auth!.permissions.has('lead.followup.manage') &&
          current.assigned_to !== req.auth!.user.id
        )
          throw notFoundError;
        if (current.completed_at) return current;
        const completed = await trx
          .updateTable('lead_followups')
          .set({ completed_at: new Date() })
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('lead_activities')
          .values({
            lead_id: current.lead_id,
            actor_id: req.auth!.user.id,
            type: 'note',
            body: 'Follow-up completed',
            meta: { followupId: id }
          })
          .execute();
        await audit(trx, req.auth!.user.id, 'lead.followup.complete', 'lead', current.lead_id, {
          followupId: id
        });
        return completed;
      });
      sendData(res, { id: row.id, completedAt: row.completed_at });
    }
  );
  router.patch(
    '/followups/:id',
    permitAny('lead.followup.manage', 'lead.followup.manage_assigned'),
    async (req, res) => {
      const id = parseUuid(req.params.id);
      const input = parseInput(
        z
          .strictObject({
            dueAt: z.iso.datetime().optional(),
            note: z.string().trim().max(2000).nullable().optional(),
            assignedTo: z.uuid().optional()
          })
          .refine((v) => Object.keys(v).length > 0),
        req.body
      );
      if (
        input.assignedTo &&
        input.assignedTo !== req.auth!.user.id &&
        !req.auth!.permissions.has('lead.followup.manage')
      )
        throw forbiddenError();
      if (input.assignedTo) await salesAssignee(db, input.assignedTo);
      const updated = await db.transaction().execute(async (trx) => {
        const current = await trx
          .selectFrom('lead_followups')
          .selectAll()
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (!current) throw notFoundError;
        if (
          !req.auth!.permissions.has('lead.followup.manage') &&
          current.assigned_to !== req.auth!.user.id
        )
          throw notFoundError;
        if (current.completed_at) throw conflictError('Completed follow-up cannot be edited.');
        const row = await trx
          .updateTable('lead_followups')
          .set({
            ...(input.dueAt !== undefined && { due_at: new Date(input.dueAt) }),
            ...(input.note !== undefined && { note: input.note }),
            ...(input.assignedTo !== undefined && { assigned_to: input.assignedTo })
          })
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirstOrThrow();
        await audit(trx, req.auth!.user.id, 'lead.followup.update', 'lead', current.lead_id, {
          followupId: id
        });
        return row;
      });
      sendData(res, {
        id: updated.id,
        assignedTo: updated.assigned_to,
        dueAt: updated.due_at,
        note: updated.note,
        completedAt: updated.completed_at
      });
    }
  );
  router.post(
    '/followups/:id/reopen',
    permitAny('lead.followup.manage', 'lead.followup.manage_assigned'),
    async (req, res) => {
      const id = parseUuid(req.params.id);
      const updated = await db.transaction().execute(async (trx) => {
        const current = await trx
          .selectFrom('lead_followups')
          .selectAll()
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (!current) throw notFoundError;
        if (
          !req.auth!.permissions.has('lead.followup.manage') &&
          current.assigned_to !== req.auth!.user.id
        )
          throw notFoundError;
        if (!current.completed_at) return current;
        const row = await trx
          .updateTable('lead_followups')
          .set({ completed_at: null })
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirstOrThrow();
        await audit(trx, req.auth!.user.id, 'lead.followup.reopen', 'lead', current.lead_id, {
          followupId: id
        });
        return row;
      });
      sendData(res, { id: updated.id, completedAt: updated.completed_at });
    }
  );
  router.delete(
    '/followups/:id',
    permitAny('lead.followup.manage', 'lead.followup.manage_assigned'),
    async (req, res) => {
      const id = parseUuid(req.params.id);
      await db.transaction().execute(async (trx) => {
        const current = await trx
          .selectFrom('lead_followups')
          .selectAll()
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (!current) throw notFoundError;
        if (
          !req.auth!.permissions.has('lead.followup.manage') &&
          current.assigned_to !== req.auth!.user.id
        )
          throw notFoundError;
        if (current.completed_at) throw conflictError('Completed follow-up cannot be deleted.');
        await trx.deleteFrom('lead_followups').where('id', '=', id).execute();
        await audit(trx, req.auth!.user.id, 'lead.followup.delete', 'lead', current.lead_id, {
          followupId: id
        });
      });
      res.status(204).end();
    }
  );
  return router;
}
