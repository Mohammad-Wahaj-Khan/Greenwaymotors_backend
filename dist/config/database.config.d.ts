import type { Environment } from './env.js';
export declare function createDatabaseConfig(environment: Environment): {
    readonly url: string;
    readonly poolMax: number;
    readonly connectionTimeoutMs: number;
};
