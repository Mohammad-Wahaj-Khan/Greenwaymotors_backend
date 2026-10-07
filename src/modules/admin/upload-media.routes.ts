import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { DB } from '../../generated/database.types.js';
import type { ObjectStorage } from '../../integrations/storage/object-storage.js';
import { notFoundError } from '../../core/errors/app-error.js';
import { conflictError, forbiddenError, validationError } from '../../core/errors/http-errors.js';
import { audit } from '../../core/db/audit.js';
import { parseInput, parseUuid, sendData } from '../../core/http/api-response.js';
import { requirePermission } from '../../middleware/authorize.middleware.js';

const mime = z.enum(['image/jpeg', 'image/png', 'image/webp', 'video/mp4']);
const presignInput = z
  .strictObject({
    purpose: z.literal('vehicle_media'),
    mimeType: mime,
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(100 * 1024 * 1024)
  })
  .refine(
    (value) => value.mimeType === 'video/mp4' || value.sizeBytes <= 20 * 1024 * 1024,
    'Images may not exceed 20 MiB.'
  );
const mediaInput = z.strictObject({
  uploadIntentId: z.uuid(),
  isPrimary: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(10000).default(0)
});
function mediaDto(row: {
  id: string;
  type: string;
  url: string;
  thumb_url: string | null;
  sort_order: number;
  is_primary: boolean;
  mime_type: string | null;
  size_bytes: string | null;
}) {
  return {
    id: row.id,
    type: row.type,
    url: row.url,
    thumbUrl: row.thumb_url,
    sortOrder: row.sort_order,
    isPrimary: row.is_primary,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes
  };
}

export function createUploadMediaRouter(db: Kysely<DB>, storage: ObjectStorage): Router {
  const router = Router();
  router.post('/uploads/presign', requirePermission('vehicle.media.manage'), async (req, res) => {
    const input = parseInput(presignInput, req.body);
    const extension = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'video/mp4': 'mp4'
    }[input.mimeType];
    const key = `vehicle-media/${req.auth!.user.id}/${randomUUID()}.${extension}`;
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    const intent = await db
      .insertInto('upload_intents')
      .values({
        object_key: key,
        purpose: input.purpose,
        mime_type: input.mimeType,
        size_bytes: input.sizeBytes,
        expires_at: expiresAt,
        created_by: req.auth!.user.id
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const upload = await storage.createUpload(key, input.mimeType, input.sizeBytes);
    sendData(
      res,
      {
        uploadIntentId: intent.id,
        ...upload,
        expiresAt: expiresAt.toISOString()
      },
      201
    );
  });
  router.post('/uploads/complete', requirePermission('vehicle.media.manage'), async (req, res) => {
    const input = parseInput(z.strictObject({ uploadIntentId: z.uuid() }), req.body);
    const intent = await db
      .selectFrom('upload_intents')
      .selectAll()
      .where('id', '=', input.uploadIntentId)
      .executeTakeFirst();
    if (!intent) throw notFoundError;
    if (intent.created_by !== req.auth!.user.id) throw forbiddenError();
    if (intent.status === 'completed') {
      sendData(res, { uploadIntentId: intent.id, completed: true });
      return;
    }
    if (intent.expires_at <= new Date()) throw conflictError('Upload intent expired.');
    const object = await storage.head(intent.object_key, intent.mime_type);
    if (object.mimeType !== intent.mime_type || object.sizeBytes !== Number(intent.size_bytes))
      throw validationError('Uploaded object type or size differs from the authorized intent.');
    await db
      .updateTable('upload_intents')
      .set({ status: 'completed', completed_at: new Date() })
      .where('id', '=', intent.id)
      .where('status', '=', 'pending')
      .execute();
    sendData(res, { uploadIntentId: intent.id, completed: true });
  });
  router.get('/vehicles/:id/media', requirePermission('vehicle.read_all'), async (req, res) => {
    const id = parseUuid(req.params.id);
    const rows = await db
      .selectFrom('vehicle_media')
      .selectAll()
      .where('vehicle_id', '=', id)
      .orderBy('sort_order')
      .orderBy('created_at')
      .execute();
    sendData(res, rows.map(mediaDto));
  });
  router.post(
    '/vehicles/:id/media',
    requirePermission('vehicle.media.manage'),
    async (req, res) => {
      const id = parseUuid(req.params.id);
      const input = parseInput(mediaInput, req.body);
      try {
        const row = await db.transaction().execute(async (trx) => {
          const vehicle = await trx
            .selectFrom('vehicles')
            .select('id')
            .where('id', '=', id)
            .where('deleted_at', 'is', null)
            .forUpdate()
            .executeTakeFirst();
          if (!vehicle) throw notFoundError;
          const intent = await trx
            .selectFrom('upload_intents')
            .selectAll()
            .where('id', '=', input.uploadIntentId)
            .executeTakeFirst();
          if (!intent || intent.status !== 'completed' || intent.created_by !== req.auth!.user.id)
            throw validationError(
              'A completed upload intent owned by this staff member is required.'
            );
          if (input.isPrimary)
            await trx
              .updateTable('vehicle_media')
              .set({ is_primary: false })
              .where('vehicle_id', '=', id)
              .execute();
          const created = await trx
            .insertInto('vehicle_media')
            .values({
              vehicle_id: id,
              upload_intent_id: intent.id,
              storage_key: intent.object_key,
              mime_type: intent.mime_type,
              size_bytes: intent.size_bytes,
              type: intent.mime_type === 'video/mp4' ? 'video' : 'image',
              url: storage.publicUrl(intent.object_key, intent.mime_type),
              sort_order: input.sortOrder,
              is_primary: input.isPrimary
            })
            .returningAll()
            .executeTakeFirstOrThrow();
          await audit(trx, req.auth!.user.id, 'vehicle.media.attach', 'vehicle', id, {
            mediaId: created.id
          });
          return created;
        });
        sendData(res, mediaDto(row), 201);
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === '23505'
        )
          throw conflictError('Upload already attached or primary media conflict.');
        throw error;
      }
    }
  );
  router.patch(
    '/vehicles/:id/media/:mediaId',
    requirePermission('vehicle.media.manage'),
    async (req, res) => {
      const id = parseUuid(req.params.id);
      const mediaId = parseUuid(req.params.mediaId);
      const input = parseInput(
        z
          .strictObject({
            isPrimary: z.boolean().optional(),
            sortOrder: z.number().int().min(0).max(10000).optional()
          })
          .refine((v) => Object.keys(v).length > 0),
        req.body
      );
      const row = await db.transaction().execute(async (trx) => {
        const vehicle = await trx
          .selectFrom('vehicles')
          .select('id')
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (!vehicle) throw notFoundError;
        if (input.isPrimary)
          await trx
            .updateTable('vehicle_media')
            .set({ is_primary: false })
            .where('vehicle_id', '=', id)
            .execute();
        const updated = await trx
          .updateTable('vehicle_media')
          .set({
            ...(input.isPrimary !== undefined && { is_primary: input.isPrimary }),
            ...(input.sortOrder !== undefined && { sort_order: input.sortOrder })
          })
          .where('id', '=', mediaId)
          .where('vehicle_id', '=', id)
          .returningAll()
          .executeTakeFirst();
        if (!updated) throw notFoundError;
        await audit(trx, req.auth!.user.id, 'vehicle.media.update', 'vehicle', id, { mediaId });
        return updated;
      });
      sendData(res, mediaDto(row));
    }
  );
  router.delete(
    '/vehicles/:id/media/:mediaId',
    requirePermission('vehicle.media.manage'),
    async (req, res) => {
      const id = parseUuid(req.params.id);
      const mediaId = parseUuid(req.params.mediaId);
      await db.transaction().execute(async (trx) => {
        const deleted = await trx
          .deleteFrom('vehicle_media')
          .where('id', '=', mediaId)
          .where('vehicle_id', '=', id)
          .returning('id')
          .executeTakeFirst();
        if (!deleted) throw notFoundError;
        await audit(trx, req.auth!.user.id, 'vehicle.media.delete', 'vehicle', id, { mediaId });
      });
      res.status(204).end();
    }
  );
  router.post(
    '/vehicles/:id/media/reorder',
    requirePermission('vehicle.media.manage'),
    async (req, res) => {
      const id = parseUuid(req.params.id);
      const input = parseInput(z.strictObject({ mediaIds: z.array(z.uuid()).max(200) }), req.body);
      if (new Set(input.mediaIds).size !== input.mediaIds.length)
        throw validationError('mediaIds must be unique.');
      await db.transaction().execute(async (trx) => {
        const vehicle = await trx
          .selectFrom('vehicles')
          .select('id')
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (!vehicle) throw notFoundError;
        const current = await trx
          .selectFrom('vehicle_media')
          .select('id')
          .where('vehicle_id', '=', id)
          .execute();
        if (
          current.length !== input.mediaIds.length ||
          current.some((item) => !input.mediaIds.includes(item.id))
        )
          throw validationError('mediaIds must contain the complete current media set.');
        for (const [index, mediaId] of input.mediaIds.entries())
          await trx
            .updateTable('vehicle_media')
            .set({ sort_order: index })
            .where('id', '=', mediaId)
            .execute();
        await audit(trx, req.auth!.user.id, 'vehicle.media.reorder', 'vehicle', id);
      });
      sendData(res, { mediaIds: input.mediaIds });
    }
  );
  return router;
}
