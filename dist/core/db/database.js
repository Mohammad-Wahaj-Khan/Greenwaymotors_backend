import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
export function createPostgresPool(environment) {
    const pool = new Pool({
        connectionString: environment.DATABASE_URL,
        max: environment.DATABASE_POOL_MAX,
        connectionTimeoutMillis: environment.DATABASE_CONNECTION_TIMEOUT_MS,
        statement_timeout: 30_000,
        query_timeout: 30_000
    });
    const db = new Kysely({ dialect: new PostgresDialect({ pool }) });
    return {
        db,
        async ping() {
            await pool.query('SELECT 1');
        },
        async close() {
            await db.destroy();
        }
    };
}
//# sourceMappingURL=database.js.map