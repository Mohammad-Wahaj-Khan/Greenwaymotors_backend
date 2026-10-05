import { Router, type Request } from 'express';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import type { DB } from '../../generated/database.types.js';
import { audit } from '../../core/db/audit.js';
import { notFoundError } from '../../core/errors/app-error.js';
import { forbiddenError } from '../../core/errors/http-errors.js';
import { parseInput, sendData } from '../../core/http/api-response.js';

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const marketIds = z
  .array(z.uuid())
  .max(50)
  .refine((x) => new Set(x).size === x.length);
const bodySchema = z
  .object({
    slug: slugSchema,
    title: z.string().trim().min(1).max(300),
    excerpt: z.string().max(2000).nullable().optional(),
    content: z.record(z.string().max(80), z.unknown()),
    seoTitle: z.string().max(300).nullable().optional(),
    seoDescription: z.string().max(1000).nullable().optional(),
    markets: marketIds.default([])
  })
  .strict();
const patchSchema = bodySchema.partial().refine((x) => Object.keys(x).length > 0);
const querySchema = z.object({
  market: z.string().trim().min(1).max(100).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100000).default(0)
});
const collections = ['pages', 'blog', 'faqs', 'banners'] as const;
type Collection = (typeof collections)[number];
const kinds: Record<Collection, string> = {
  pages: 'page',
  blog: 'blog',
  faqs: 'faq',
  banners: 'banner'
};
function permit(req: Request, ...codes: string[]) {
  if (!codes.some((x) => req.auth?.permissions.has(x))) throw forbiddenError();
}

export function createPublicContentRouter(db: Kysely<DB>): Router {
  const r = Router();
  r.get('/pages/:slug', async (req, res) => {
    const slug = parseInput(slugSchema, req.params.slug),
      market = typeof req.query.market === 'string' ? req.query.market : null;
    const rows = await sql<Record<string, unknown>>`
   SELECT e.id,e.slug,e.title,e.excerpt,e.content,e.seo_title,e.seo_description,e.published_at,e.updated_at
   FROM cms_entries e WHERE e.kind='page' AND e.slug=${slug} AND e.status='published'
    AND (${market}::text IS NULL OR NOT EXISTS(SELECT 1 FROM cms_entry_markets em WHERE em.entry_id=e.id)
     OR EXISTS(SELECT 1 FROM cms_entry_markets em JOIN markets m ON m.id=em.market_id
       WHERE em.entry_id=e.id AND m.slug=${market} AND m.status='active'))
   LIMIT 1
  `.execute(db);
    if (!rows.rows[0]) throw notFoundError;
    sendData(res, rows.rows[0]);
  });
  r.get('/faqs', async (req, res) => {
    const q = parseInput(querySchema, req.query),
      market = q.market ?? null;
    const rows = await sql<Record<string, unknown>>`
   SELECT e.id,e.slug,e.title,e.content,e.seo_title,e.seo_description,e.published_at
   FROM cms_entries e WHERE e.kind='faq' AND e.status='published'
    AND (${market}::text IS NULL OR NOT EXISTS(SELECT 1 FROM cms_entry_markets em WHERE em.entry_id=e.id)
     OR EXISTS(SELECT 1 FROM cms_entry_markets em JOIN markets m ON m.id=em.market_id
       WHERE em.entry_id=e.id AND m.slug=${market} AND m.status='active'))
   ORDER BY e.published_at DESC,e.id LIMIT ${q.limit} OFFSET ${q.offset}
  `.execute(db);
    sendData(res, rows.rows);
  });
  r.get('/blog', async (req, res) => {
    const q = parseInput(querySchema, req.query),
      market = q.market ?? null;
    const rows = await sql<Record<string, unknown>>`
   SELECT e.id,e.slug,e.title,e.excerpt,e.seo_title,e.seo_description,e.published_at
   FROM cms_entries e WHERE e.kind='blog' AND e.status='published'
    AND (${market}::text IS NULL OR NOT EXISTS(SELECT 1 FROM cms_entry_markets em WHERE em.entry_id=e.id)
     OR EXISTS(SELECT 1 FROM cms_entry_markets em JOIN markets m ON m.id=em.market_id
       WHERE em.entry_id=e.id AND m.slug=${market} AND m.status='active'))
   ORDER BY e.published_at DESC,e.id LIMIT ${q.limit} OFFSET ${q.offset}
  `.execute(db);
    sendData(res, rows.rows);
  });
  r.get('/blog/:slug', async (req, res) => {
    const slug = parseInput(slugSchema, req.params.slug),
      market = typeof req.query.market === 'string' ? req.query.market : null;
    const rows = await sql<Record<string, unknown>>`
   SELECT id,slug,title,excerpt,content,seo_title,seo_description,published_at,updated_at
   FROM cms_entries e WHERE kind='blog' AND status='published' AND slug=${slug}
    AND (${market}::text IS NULL OR NOT EXISTS(SELECT 1 FROM cms_entry_markets em WHERE em.entry_id=e.id)
     OR EXISTS(SELECT 1 FROM cms_entry_markets em JOIN markets m ON m.id=em.market_id
       WHERE em.entry_id=e.id AND m.slug=${market} AND m.status='active')) LIMIT 1
  `.execute(db);
    if (!rows.rows[0]) throw notFoundError;
    sendData(res, rows.rows[0]);
  });
  r.get('/banners', async (req, res) => {
    const q = parseInput(querySchema, req.query),
      market = q.market ?? null;
    const rows = await sql<Record<string, unknown>>`
   SELECT e.id,e.slug,e.title,e.excerpt,e.content,e.seo_title,e.seo_description,e.published_at
   FROM cms_entries e WHERE e.kind='banner' AND e.status='published'
    AND (${market} IS NULL OR NOT EXISTS(SELECT 1 FROM cms_entry_markets em WHERE em.entry_id=e.id)
     OR EXISTS(SELECT 1 FROM cms_entry_markets em JOIN markets m ON m.id=em.market_id
       WHERE em.entry_id=e.id AND m.slug=${market} AND m.status='active'))
   ORDER BY e.published_at DESC,e.id LIMIT ${q.limit} OFFSET ${q.offset}
  `.execute(db);
    sendData(res, rows.rows);
  });
  return r;
}

export function createCmsAdminRouter(db: Kysely<DB>): Router {
  const r = Router();
  for (const collection of collections) {
    const kind = kinds[collection],
      base = '/content/' + collection;
    r.get(base, async (req, res) => {
      permit(req, 'cms.read', 'cms.manage', 'cms.publish');
      const q = parseInput(querySchema, req.query);
      const rows = await sql<Record<string, unknown>>`
    SELECT e.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'slug',m.slug) ORDER BY m.slug)
      FROM cms_entry_markets em JOIN markets m ON m.id=em.market_id WHERE em.entry_id=e.id),'[]'::jsonb) AS markets
    FROM cms_entries e WHERE e.kind=${kind}
      AND (${q.status} IS NULL OR e.status=${q.status})
    ORDER BY e.updated_at DESC,e.id LIMIT ${q.limit} OFFSET ${q.offset}
   `.execute(db);
      sendData(res, rows.rows);
    });
    r.post(base, async (req, res) => {
      permit(req, 'cms.manage');
      const x = parseInput(bodySchema, req.body),
        actor = req.auth!.user.id;
      const row = await db.transaction().execute(async (trx) => {
        const inserted = await sql<Record<string, unknown>>`
     INSERT INTO cms_entries(kind,slug,title,excerpt,content,seo_title,seo_description,author_id,editor_id)
     VALUES(${kind},${x.slug},${x.title},${x.excerpt ?? null},
       ${JSON.stringify(x.content)}::jsonb,${x.seoTitle ?? null},${x.seoDescription ?? null},${actor},${actor})
     RETURNING *
    `.execute(trx);
        const saved = inserted.rows[0]!;
        if (x.markets.length)
          await trx
            .insertInto('cms_entry_markets')
            .values(x.markets.map((market_id) => ({ entry_id: String(saved.id), market_id })))
            .execute();
        await audit(trx, actor, 'cms.create', 'cms_entry', String(saved.id));
        return saved;
      });
      sendData(res, row, 201);
    });
    r.get(base + '/:id', async (req, res) => {
      permit(req, 'cms.read', 'cms.manage', 'cms.publish');
      const id = parseInput(z.uuid(), req.params.id);
      const rows = await sql<Record<string, unknown>>`
    SELECT e.*,COALESCE((SELECT jsonb_agg(market_id) FROM cms_entry_markets WHERE entry_id=e.id),'[]'::jsonb) AS markets
    FROM cms_entries e WHERE e.id=${id} AND e.kind=${kind} LIMIT 1
   `.execute(db);
      if (!rows.rows[0]) throw notFoundError;
      sendData(res, rows.rows[0]);
    });
    r.patch(base + '/:id', async (req, res) => {
      permit(req, 'cms.manage');
      const id = parseInput(z.uuid(), req.params.id),
        x = parseInput(patchSchema, req.body),
        actor = req.auth!.user.id;
      const row = await db.transaction().execute(async (trx) => {
        const before = await sql<
          Record<string, unknown>
        >` SELECT * FROM cms_entries WHERE id=${id} AND kind=${kind} FOR UPDATE `.execute(trx);
        if (!before.rows[0]) throw notFoundError;
        const old = before.rows[0];
        const updated = await sql<Record<string, unknown>>`
     UPDATE cms_entries SET slug=${x.slug ?? old.slug},title=${x.title ?? old.title},
      excerpt=${x.excerpt === undefined ? old.excerpt : x.excerpt},
      content=${JSON.stringify(x.content ?? old.content)}::jsonb,
      seo_title=${x.seoTitle === undefined ? old.seo_title : x.seoTitle},
      seo_description=${x.seoDescription === undefined ? old.seo_description : x.seoDescription},
      editor_id=${actor} WHERE id=${id} RETURNING *
    `.execute(trx);
        if (x.markets) {
          await trx.deleteFrom('cms_entry_markets').where('entry_id', '=', id).execute();
          if (x.markets.length)
            await trx
              .insertInto('cms_entry_markets')
              .values(x.markets.map((market_id) => ({ entry_id: id, market_id })))
              .execute();
        }
        await audit(trx, actor, 'cms.update', 'cms_entry', id);
        return updated.rows[0];
      });
      sendData(res, row);
    });
    for (const [action, status, published] of [
      ['publish', 'published', true],
      ['unpublish', 'draft', false]
    ] as const) {
      r.post(base + '/:id/' + action, async (req, res) => {
        permit(req, 'cms.publish');
        const id = parseInput(z.uuid(), req.params.id),
          actor = req.auth!.user.id;
        const row = await db.transaction().execute(async (trx) => {
          const updated = await sql<Record<string, unknown>>`
      UPDATE cms_entries SET status=${status},published_at=CASE WHEN ${published} THEN now() ELSE NULL END,editor_id=${actor}
      WHERE id=${id} AND kind=${kind} RETURNING *
     `.execute(trx);
          if (!updated.rows[0]) throw notFoundError;
          await audit(trx, actor, 'cms.' + action, 'cms_entry', id);
          return updated.rows[0];
        });
        sendData(res, row);
      });
    }
    r.delete(base + '/:id', async (req, res) => {
      permit(req, 'cms.manage');
      const id = parseInput(z.uuid(), req.params.id),
        actor = req.auth!.user.id;
      const row = await db.transaction().execute(async (trx) => {
        const updated = await sql<Record<string, unknown>>`
     UPDATE cms_entries SET status='archived',published_at=NULL,editor_id=${actor}
     WHERE id=${id} AND kind=${kind} RETURNING id,status
    `.execute(trx);
        if (!updated.rows[0]) throw notFoundError;
        await audit(trx, actor, 'cms.archive', 'cms_entry', id);
        return updated.rows[0];
      });
      sendData(res, row);
    });
  }
  return r;
}
