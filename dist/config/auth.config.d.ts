import type { Environment } from './env.js';
export declare function createAuthConfig(environment: Environment): {
    readonly accessTokenPrivateKey: string;
    readonly accessTokenPublicKey: string;
    readonly accessTokenTtlSeconds: number;
    readonly refreshTokenTtlDays: number;
};
