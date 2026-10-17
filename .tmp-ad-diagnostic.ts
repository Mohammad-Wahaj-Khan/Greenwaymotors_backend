import './src/config/env.js';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

try {
  const result = await pool.query(`
    SELECT
      to_regclass('public.advertisements') AS advertisements,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'upload_intents'
          AND column_name = 'purpose'
      ) AS upload_intents_present,
      COALESCE((SELECT json_agg(name ORDER BY name) FROM schema_migrations), '[]'::json) AS migrations
  `);
  process.stdout.write(`${JSON.stringify(result.rows[0])}\n`);
} finally {
  await pool.end();
}
