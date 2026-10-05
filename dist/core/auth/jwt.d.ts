import type { Environment } from '../../config/env.js';
export interface AccessTokenClaims {
    subject: string;
    type: 'access';
}
export declare function createAccessTokenService(environment: Environment): {
    readonly issue: (subject: string) => Promise<string>;
    readonly verify: (token: string) => Promise<AccessTokenClaims>;
};
