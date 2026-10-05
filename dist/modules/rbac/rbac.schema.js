import { z } from 'zod';
const roleName = z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z][a-z0-9_]*$/, 'Role names must use lowercase letters, numbers, and underscores.');
export const createRoleSchema = z
    .object({ name: roleName, description: z.string().trim().min(1).max(500).nullable().optional() })
    .strict();
export const updateRoleSchema = z
    .object({
    name: roleName.optional(),
    description: z.string().trim().min(1).max(500).nullable().optional()
})
    .strict()
    .refine((value) => Object.keys(value).length > 0, 'Provide at least one role field.');
export const replacePermissionsSchema = z
    .object({
    permissionIds: z
        .array(z.int().positive())
        .max(100)
        .refine((values) => new Set(values).size === values.length, 'Permission IDs must be unique.')
})
    .strict();
export const replaceUserRolesSchema = z
    .object({
    roleIds: z
        .array(z.int().positive())
        .max(50)
        .refine((values) => new Set(values).size === values.length, 'Role IDs must be unique.')
})
    .strict();
//# sourceMappingURL=rbac.schema.js.map