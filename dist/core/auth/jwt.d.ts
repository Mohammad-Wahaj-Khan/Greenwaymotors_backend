import type { Environment } from '../../config/env.js';
export interface AccessTokenClaims {
    subject: string;
    type: 'access';
    mfaSatisfied: boolean;
}
export declare function createAccessTokenService(environment: Environment): {
    readonly issue: (subject: string, mfaSatisfied?: boolean) => Promise<string>;
    readonly verify: (token: string) => Promise<AccessTokenClaims>;
};
