import { Router } from 'express';
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { DB } from '../../generated/database.types.js';
import type { ObjectStorage } from '../../integrations/storage/object-storage.js';
import { audit } from '../../core/db/audit.js';
import { notFoundError } from '../../core/errors/app-error.js';
import { validationError } from '../../core/errors/http-errors.js';
import { parseInput, parseUuid, sendData } from '../../core/http/api-response.js';
import { requirePermission } from '../../middleware/authorize.middleware.js';

const placement = z.enum(['home_inventory_rail', 'vehicle_catalog_rail']);
const targetUrl = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (value) => value.startsWith('/') || /^https:\/\//.test(value),
    'targetUrl must be an internal path or HTTPS URL.'
  );
const createInput = z.strictObject({
  name: z.string().trim().min(1).max(160),
  placement,
  targetUrl,
  uploadIntentId: z.uuid()
});
const patchInput = z
  .strictObject({
    name: z.string().trim().min(1).max(160).optional(),
    placement: placement.optional(),
    targetUrl: targetUrl.optional()
  })
  .refine((value) => Object.keys(value).length > 0);

function toDto(row: {
  id: string;
  name: string;
  placement: string;
  image_url: string;
  target_url: string;
  is_published: boolean;
  updated_at: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    placement: row.placement,
    imageUrl: row.image_url,
    targetUrl: row.target_url,
    isPublished: row.is_published,
    updatedAt: row.updated_at.toISOString()
  };
}

export function createAdvertisementAdminRouter(db: Kysely<DB>, storage: ObjectStorage): Router {
  const router = Router();
  router.get('/advertisements', requirePermission('cms.read'), async (_req, res) =>
    sendData(
      res,
      (
        await db.selectFrom('advertisements').selectAll().orderBy('updated_at', 'desc').execute()
      ).map(toDto)
    )
  );
  router.post('/advertisements', requirePermission('cms.manage'), async (req, res) => {
    const input = parseInput(createInput, req.body),
      actor = req.auth!.user.id;
    const row = await db.transaction().execute(async (trx) => {
      const intent = await trx
        .selectFrom('upload_intents')
        .selectAll()
        .where('id', '=', input.uploadIntentId)
        .executeTakeFirst();
      if (
        !intent ||
        intent.status !== 'completed' ||
        intent.created_by !== actor ||
        intent.purpose !== 'advertisement_media'
      )
        throw validationError('A completed advertisement upload owned by you is required.');
      const created = await trx
        .insertInto('advertisements')
        .values({
          name: input.name,
          placement: input.placement,
          upload_intent_id: intent.id,
          image_url: storage.publicUrl(intent.object_key, intent.mime_type),
          target_url: input.targetUrl,
          created_by: actor,
          updated_by: actor
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await audit(trx, actor, 'advertisement.create', 'advertisement', created.id);
      return created;
    });
    sendData(res, toDto(row), 201);
  });
  router.patch('/advertisements/:id', requirePermission('cms.manage'), async (req, res) => {
    const id = parseUuid(req.params.id),
      input = parseInput(patchInput, req.body),
      actor = req.auth!.user.id;
    const row = await db
      .updateTable('advertisements')
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.placement !== undefined && { placement: input.placement }),
        ...(input.targetUrl !== undefined && { target_url: input.targetUrl }),
        updated_by: actor,
        updated_at: new Date()
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw notFoundError;
    await audit(db, actor, 'advertisement.update', 'advertisement', id);
    sendData(res, toDto(row));
  });
  router.post('/advertisements/:id/publish', requirePermission('cms.publish'), async (req, res) => {
    const id = parseUuid(req.params.id),
      actor = req.auth!.user.id;
    const row = await db.transaction().execute(async (trx) => {
      const now = new Date();
      const published = await trx
        .updateTable('advertisements')
        .set({ is_published: true, updated_by: actor, updated_at: now })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst();
      if (!published) throw notFoundError;
      await audit(trx, actor, 'advertisement.publish', 'advertisement', id);
      return published;
    });
    sendData(res, toDto(row));
  });
  router.post(
    '/advertisements/:id/unpublish',
    requirePermission('cms.publish'),
    async (req, res) => {
      const id = parseUuid(req.params.id),
        actor = req.auth!.user.id;
      const row = await db
        .updateTable('advertisements')
        .set({ is_published: false, updated_by: actor, updated_at: new Date() })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst();
      if (!row) throw notFoundError;
      await audit(db, actor, 'advertisement.unpublish', 'advertisement', id);
      sendData(res, toDto(row));
    }
  );
  router.delete('/advertisements/:id', requirePermission('cms.manage'), async (req, res) => {
    const id = parseUuid(req.params.id),
      row = await db
        .deleteFrom('advertisements')
        .where('id', '=', id)
        .returning('id')
        .executeTakeFirst();
    if (!row) throw notFoundError;
    await audit(db, req.auth!.user.id, 'advertisement.delete', 'advertisement', id);
    res.status(204).end();
  });
  return router;
}

export function createPublicAdvertisementRouter(db: Kysely<DB>): Router {
  const router = Router();
  router.get('/advertisements', async (req, res) => {
    const query = parseInput(z.strictObject({ placement: placement.optional() }), req.query);
    let request = db
      .selectFrom('advertisements')
      .selectAll()
      .where('is_published', '=', true)
      .orderBy('updated_at', 'desc');
    if (query.placement) request = request.where('placement', '=', query.placement);
    sendData(res, (await request.execute()).map(toDto));
  });
  return router;
}
