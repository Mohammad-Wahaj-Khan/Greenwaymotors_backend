import { z } from 'zod';
const optionalString = z.string().trim().min(1).max(255).nullable().optional();
const contactMethod = z.enum(['email', 'phone', 'whatsapp']);
export const registerCustomerSchema = z
    .object({
    email: z.email().max(320),
    password: z.string().min(10).max(256),
    fullName: z.string().trim().min(1).max(255),
    phone: optionalString,
    whatsapp: optionalString,
    countryId: z.int().positive().nullable().optional(),
    city: optionalString,
    preferredContact: contactMethod.nullable().optional()
})
    .strict();
export const loginSchema = z
    .object({ email: z.email().max(320), password: z.string().min(1).max(256) })
    .strict();
export const emailSchema = z.object({ email: z.email().max(320) }).strict();
export const tokenSchema = z.object({ token: z.string().min(32).max(512) }).strict();
export const resetPasswordSchema = tokenSchema
    .extend({ newPassword: z.string().min(10).max(256) })
    .strict();
export const updateProfileSchema = z
    .object({
    fullName: z.string().trim().min(1).max(255).optional(),
    phone: optionalString,
    whatsapp: optionalString,
    countryId: z.int().positive().nullable().optional(),
    city: optionalString,
    preferredContact: contactMethod.nullable().optional()
})
    .strict()
    .refine((value) => Object.keys(value).length > 0, 'Provide at least one profile field.');
//# sourceMappingURL=auth.schema.js.map