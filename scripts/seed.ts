import { Pool } from 'pg';
import { loadEnvironment } from '../src/config/env.js';
import { applySeeds, initialSchemaState } from './database-files.js';

const environment = loadEnvironment();
const pool = new Pool({
  connectionString: environment.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: environment.DATABASE_CONNECTION_TIMEOUT_MS
});

try {
  const client = await pool.connect();
  try {
    if ((await initialSchemaState(client)) !== 'complete') {
      throw new Error('Apply the initial schema before running seeds.');
    }
  } finally {
    client.release();
  }

  await applySeeds(pool);
  process.stdout.write('Seeds applied.\n');
} finally {
  await pool.end();
}
