import { createHash } from 'node:crypto';
import { Router } from 'express';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import type { DB } from '../../generated/database.types.js';
import type { AuthService } from '../auth/auth.service.js';
import type { RedisRateLimitStore } from '../../integrations/redis/redis.js';
import { notFoundError } from '../../core/errors/app-error.js';
import {
  authenticationError,
  conflictError,
  forbiddenError,
  validationError
} from '../../core/errors/http-errors.js';
import { audit } from '../../core/db/audit.js';
import { parseInput, sendData } from '../../core/http/api-response.js';
import { rateLimit } from '../../middleware/rate-limit.middleware.js';

const leadInput = z.strictObject({
  vehicleReferenceNo: z.string().regex(/^GW-\d+$/),
  marketSlug: z.string().trim().min(1).max(100),
  destinationCountryId: z.number().int().positive().nullable().optional(),
  message: z.string().trim().max(4000).nullable().optional(),
  consentGiven: z.literal(true),
  marketingConsent: z.boolean().default(false),
  utmSource: z.string().trim().max(100).nullable().optional(),
  utmMedium: z.string().trim().max(100).nullable().optional(),
  utmCampaign: z.string().trim().max(100).nullable().optional()
});
interface EligibleVehicle {
  id: string;
  reference_no: string;
  title: string;
  make_name: string;
  model_name: string;
  year: number;
  condition: string;
  market_id: string;
  market_slug: string;
}

export function createPublicLeadsRouter(
  db: Kysely<DB>,
  auth: AuthService,
  redis?: RedisRateLimitStore
): Router {
  const router = Router();
  router.post(
    '/leads',
    rateLimit({ keyPrefix: 'lead', limit: 5, windowMs: 15 * 60_000 }, redis),
    async (req, res) => {
      const bearer = req.get('authorization');
      if (!bearer?.startsWith('Bearer ')) throw authenticationError();
      const context = await auth.authenticateAccessToken(bearer.slice(7));
      if (context.user.userType !== 'customer')
        throw forbiddenError('Only customer accounts can request vehicle quotes.');
      const input = parseInput(leadInput, req.body);
      const key = req.get('Idempotency-Key');
      if (!key || !/^[A-Za-z0-9._:-]{8,128}$/.test(key))
        throw validationError('A valid Idempotency-Key is required.');
      const customer = context.user;
      const customerId = customer.id;
      const hash = createHash('sha256').update(JSON.stringify({ input, customerId })).digest('hex');
      const result = await db.transaction().execute(async (trx) => {
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(trx);
        const existing = await trx
          .selectFrom('lead_idempotency')
          .innerJoin('leads', 'leads.id', 'lead_idempotency.lead_id')
          .select(['lead_idempotency.payload_hash', 'leads.reference_no'])
          .where('lead_idempotency.idempotency_key', '=', key)
          .executeTakeFirst();
        if (existing) {
          if (existing.payload_hash !== hash)
            throw conflictError('Idempotency-Key was already used with a different request.');
          return { referenceNo: existing.reference_no, status: 'new' as const };
        }
        const eligible = await sql<EligibleVehicle>`
        SELECT v.id, v.reference_no, v.title, mk.name AS make_name, mo.name AS model_name,
          v.year, v.condition::text, m.id AS market_id, m.slug AS market_slug
        FROM vehicles v JOIN makes mk ON mk.id = v.make_id JOIN models mo ON mo.id = v.model_id
        JOIN vehicle_markets vm ON vm.vehicle_id = v.id AND vm.is_active
        JOIN markets m ON m.id = vm.market_id AND m.status = 'active'
        JOIN countries c ON c.id = m.country_id AND c.is_active
        WHERE v.reference_no = ${input.vehicleReferenceNo} AND m.slug = ${input.marketSlug}
          AND v.status = 'published' AND v.availability_status = 'available' AND v.deleted_at IS NULL
          AND (vm.available_from IS NULL OR vm.available_from <= now())
          AND (vm.available_until IS NULL OR vm.available_until > now())
        FOR SHARE OF v`.execute(trx);
        const vehicle = eligible.rows[0];
        if (!vehicle) throw notFoundError;
        const duplicate = await trx
          .selectFrom('leads')
          .select('id')
          .where('vehicle_id', '=', vehicle.id)
          .where('contact_email', '=', customer.email)
          .where('created_at', '>', new Date(Date.now() - 24 * 60 * 60_000))
          .orderBy('created_at', 'desc')
          .executeTakeFirst();
        const snapshot = {
          referenceNo: vehicle.reference_no,
          title: vehicle.title,
          make: vehicle.make_name,
          model: vehicle.model_name,
          year: vehicle.year,
          condition: vehicle.condition,
          marketSlug: vehicle.market_slug
        };
        const created = await trx
          .insertInto('leads')
          .values({
            vehicle_id: vehicle.id,
            market_id: vehicle.market_id,
            vehicle_snapshot: snapshot,
            customer_id: customerId,
            contact_name: customer.fullName,
            contact_email: customer.email,
            contact_phone: customer.phone,
            contact_whatsapp: customer.whatsapp,
            preferred_contact: customer.preferredContact,
            customer_country_id: customer.countryId,
            destination_country_id: input.destinationCountryId ?? null,
            city: customer.city,
            message: input.message ?? null,
            consent_given: true,
            marketing_consent: input.marketingConsent,
            source: 'website',
            utm_source: input.utmSource ?? null,
            utm_medium: input.utmMedium ?? null,
            utm_campaign: input.utmCampaign ?? null,
            referrer: req.get('referer')?.slice(0, 2000) ?? null,
            ip_address: req.ip ?? null,
            user_agent: req.get('user-agent')?.slice(0, 1000) ?? null,
            possible_duplicate_of: duplicate?.id ?? null
          })
          .returning(['id', 'reference_no', 'status'])
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('lead_activities')
          .values({
            lead_id: created.id,
            type: 'created',
            meta: { source: 'website', possibleDuplicate: Boolean(duplicate) }
          })
          .execute();
        await trx
          .insertInto('lead_idempotency')
          .values({ idempotency_key: key, payload_hash: hash, lead_id: created.id })
          .execute();
        await sql`INSERT INTO notifications (user_id, type, title, data)
        SELECT DISTINCT u.id, 'lead.received', 'New Get Quote request', ${JSON.stringify({ leadReferenceNo: created.reference_no })}::jsonb
        FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
        WHERE u.status = 'active' AND u.user_type = 'staff' AND r.name = 'sales_manager'`.execute(
          trx
        );
        await audit(trx, null, 'lead.create', 'lead', created.id);
        return { referenceNo: created.reference_no, status: created.status };
      });
      sendData(res, result, 201);
    }
  );
  return router;
}
