import { z } from 'zod';
declare const environmentSchema: z.ZodObject<{
    NODE_ENV: z.ZodDefault<z.ZodEnum<{
        development: "development";
        test: "test";
        production: "production";
    }>>;
    PORT: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    TRUST_PROXY_HOPS: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    DATABASE_URL: z.ZodURL;
    DATABASE_POOL_MAX: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    DATABASE_CONNECTION_TIMEOUT_MS: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    REDIS_URL: z.ZodURL;
    REDIS_REQUIRED: z.ZodDefault<z.ZodPipe<z.ZodEnum<{
        true: "true";
        false: "false";
    }>, z.ZodTransform<boolean, "true" | "false">>>;
    WEB_ORIGIN: z.ZodURL;
    COOKIE_DOMAIN: z.ZodString;
    ACCESS_TOKEN_PRIVATE_KEY: z.ZodString;
    ACCESS_TOKEN_PUBLIC_KEY: z.ZodString;
    ACCESS_TOKEN_TTL_SECONDS: z.ZodCoercedNumber<unknown>;
    REFRESH_TOKEN_TTL_DAYS: z.ZodCoercedNumber<unknown>;
    S3_ENDPOINT: z.ZodURL;
    S3_REGION: z.ZodString;
    S3_BUCKET: z.ZodString;
    S3_ACCESS_KEY_ID: z.ZodString;
    S3_SECRET_ACCESS_KEY: z.ZodString;
    MAIL_FROM: z.ZodEmail;
    MAIL_PROVIDER: z.ZodString;
    SMTP_HOST: z.ZodDefault<z.ZodString>;
    SMTP_PORT: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    LOG_LEVEL: z.ZodDefault<z.ZodEnum<{
        error: "error";
        fatal: "fatal";
        warn: "warn";
        info: "info";
        debug: "debug";
        trace: "trace";
    }>>;
}, z.core.$strip>;
export type Environment = z.infer<typeof environmentSchema>;
export declare function parseEnvironment(source: Record<string, string | undefined>): Environment;
export declare function loadEnvironment(): Environment;
export {};
