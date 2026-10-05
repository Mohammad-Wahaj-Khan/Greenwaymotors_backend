import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { Environment } from '../../config/env.js';
import type { DB } from '../../generated/database.types.js';

export interface DatabaseHealth {
  ping(): Promise<void>;
  close(): Promise<void>;
}

export interface DatabaseConnection extends DatabaseHealth {
  db: Kysely<DB>;
}

export function createPostgresPool(environment: Environment): DatabaseConnection {
  const pool = new Pool({
    connectionString: environment.DATABASE_URL,
    max: environment.DATABASE_POOL_MAX,
    connectionTimeoutMillis: environment.DATABASE_CONNECTION_TIMEOUT_MS,
    statement_timeout: 30_000,
    query_timeout: 30_000
  });
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });

  return {
    db,
    async ping(): Promise<void> {
      await pool.query('SELECT 1');
    },
    async close(): Promise<void> {
      await db.destroy();
    }
  };
}
