import type { Environment } from '../../config/env.js';
export interface DatabaseHealth {
    ping(): Promise<void>;
    close(): Promise<void>;
}
export declare function createPostgresPool(environment: Environment): DatabaseHealth;
