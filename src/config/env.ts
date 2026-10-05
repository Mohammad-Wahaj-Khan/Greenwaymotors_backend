import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const booleanFromEnvironment = z.enum(['true', 'false']).transform((value) => value === 'true');

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    DATABASE_URL: z.url(),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5000),
    REDIS_URL: z.url(),
    REDIS_REQUIRED: booleanFromEnvironment.default(false),
    WEB_ORIGIN: z.url(),
    COOKIE_DOMAIN: z.string().min(1),
    ACCESS_TOKEN_PRIVATE_KEY: z.string().min(32),
    ACCESS_TOKEN_PUBLIC_KEY: z.string().min(32),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive(),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive(),
    S3_ENDPOINT: z.url(),
    S3_REGION: z.string().min(1),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    MAIL_FROM: z.email(),
    MAIL_PROVIDER: z.string().min(1),
    SMTP_HOST: z.string().min(1).default('127.0.0.1'),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(1025),
    DATA_ENCRYPTION_KEY: z.string().min(32).optional(),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info')
  })
  .superRefine((environment, context) => {
    if (environment.NODE_ENV === 'production' && !environment.DATA_ENCRYPTION_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['DATA_ENCRYPTION_KEY'],
        message: 'Sensitive outbox payload encryption key is required in production.'
      });
    }
    if (environment.NODE_ENV === 'production' && !environment.REDIS_REQUIRED) {
      context.addIssue({
        code: 'custom',
        path: ['REDIS_REQUIRED'],
        message: 'Redis is required in production for shared rate limiting.'
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(source: Record<string, string | undefined>): Environment {
  return environmentSchema.parse(source);
}

export function loadEnvironment(): Environment {
  return parseEnvironment(process.env);
}
