import { Pool } from 'pg';
import { loadEnvironment } from '../src/config/env.js';
import { applyInitialSchema, applySeeds } from './database-files.js';

const environment = loadEnvironment();
const pool = new Pool({
  connectionString: environment.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: environment.DATABASE_CONNECTION_TIMEOUT_MS
});

try {
  const applied = await applyInitialSchema(pool);
  await applySeeds(pool);
  process.stdout.write(
    applied
      ? 'Database migrations and seeds applied.\n'
      : 'Database schema is current; seeds applied.\n'
  );
} finally {
  await pool.end();
}
