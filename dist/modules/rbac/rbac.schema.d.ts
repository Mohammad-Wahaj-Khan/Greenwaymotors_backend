import { z } from 'zod';
export declare const createRoleSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>;
export declare const updateRoleSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>;
export declare const replacePermissionsSchema: z.ZodObject<{
    permissionIds: z.ZodArray<z.ZodInt>;
}, z.core.$strict>;
export declare const replaceUserRolesSchema: z.ZodObject<{
    roleIds: z.ZodArray<z.ZodInt>;
}, z.core.$strict>;
