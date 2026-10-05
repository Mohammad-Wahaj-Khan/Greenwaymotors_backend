import { conflictError, validationError } from '../../core/errors/http-errors.js';
function isUniqueViolation(error) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
export class RbacService {
    database;
    constructor(database) {
        this.database = database;
    }
    async listRoles() {
        const roles = await this.database.selectFrom('roles').selectAll().orderBy('name').execute();
        const permissions = await this.database
            .selectFrom('role_permissions')
            .innerJoin('permissions', 'permissions.id', 'role_permissions.permission_id')
            .select([
            'role_permissions.role_id',
            'permissions.id',
            'permissions.code',
            'permissions.description'
        ])
            .orderBy('permissions.code')
            .execute();
        return roles.map((role) => ({
            id: role.id,
            name: role.name,
            description: role.description,
            permissions: permissions
                .filter((permission) => permission.role_id === role.id)
                .map(({ id, code, description }) => ({ id, code, description }))
        }));
    }
    async listPermissions() {
        return this.database.selectFrom('permissions').selectAll().orderBy('code').execute();
    }
    async createRole(input, audit) {
        try {
            return await this.database.transaction().execute(async (transaction) => {
                const role = await transaction
                    .insertInto('roles')
                    .values({ name: input.name, description: input.description ?? null })
                    .returningAll()
                    .executeTakeFirstOrThrow();
                await this.writeAudit(transaction, {
                    ...audit,
                    entityId: String(role.id),
                    changes: { after: role }
                });
                return role;
            });
        }
        catch (error) {
            if (isUniqueViolation(error)) {
                throw conflictError('A role with this name already exists.');
            }
            throw error;
        }
    }
    async updateRole(roleId, input, audit) {
        try {
            return await this.database.transaction().execute(async (transaction) => {
                const before = await transaction
                    .selectFrom('roles')
                    .selectAll()
                    .where('id', '=', roleId)
                    .executeTakeFirst();
                if (!before) {
                    throw validationError('The role does not exist.');
                }
                const values = {
                    ...(input.name === undefined ? {} : { name: input.name }),
                    ...(input.description === undefined ? {} : { description: input.description })
                };
                const role = await transaction
                    .updateTable('roles')
                    .set(values)
                    .where('id', '=', roleId)
                    .returningAll()
                    .executeTakeFirstOrThrow();
                await this.writeAudit(transaction, {
                    ...audit,
                    entityId: String(role.id),
                    changes: { before, after: role }
                });
                return role;
            });
        }
        catch (error) {
            if (isUniqueViolation(error)) {
                throw conflictError('A role with this name already exists.');
            }
            throw error;
        }
    }
    async replaceRolePermissions(roleId, permissionIds, audit) {
        await this.database.transaction().execute(async (transaction) => {
            const role = await transaction
                .selectFrom('roles')
                .select('id')
                .where('id', '=', roleId)
                .executeTakeFirst();
            if (!role) {
                throw validationError('The role does not exist.');
            }
            if (permissionIds.length > 0) {
                const found = await transaction
                    .selectFrom('permissions')
                    .select('id')
                    .where('id', 'in', permissionIds)
                    .execute();
                if (found.length !== permissionIds.length) {
                    throw validationError('One or more permissions do not exist.');
                }
            }
            const before = await transaction
                .selectFrom('role_permissions')
                .select('permission_id')
                .where('role_id', '=', roleId)
                .execute();
            await transaction.deleteFrom('role_permissions').where('role_id', '=', roleId).execute();
            if (permissionIds.length > 0) {
                await transaction
                    .insertInto('role_permissions')
                    .values(permissionIds.map((permissionId) => ({ role_id: roleId, permission_id: permissionId })))
                    .execute();
            }
            await this.writeAudit(transaction, {
                ...audit,
                entityId: String(roleId),
                changes: {
                    beforePermissionIds: before.map((row) => row.permission_id),
                    afterPermissionIds: permissionIds
                }
            });
        });
    }
    async replaceUserRoles(userId, roleIds, audit) {
        await this.database.transaction().execute(async (transaction) => {
            const user = await transaction
                .selectFrom('users')
                .select(['id', 'user_type'])
                .where('id', '=', userId)
                .executeTakeFirst();
            if (!user || user.user_type !== 'staff') {
                throw validationError('Roles can only be assigned to an existing staff user.');
            }
            if (roleIds.length > 0) {
                const found = await transaction
                    .selectFrom('roles')
                    .select('id')
                    .where('id', 'in', roleIds)
                    .execute();
                if (found.length !== roleIds.length) {
                    throw validationError('One or more roles do not exist.');
                }
            }
            const before = await transaction
                .selectFrom('user_roles')
                .select('role_id')
                .where('user_id', '=', userId)
                .execute();
            await transaction.deleteFrom('user_roles').where('user_id', '=', userId).execute();
            if (roleIds.length > 0) {
                await transaction
                    .insertInto('user_roles')
                    .values(roleIds.map((roleId) => ({ user_id: userId, role_id: roleId })))
                    .execute();
            }
            await this.writeAudit(transaction, {
                ...audit,
                entityId: userId,
                changes: { beforeRoleIds: before.map((row) => row.role_id), afterRoleIds: roleIds }
            });
        });
    }
    async writeAudit(database, input) {
        await database
            .insertInto('audit_logs')
            .values({
            actor_id: input.actorId,
            action: input.action,
            entity_type: input.entityType,
            entity_id: input.entityId,
            changes: input.changes,
            ip_address: input.ipAddress ?? null
        })
            .execute();
    }
}
//# sourceMappingURL=rbac.service.js.map