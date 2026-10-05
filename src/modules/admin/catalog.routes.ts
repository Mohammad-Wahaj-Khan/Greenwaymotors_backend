import { Router } from 'express';
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { DB } from '../../generated/database.types.js';
import { audit } from '../../core/db/audit.js';
import { notFoundError } from '../../core/errors/app-error.js';
import { conflictError } from '../../core/errors/http-errors.js';
import { parseInput, sendData } from '../../core/http/api-response.js';
import { requirePermission } from '../../middleware/authorize.middleware.js';

const name = z.string().trim().min(1).max(120);
const slug = z
  .string()
  .trim()
  .min(1)
  .max(140)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
function unique(error: unknown): never {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')
    throw conflictError('A catalog record with this slug or name already exists.');
  throw error;
}
export function createCatalogAdminRouter(db: Kysely<DB>): Router {
  const r = Router();
  r.get('/catalog/makes', requirePermission('catalog.manage'), async (_req, res) =>
    sendData(res, await db.selectFrom('makes').selectAll().orderBy('name').execute())
  );
  r.post('/catalog/makes', requirePermission('catalog.manage'), async (req, res) => {
    const input = parseInput(
        z.object({ name, slug, logoUrl: z.url().nullable().optional() }).strict(),
        req.body
      ),
      actor = req.auth!.user.id;
    try {
      const row = await db.transaction().execute(async (trx) => {
        const value = await trx
          .insertInto('makes')
          .values({ name: input.name, slug: input.slug, logo_url: input.logoUrl ?? null })
          .returningAll()
          .executeTakeFirstOrThrow();
        await audit(trx, actor, 'catalog.make.create', 'make', String(value.id), {
          slug: value.slug
        });
        return value;
      });
      sendData(res, row, 201);
    } catch (error) {
      unique(error);
    }
  });
  r.patch('/catalog/makes/:id', requirePermission('catalog.manage'), async (req, res) => {
    const id = parseInput(z.coerce.number().int().positive(), req.params.id),
      input = parseInput(
        z
          .object({
            name: name.optional(),
            slug: slug.optional(),
            logoUrl: z.url().nullable().optional(),
            isActive: z.boolean().optional()
          })
          .strict()
          .refine((v) => Object.keys(v).length > 0),
        req.body
      );
    try {
      const row = await db.transaction().execute(async (trx) => {
        const value = await trx
          .updateTable('makes')
          .set({
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.slug === undefined ? {} : { slug: input.slug }),
            ...(input.logoUrl === undefined ? {} : { logo_url: input.logoUrl }),
            ...(input.isActive === undefined ? {} : { is_active: input.isActive })
          })
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirst();
        if (!value) throw notFoundError;
        await audit(trx, req.auth!.user.id, 'catalog.make.update', 'make', String(id));
        return value;
      });
      sendData(res, row);
    } catch (error) {
      unique(error);
    }
  });
  r.get('/catalog/models', requirePermission('catalog.manage'), async (_req, res) =>
    sendData(
      res,
      await db.selectFrom('models').selectAll().orderBy('make_id').orderBy('name').execute()
    )
  );
  r.post('/catalog/models', requirePermission('catalog.manage'), async (req, res) => {
    const input = parseInput(
      z.object({ makeId: z.number().int().positive(), name, slug }).strict(),
      req.body
    );
    try {
      const row = await db.transaction().execute(async (trx) => {
        const value = await trx
          .insertInto('models')
          .values({ make_id: input.makeId, name: input.name, slug: input.slug })
          .returningAll()
          .executeTakeFirstOrThrow();
        await audit(trx, req.auth!.user.id, 'catalog.model.create', 'model', String(value.id), {
          makeId: input.makeId
        });
        return value;
      });
      sendData(res, row, 201);
    } catch (error) {
      unique(error);
    }
  });
  r.patch('/catalog/models/:id', requirePermission('catalog.manage'), async (req, res) => {
    const id = parseInput(z.coerce.number().int().positive(), req.params.id),
      input = parseInput(
        z
          .object({
            makeId: z.number().int().positive().optional(),
            name: name.optional(),
            slug: slug.optional(),
            isActive: z.boolean().optional()
          })
          .strict()
          .refine((v) => Object.keys(v).length > 0),
        req.body
      );
    try {
      const row = await db.transaction().execute(async (trx) => {
        const value = await trx
          .updateTable('models')
          .set({
            ...(input.makeId === undefined ? {} : { make_id: input.makeId }),
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.slug === undefined ? {} : { slug: input.slug }),
            ...(input.isActive === undefined ? {} : { is_active: input.isActive })
          })
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirst();
        if (!value) throw notFoundError;
        await audit(trx, req.auth!.user.id, 'catalog.model.update', 'model', String(id));
        return value;
      });
      sendData(res, row);
    } catch (error) {
      unique(error);
    }
  });
  r.get('/catalog/body-types', requirePermission('catalog.manage'), async (_req, res) =>
    sendData(res, await db.selectFrom('body_types').selectAll().orderBy('name').execute())
  );
  r.post('/catalog/body-types', requirePermission('catalog.manage'), async (req, res) => {
    const input = parseInput(z.object({ name, slug }).strict(), req.body);
    try {
      const row = await db.transaction().execute(async (trx) => {
        const value = await trx
          .insertInto('body_types')
          .values(input)
          .returningAll()
          .executeTakeFirstOrThrow();
        await audit(
          trx,
          req.auth!.user.id,
          'catalog.body_type.create',
          'body_type',
          String(value.id)
        );
        return value;
      });
      sendData(res, row, 201);
    } catch (error) {
      unique(error);
    }
  });
  r.patch('/catalog/body-types/:id', requirePermission('catalog.manage'), async (req, res) => {
    const id = parseInput(z.coerce.number().int().positive(), req.params.id),
      input = parseInput(
        z
          .object({ name: name.optional(), slug: slug.optional() })
          .strict()
          .refine((v) => Object.keys(v).length > 0),
        req.body
      );
    try {
      const row = await db.transaction().execute(async (trx) => {
        const value = await trx
          .updateTable('body_types')
          .set(input)
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirst();
        if (!value) throw notFoundError;
        await audit(trx, req.auth!.user.id, 'catalog.body_type.update', 'body_type', String(id));
        return value;
      });
      sendData(res, row);
    } catch (error) {
      unique(error);
    }
  });
  r.get('/catalog/features', requirePermission('catalog.manage'), async (_req, res) =>
    sendData(
      res,
      await db.selectFrom('features').selectAll().orderBy('category').orderBy('name').execute()
    )
  );
  r.post('/catalog/features', requirePermission('catalog.manage'), async (req, res) => {
    const input = parseInput(
      z.object({ name, category: z.string().trim().max(100).nullable().optional() }).strict(),
      req.body
    );
    const row = await db.transaction().execute(async (trx) => {
      const value = await trx
        .insertInto('features')
        .values({ name: input.name, category: input.category ?? null })
        .returningAll()
        .executeTakeFirstOrThrow();
      await audit(trx, req.auth!.user.id, 'catalog.feature.create', 'feature', String(value.id));
      return value;
    });
    sendData(res, row, 201);
  });
  r.patch('/catalog/features/:id', requirePermission('catalog.manage'), async (req, res) => {
    const id = parseInput(z.coerce.number().int().positive(), req.params.id),
      input = parseInput(
        z
          .object({
            name: name.optional(),
            category: z.string().trim().max(100).nullable().optional()
          })
          .strict()
          .refine((v) => Object.keys(v).length > 0),
        req.body
      );
    const row = await db.transaction().execute(async (trx) => {
      const value = await trx
        .updateTable('features')
        .set(input)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst();
      if (!value) throw notFoundError;
      await audit(trx, req.auth!.user.id, 'catalog.feature.update', 'feature', String(id));
      return value;
    });
    sendData(res, row);
  });
  return r;
}
