import { Router, type Request } from 'express';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import type { DB } from '../../generated/database.types.js';
import { forbiddenError } from '../../core/errors/http-errors.js';
import { parseInput, sendData } from '../../core/http/api-response.js';
import { requirePermission } from '../../middleware/authorize.middleware.js';

const querySchema = z
  .object({
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    marketId: z.uuid().optional(),
    salespersonId: z.uuid().optional(),
    status: z.string().trim().max(40).optional(),
    source: z.string().trim().max(80).optional(),
    limit: z.coerce.number().int().min(1).max(366).default(90)
  })
  .superRefine((v, c) => {
    if (v.from && v.to && Date.parse(v.to) <= Date.parse(v.from))
      c.addIssue({ code: 'custom', path: ['to'], message: 'to must follow from.' });
    if (v.from && v.to && Date.parse(v.to) - Date.parse(v.from) > 366 * 86400000)
      c.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'Report ranges cannot exceed 366 days.'
      });
  });
function filters(req: Request) {
  const q = parseInput(querySchema, req.query);
  return {
    from: q.from ? new Date(q.from) : null,
    to: q.to ? new Date(q.to) : null,
    marketId: q.marketId ?? null,
    salespersonId: q.salespersonId ?? null,
    status: q.status ?? null,
    source: q.source ?? null,
    limit: q.limit
  };
}

export function createDashboardRouter(db: Kysely<DB>): Router {
  const r = Router();
  r.get('/dashboard/summary', requirePermission('dashboard.read'), async (req, res) => {
    const userId = req.auth!.user.id,
      all = req.auth!.permissions.has('lead.read_all');
    const row = await sql<Record<string, unknown>>`
   SELECT
    (SELECT count(*)::int FROM leads WHERE (created_at>=current_date) AND (${all} OR assigned_to=${userId})) AS leads_today,
    (SELECT count(*)::int FROM leads WHERE status IN ('new','contacted','quote_sent','negotiating') AND (${all} OR assigned_to=${userId})) AS open_leads,
    (SELECT count(*)::int FROM lead_followups WHERE completed_at IS NULL AND due_at<now() AND (${all} OR assigned_to=${userId})) AS overdue_followups,
    (SELECT count(*)::int FROM deals WHERE status NOT IN ('completed','cancelled') AND (${req.auth!.permissions.has('deal.read_all')} OR owner_salesperson_id=${userId})) AS active_deals,
    (SELECT count(*)::int FROM vehicles WHERE status='published' AND availability_status='available' AND deleted_at IS NULL) AS available_inventory
  `.execute(db);
    sendData(res, row.rows[0]);
  });
  r.get('/dashboard/leads', requirePermission('dashboard.read'), async (req, res) => {
    const q = filters(req),
      userId = req.auth!.user.id,
      all = req.auth!.permissions.has('lead.read_all');
    const rows = await sql<Record<string, unknown>>`
   SELECT date_trunc('day',created_at)::date AS day,status::text,count(*)::int AS count
   FROM leads WHERE (${q.from}::timestamptz IS NULL OR created_at>=${q.from}::timestamptz)
    AND (${q.to}::timestamptz IS NULL OR created_at<${q.to}::timestamptz)
    AND (${all} OR assigned_to=${userId})
   GROUP BY 1,status ORDER BY 1 DESC,status LIMIT ${q.limit}
  `.execute(db);
    sendData(res, rows.rows);
  });
  r.get('/dashboard/inventory', requirePermission('dashboard.read'), async (_req, res) => {
    const rows = await sql<Record<string, unknown>>`
   SELECT status::text,availability_status::text,count(*)::int AS count
   FROM vehicles WHERE deleted_at IS NULL GROUP BY status,availability_status ORDER BY status,availability_status
  `.execute(db);
    sendData(res, rows.rows);
  });
  r.get('/dashboard/sales', requirePermission('dashboard.read'), async (req, res) => {
    const userId = req.auth!.user.id,
      all = req.auth!.permissions.has('deal.read_all');
    const rows = await sql<Record<string, unknown>>`
   SELECT status::text,count(*)::int AS count
   FROM deals WHERE (${all} OR owner_salesperson_id=${userId})
   GROUP BY status ORDER BY status
  `.execute(db);
    const result: Record<string, unknown> = { deals: rows.rows };
    if (req.auth!.permissions.has('analytics.financial.read')) {
      const money = await sql<Record<string, unknown>>`
    SELECT currency_code,count(*)::int AS deal_count,
      COALESCE(sum(agreed_amount_minor),0)::text AS revenue_minor
    FROM deals WHERE status='completed' AND (${all} OR owner_salesperson_id=${userId})
    GROUP BY currency_code ORDER BY currency_code
   `.execute(db);
      result.financial = money.rows;
    }
    sendData(res, result);
  });
  r.get('/dashboard/followups', requirePermission('dashboard.read'), async (req, res) => {
    const all = req.auth!.permissions.has('lead.followup.manage'),
      userId = req.auth!.user.id;
    const rows = await sql<Record<string, unknown>>`
   SELECT count(*) FILTER(WHERE due_at<now())::int AS overdue,
          count(*) FILTER(WHERE due_at>=now() AND due_at<now()+interval '24 hours')::int AS due_next_24h,
          count(*) FILTER(WHERE due_at>=now() AND due_at<now()+interval '7 days')::int AS due_next_7d
   FROM lead_followups WHERE completed_at IS NULL AND (${all} OR assigned_to=${userId})
  `.execute(db);
    sendData(res, rows.rows[0]);
  });

  const reports = [
    'leads',
    'sales',
    'inventory',
    'vehicles',
    'markets',
    'salespeople',
    'sources',
    'lost-reasons'
  ] as const;
  for (const name of reports)
    r.get('/reports/' + name, async (req, res) => {
      if (name === 'sources' && !req.auth!.permissions.has('inventory_source.read'))
        throw forbiddenError();
      if (name === 'sales' && !req.auth!.permissions.has('analytics.financial.read'))
        throw forbiddenError('Financial report access is required.');
      if (
        name !== 'sales' &&
        !req.auth!.permissions.has('analytics.read') &&
        !req.auth!.permissions.has('analytics.financial.read')
      )
        throw forbiddenError();
      const q = filters(req);
      const from = q.from,
        to = q.to,
        marketId = q.marketId,
        salespersonId = q.salespersonId,
        status = q.status,
        source = q.source;
      let result;
      switch (name) {
        case 'leads':
          result = await sql<Record<string, unknown>>`
     SELECT status::text,source,market_id,count(*)::int AS count,
       count(*) FILTER(WHERE assigned_to IS NOT NULL)::int AS assigned
     FROM leads WHERE (${from}::timestamptz IS NULL OR created_at>=${from}::timestamptz)
      AND (${to}::timestamptz IS NULL OR created_at<${to}::timestamptz)
      AND (${marketId}::uuid IS NULL OR market_id=${marketId}::uuid)
      AND (${salespersonId}::uuid IS NULL OR assigned_to=${salespersonId}::uuid)
      AND (${status}::text IS NULL OR status::text=${status}::text)
      AND (${source}::text IS NULL OR source=${source}::text)
     GROUP BY status,source,market_id ORDER BY count DESC LIMIT 1000
    `.execute(db);
          break;
        case 'sales':
          result = await sql<Record<string, unknown>>`
    SELECT date_trunc('month',created_at)::date AS month,status::text,currency_code,count(*)::int AS count,
       COALESCE(sum(agreed_amount_minor),0)::text AS revenue_minor,
       COALESCE(sum(source_cost_minor),0)::text AS source_cost_minor,
       COALESCE(sum(margin_minor),0)::text AS estimated_margin_minor
     FROM deals WHERE (${from}::timestamptz IS NULL OR created_at>=${from}::timestamptz)
      AND (${to}::timestamptz IS NULL OR created_at<${to}::timestamptz)
      AND (${marketId}::uuid IS NULL OR market_id=${marketId}::uuid)
      AND (${salespersonId}::uuid IS NULL OR owner_salesperson_id=${salespersonId}::uuid)
      AND (${status}::text IS NULL OR status::text=${status}::text)
     GROUP BY month,status,currency_code ORDER BY month DESC,status,currency_code LIMIT 1000
    `.execute(db);
          break;
        case 'inventory':
          result = await sql<Record<string, unknown>>`
     SELECT status::text,availability_status::text,count(*)::int AS count,
       count(*) FILTER(WHERE published_at<now()-interval '30 days')::int AS older_than_30_days
     FROM vehicles WHERE deleted_at IS NULL GROUP BY status,availability_status ORDER BY status,availability_status
    `.execute(db);
          break;
        case 'vehicles':
          result = await sql<Record<string, unknown>>`
     SELECT mk.id AS make_id,mk.name AS make,mo.id AS model_id,mo.name AS model,count(*)::int AS leads
     FROM leads l JOIN vehicles v ON v.id=l.vehicle_id JOIN makes mk ON mk.id=v.make_id JOIN models mo ON mo.id=v.model_id
     WHERE (${from}::timestamptz IS NULL OR l.created_at>=${from}::timestamptz)
      AND (${to}::timestamptz IS NULL OR l.created_at<${to}::timestamptz)
      AND (${marketId}::uuid IS NULL OR l.market_id=${marketId}::uuid)
     GROUP BY mk.id,mk.name,mo.id,mo.name ORDER BY leads DESC LIMIT 100
    `.execute(db);
          break;
        case 'markets':
          result = await sql<Record<string, unknown>>`
     SELECT m.id,m.slug,c.name AS country_name,COALESCE(l.leads,0)::int AS leads,
       COALESCE(l.won,0)::int AS won,COALESCE(d.deals,0)::int AS deals
     FROM markets m JOIN countries c ON c.id=m.country_id
     LEFT JOIN (
       SELECT market_id,count(*)::int AS leads,
         count(*) FILTER(WHERE status IN ('won','completed'))::int AS won
       FROM leads WHERE (${from}::timestamptz IS NULL OR created_at>=${from}::timestamptz)
        AND (${to}::timestamptz IS NULL OR created_at<${to}::timestamptz)
       GROUP BY market_id
     ) l ON l.market_id=m.id
     LEFT JOIN (
       SELECT market_id,count(*)::int AS deals FROM deals WHERE status='completed'
       AND (${from}::timestamptz IS NULL OR created_at>=${from}::timestamptz)
       AND (${to}::timestamptz IS NULL OR created_at<${to}::timestamptz)
       GROUP BY market_id
     ) d ON d.market_id=m.id
     WHERE (${marketId}::uuid IS NULL OR m.id=${marketId}::uuid)
     ORDER BY leads DESC LIMIT 100
    `.execute(db);
          break;
        case 'salespeople':
          result = await sql<Record<string, unknown>>`
     SELECT u.id,u.full_name,count(DISTINCT l.id)::int AS leads,
       count(DISTINCT l.id) FILTER(WHERE l.status IN ('won','completed'))::int AS won_leads,
       count(DISTINCT q.id)::int AS quotes,count(DISTINCT d.id)::int AS deals
     FROM users u LEFT JOIN leads l ON l.assigned_to=u.id
      AND (${from}::timestamptz IS NULL OR l.created_at>=${from}::timestamptz)
      AND (${to}::timestamptz IS NULL OR l.created_at<${to}::timestamptz)
     LEFT JOIN quotes q ON q.lead_id=l.id LEFT JOIN deals d ON d.lead_id=l.id
     WHERE u.user_type='staff' AND (${salespersonId}::uuid IS NULL OR u.id=${salespersonId}::uuid)
     GROUP BY u.id,u.full_name ORDER BY leads DESC LIMIT 100
    `.execute(db);
          break;
        case 'sources':
          result = await sql<Record<string, unknown>>`
     SELECT s.id,s.company_name,s.reliability_rating,count(v.id)::int AS vehicles,
       count(v.id) FILTER(WHERE v.availability_status='sold')::int AS sold
     FROM inventory_sources s LEFT JOIN vehicles v ON v.inventory_source_id=s.id AND v.deleted_at IS NULL
     GROUP BY s.id,s.company_name,s.reliability_rating ORDER BY vehicles DESC LIMIT 100
    `.execute(db);
          break;
        case 'lost-reasons':
          result = await sql<Record<string, unknown>>`
     SELECT lost_reason,count(*)::int AS count FROM leads
     WHERE status='lost' AND (${from}::timestamptz IS NULL OR created_at>=${from}::timestamptz)
      AND (${to}::timestamptz IS NULL OR created_at<${to}::timestamptz)
      AND (${marketId}::uuid IS NULL OR market_id=${marketId}::uuid)
      AND (${salespersonId}::uuid IS NULL OR assigned_to=${salespersonId}::uuid)
     GROUP BY lost_reason ORDER BY count DESC LIMIT 100
    `.execute(db);
          break;
      }
      sendData(res, result?.rows ?? []);
    });
  return r;
}
