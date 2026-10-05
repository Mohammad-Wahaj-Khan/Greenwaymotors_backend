import { Kysely } from 'kysely';
import type { Environment } from '../../config/env.js';
import type { DB } from '../../generated/database.types.js';
export interface DatabaseHealth {
    ping(): Promise<void>;
    close(): Promise<void>;
}
export interface DatabaseConnection extends DatabaseHealth {
    db: Kysely<DB>;
}
export declare function createPostgresPool(environment: Environment): DatabaseConnection;
