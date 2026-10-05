import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../../generated/database.types.js';
export declare function withTransaction<T>(database: Kysely<DB>, operation: (transaction: Transaction<DB>) => Promise<T>): Promise<T>;
