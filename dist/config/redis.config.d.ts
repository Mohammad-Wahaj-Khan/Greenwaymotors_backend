import type { Environment } from './env.js';
export declare function createRedisConfig(environment: Environment): {
    readonly url: string;
    readonly required: boolean;
};
