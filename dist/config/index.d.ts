export { parseEnvironment, type Environment } from './env.js';
export declare function loadConfig(): {
    readonly environment: {
        NODE_ENV: "development" | "test" | "production";
        PORT: number;
        TRUST_PROXY_HOPS: number;
        DATABASE_URL: string;
        DATABASE_POOL_MAX: number;
        DATABASE_CONNECTION_TIMEOUT_MS: number;
        REDIS_URL: string;
        REDIS_REQUIRED: boolean;
        WEB_ORIGIN: string;
        COOKIE_DOMAIN: string;
        ACCESS_TOKEN_PRIVATE_KEY: string;
        ACCESS_TOKEN_PUBLIC_KEY: string;
        ACCESS_TOKEN_TTL_SECONDS: number;
        REFRESH_TOKEN_TTL_DAYS: number;
        S3_ENDPOINT: string;
        S3_REGION: string;
        S3_BUCKET: string;
        S3_ACCESS_KEY_ID: string;
        S3_SECRET_ACCESS_KEY: string;
        MAIL_FROM: string;
        MAIL_PROVIDER: string;
        SMTP_HOST: string;
        SMTP_PORT: number;
        LOG_LEVEL: "error" | "fatal" | "warn" | "info" | "debug" | "trace";
        DATA_ENCRYPTION_KEY?: string | undefined;
    };
    readonly app: {
        readonly environment: "development" | "test" | "production";
        readonly port: number;
        readonly webOrigin: string;
        readonly cookieDomain: string;
        readonly logLevel: "error" | "fatal" | "warn" | "info" | "debug" | "trace";
    };
    readonly auth: {
        readonly accessTokenPrivateKey: string;
        readonly accessTokenPublicKey: string;
        readonly accessTokenTtlSeconds: number;
        readonly refreshTokenTtlDays: number;
    };
    readonly database: {
        readonly url: string;
        readonly poolMax: number;
        readonly connectionTimeoutMs: number;
    };
    readonly redis: {
        readonly url: string;
        readonly required: boolean;
    };
    readonly storage: {
        readonly endpoint: string;
        readonly region: string;
        readonly bucket: string;
        readonly accessKeyId: string;
        readonly secretAccessKey: string;
    };
};
