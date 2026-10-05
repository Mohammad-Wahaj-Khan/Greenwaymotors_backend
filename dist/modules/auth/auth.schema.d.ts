import { z } from 'zod';
export declare const registerCustomerSchema: z.ZodObject<{
    email: z.ZodEmail;
    password: z.ZodString;
    fullName: z.ZodString;
    phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    whatsapp: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    countryId: z.ZodOptional<z.ZodNullable<z.ZodInt>>;
    city: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    preferredContact: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
        email: "email";
        phone: "phone";
        whatsapp: "whatsapp";
    }>>>;
}, z.core.$strict>;
export declare const loginSchema: z.ZodObject<{
    email: z.ZodEmail;
    password: z.ZodString;
}, z.core.$strict>;
export declare const emailSchema: z.ZodObject<{
    email: z.ZodEmail;
}, z.core.$strict>;
export declare const tokenSchema: z.ZodObject<{
    token: z.ZodString;
}, z.core.$strict>;
export declare const mfaChallengeSchema: z.ZodObject<{
    challengeToken: z.ZodString;
    code: z.ZodString;
}, z.core.$strict>;
export declare const mfaCodeSchema: z.ZodObject<{
    code: z.ZodString;
}, z.core.$strict>;
export declare const resetPasswordSchema: z.ZodObject<{
    token: z.ZodString;
    newPassword: z.ZodString;
}, z.core.$strict>;
export declare const changePasswordSchema: z.ZodObject<{
    currentPassword: z.ZodString;
    newPassword: z.ZodString;
}, z.core.$strict>;
export declare const updateProfileSchema: z.ZodObject<{
    fullName: z.ZodOptional<z.ZodString>;
    phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    whatsapp: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    countryId: z.ZodOptional<z.ZodNullable<z.ZodInt>>;
    city: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    preferredContact: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
        email: "email";
        phone: "phone";
        whatsapp: "whatsapp";
    }>>>;
}, z.core.$strict>;
export type RegisterCustomerInput = z.infer<typeof registerCustomerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
