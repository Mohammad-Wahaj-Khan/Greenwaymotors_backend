import { Router } from 'express';
import { validationError } from '../../core/errors/http-errors.js';
import { getRequestContext } from '../../core/http/request-context.js';
import { validateBody } from '../../middleware/validate.middleware.js';
import { createRoleSchema, replacePermissionsSchema, replaceUserRolesSchema, updateRoleSchema } from './rbac.schema.js';
import { RbacService } from './rbac.service.js';
function parseId(value) {
    const id = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw validationError('The identifier must be a positive integer.');
    }
    return id;
}
function parseUuid(value) {
    if (typeof value !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
        throw validationError('The user identifier must be a UUID.');
    }
    return value;
}
export function createRbacRouter(database) {
    const router = Router();
    const service = new RbacService(database.db);
    const audit = (request) => ({
        actorId: request.auth.user.id,
        ...(request.ip ? { ipAddress: request.ip } : {})
    });
    router.get('/roles', async (_request, response) => response.json({
        data: await service.listRoles(),
        meta: { requestId: getRequestContext()?.requestId }
    }));
    router.post('/roles', validateBody(createRoleSchema), async (request, response) => {
        const role = await service.createRole(request.body, { ...audit(request), action: 'rbac.role.create', entityType: 'role' });
        response.status(201).json({ data: role, meta: { requestId: getRequestContext()?.requestId } });
    });
    router.patch('/roles/:id', validateBody(updateRoleSchema), async (request, response) => {
        const role = await service.updateRole(parseId(request.params.id), request.body, { ...audit(request), action: 'rbac.role.update', entityType: 'role' });
        response.json({ data: role, meta: { requestId: getRequestContext()?.requestId } });
    });
    router.get('/permissions', async (_request, response) => response.json({
        data: await service.listPermissions(),
        meta: { requestId: getRequestContext()?.requestId }
    }));
    router.put('/roles/:id/permissions', validateBody(replacePermissionsSchema), async (request, response) => {
        await service.replaceRolePermissions(parseId(request.params.id), request.body.permissionIds, { ...audit(request), action: 'rbac.role_permissions.replace', entityType: 'role' });
        response.status(204).end();
    });
    router.put('/users/:userId/roles', validateBody(replaceUserRolesSchema), async (request, response) => {
        await service.replaceUserRoles(parseUuid(request.params.userId), request.body.roleIds, { ...audit(request), action: 'rbac.user_roles.replace', entityType: 'user' });
        response.status(204).end();
    });
    return router;
}
//# sourceMappingURL=rbac.routes.js.map