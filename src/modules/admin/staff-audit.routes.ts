import { Router } from 'express';
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { DB } from '../../generated/database.types.js';
import { hashPassword } from '../../core/auth/password.js';
import { audit } from '../../core/db/audit.js';
import { notFoundError } from '../../core/errors/app-error.js';
import { conflictError, forbiddenError, validationError } from '../../core/errors/http-errors.js';
import { parseInput, sendData } from '../../core/http/api-response.js';
import { requirePermission } from '../../middleware/authorize.middleware.js';

const uuid = z.uuid();
const paging = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  q: z.string().trim().max(100).optional()
});
const newStaff = z
  .object({
    email: z
      .email()
      .max(320)
      .transform((v) => v.toLowerCase()),
    fullName: z.string().trim().min(1).max(255),
    password: z.string().min(12).max(256),
    roleName: z
      .enum([
        'sales_agent',
        'content_manager',
        'inventory_manager',
        'sales_manager',
        'finance',
        'admin'
      ])
      .default('sales_agent')
  })
  .strict();
const patchStaff = z
  .object({
    fullName: z.string().trim().min(1).max(255).optional(),
    phone: z.string().trim().max(60).nullable().optional(),
    whatsapp: z.string().trim().max(60).nullable().optional(),
    city: z.string().trim().max(100).nullable().optional()
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0);
const auditQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
    actorId: z.uuid().optional(),
    action: z.string().trim().max(120).optional(),
    entityType: z.string().trim().max(100).optional(),
    entityId: z.string().trim().max(180).optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional()
  })
  .superRefine((v, c) => {
    if (v.from && v.to && Date.parse(v.from) >= Date.parse(v.to))
      c.addIssue({ code: 'custom', path: ['to'], message: 'to must follow from.' });
  });
function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (typeof value !== 'object' || value === null) return value;
  const entries = Object.entries(value).map(
    ([key, child]) =>
      [
        key,
        /password|secret|token|credential|cookie|authorization|private.?key/i.test(key)
          ? '[redacted]'
          : scrub(child)
      ] as const
  );
  return Object.fromEntries(entries);
}

export function createStaffManagementRouter(db: Kysely<DB>): Router {
  const r = Router();
  r.get('/users', async (req, res) => {
    const q = parseInput(paging, req.query),
      userType = typeof req.query.userType === 'string' ? req.query.userType : 'staff';
    if (userType === 'customer' && !req.auth!.permissions.has('customer.read'))
      throw forbiddenError();
    if (!['staff', 'customer'].includes(userType))
      throw validationError('userType must be staff or customer.');
    if (
      !req.auth!.permissions.has('staff.read') &&
      !(userType === 'customer' && req.auth!.permissions.has('customer.read'))
    )
      throw forbiddenError();
    const rows = await db
      .selectFrom('users')
      .select([
        'id',
        'user_type',
        'email',
        'full_name',
        'phone',
        'city',
        'status',
        'last_login_at',
        'created_at'
      ])
      .where('user_type', '=', userType as 'staff' | 'customer')
      .$if(Boolean(q.q), (eb) =>
        eb.where((eb) =>
          eb.or([eb('email', 'ilike', '%' + q.q + '%'), eb('full_name', 'ilike', '%' + q.q + '%')])
        )
      )
      .orderBy('created_at', 'desc')
      .limit(q.limit)
      .offset(q.offset)
      .execute();
    sendData(res, rows);
  });
  r.post('/staff', requirePermission('staff.manage'), async (req, res) => {
    const input = parseInput(newStaff, req.body);
    if (
      !req.auth!.permissions.has('rbac.manage') &&
      !['sales_agent', 'content_manager'].includes(input.roleName)
    )
      throw forbiddenError('This administrator cannot assign that staff role.');
    const passwordHash = await hashPassword(input.password);
    try {
      const row = await db.transaction().execute(async (trx) => {
        const user = await trx
          .insertInto('users')
          .values({
            user_type: 'staff',
            email: input.email,
            password_hash: passwordHash,
            full_name: input.fullName
          })
          .returning(['id', 'user_type', 'email', 'full_name', 'status', 'created_at'])
          .executeTakeFirstOrThrow();
        const role = await trx
          .selectFrom('roles')
          .select('id')
          .where('name', '=', input.roleName)
          .executeTakeFirst();
        if (!role) throw validationError('Configured staff role does not exist.');
        await trx.insertInto('user_roles').values({ user_id: user.id, role_id: role.id }).execute();
        await audit(trx, req.auth!.user.id, 'staff.create', 'user', user.id, {
          role: input.roleName
        });
        return user;
      });
      sendData(res, row, 201);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')
        throw conflictError('A user with this email already exists.');
      throw error;
    }
  });
  r.get('/staff/:userId', requirePermission('staff.read'), async (req, res) => {
    const id = parseInput(uuid, req.params.userId);
    const row = await db
      .selectFrom('users')
      .select([
        'id',
        'email',
        'full_name',
        'phone',
        'whatsapp',
        'city',
        'status',
        'last_login_at',
        'created_at',
        'updated_at'
      ])
      .where('id', '=', id)
      .where('user_type', '=', 'staff')
      .executeTakeFirst();
    if (!row) throw notFoundError;
    const roles = await db
      .selectFrom('user_roles')
      .innerJoin('roles', 'roles.id', 'user_roles.role_id')
      .select(['roles.id', 'roles.name', 'roles.description'])
      .where('user_id', '=', id)
      .execute();
    sendData(res, { ...row, roles });
  });
  r.patch('/staff/:userId', requirePermission('staff.manage'), async (req, res) => {
    const id = parseInput(uuid, req.params.userId),
      input = parseInput(patchStaff, req.body);
    const row = await db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('users')
        .set({
          ...(input.fullName === undefined ? {} : { full_name: input.fullName }),
          ...(input.phone === undefined ? {} : { phone: input.phone }),
          ...(input.whatsapp === undefined ? {} : { whatsapp: input.whatsapp }),
          ...(input.city === undefined ? {} : { city: input.city })
        })
        .where('id', '=', id)
        .where('user_type', '=', 'staff')
        .returning([
          'id',
          'email',
          'full_name',
          'phone',
          'whatsapp',
          'city',
          'status',
          'updated_at'
        ])
        .executeTakeFirst();
      if (!updated) throw notFoundError;
      await audit(trx, req.auth!.user.id, 'staff.update', 'user', id);
      return updated;
    });
    sendData(res, row);
  });
  r.post('/staff/:userId/suspend', requirePermission('staff.manage'), async (req, res) => {
    const id = parseInput(uuid, req.params.userId);
    if (id === req.auth!.user.id)
      throw conflictError('You cannot suspend your own active account.');
    await db.transaction().execute(async (trx) => {
      const row = await trx
        .updateTable('users')
        .set({ status: 'suspended' })
        .where('id', '=', id)
        .where('user_type', '=', 'staff')
        .returning('id')
        .executeTakeFirst();
      if (!row) throw notFoundError;
      await trx
        .updateTable('user_sessions')
        .set({ revoked_at: new Date() })
        .where('user_id', '=', id)
        .where('revoked_at', 'is', null)
        .execute();
      await audit(trx, req.auth!.user.id, 'staff.suspend', 'user', id);
    });
    sendData(res, { userId: id, status: 'suspended' });
  });
  r.post('/staff/:userId/activate', requirePermission('staff.manage'), async (req, res) => {
    const id = parseInput(uuid, req.params.userId);
    const row = await db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('users')
        .set({ status: 'active' })
        .where('id', '=', id)
        .where('user_type', '=', 'staff')
        .where('status', '<>', 'deleted')
        .returning(['id', 'status'])
        .executeTakeFirst();
      if (!updated) throw notFoundError;
      await audit(trx, req.auth!.user.id, 'staff.activate', 'user', id);
      return updated;
    });
    sendData(res, row);
  });
  r.get('/audit-logs', requirePermission('audit.read'), async (req, res) => {
    const q = parseInput(auditQuery, req.query);
    let query = db.selectFrom('audit_logs').selectAll();
    if (q.actorId) query = query.where('actor_id', '=', q.actorId);
    if (q.action) query = query.where('action', '=', q.action);
    if (q.entityType) query = query.where('entity_type', '=', q.entityType);
    if (q.entityId) query = query.where('entity_id', '=', q.entityId);
    if (q.from) query = query.where('created_at', '>=', new Date(q.from));
    if (q.to) query = query.where('created_at', '<', new Date(q.to));
    const rows = await query
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(q.limit)
      .offset(q.offset)
      .execute();
    sendData(
      res,
      rows.map((row) => ({ ...row, changes: scrub(row.changes) }))
    );
  });
  r.get('/audit-logs/:id', requirePermission('audit.read'), async (req, res) => {
    const id = req.params.id;
    if (typeof id !== 'string' || !/^[1-9][0-9]{0,15}$/.test(id))
      throw validationError('id must be a positive integer.');
    const row = await db
      .selectFrom('audit_logs')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw notFoundError;
    sendData(res, { ...row, changes: scrub(row.changes) });
  });
  return r;
}
