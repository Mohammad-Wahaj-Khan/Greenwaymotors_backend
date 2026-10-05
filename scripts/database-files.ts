import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { Pool, PoolClient } from 'pg';

const backendRoot = fileURLToPath(new URL('../', import.meta.url));
const migrationDirectory = join(backendRoot, 'database', 'migrations');
const seedDirectory = join(backendRoot, 'database', 'seeds');

const schemaTables = [
  'countries',
  'users',
  'roles',
  'permissions',
  'role_permissions',
  'user_roles',
  'user_sessions',
  'user_tokens',
  'inventory_sources',
  'makes',
  'models',
  'body_types',
  'features',
  'vehicles',
  'vehicle_features',
  'vehicle_media',
  'favorites',
  'saved_searches',
  'leads',
  'lead_activities',
  'lead_followups',
  'notifications',
  'audit_logs'
] as const;

const legacyDealerTables = ['dealers', 'dealer_users', 'dealer_documents'] as const;

interface SqlFile {
  name: string;
  sql: string;
}

async function readSqlFiles(directory: string): Promise<SqlFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    names.map(async (name) => ({ name, sql: await readFile(join(directory, name), 'utf8') }))
  );
}

async function countExistingTables(client: PoolClient, names: readonly string[]): Promise<number> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT to_regclass('public.' || table_name) IS NOT NULL AS exists
     FROM unnest($1::text[]) AS table_name`,
    [names]
  );
  return result.rows.filter((row) => row.exists).length;
}

export async function initialSchemaState(
  client: PoolClient
): Promise<'absent' | 'complete' | 'partial'> {
  const existingTables = await countExistingTables(client, schemaTables);
  if (existingTables === 0) {
    return 'absent';
  }
  return existingTables === schemaTables.length ? 'complete' : 'partial';
}

async function isLegacyDealerSchema(client: PoolClient): Promise<boolean> {
  return (await countExistingTables(client, legacyDealerTables)) === legacyDealerTables.length;
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function applyMigration(client: PoolClient, migration: SqlFile): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(migration.sql);
    await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [migration.name]);
    await client.query('COMMIT');
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function applyInitialSchema(pool: Pool): Promise<boolean> {
  const client = await pool.connect();
  try {
    const migrations = await readSqlFiles(migrationDirectory);
    const initialMigration = migrations[0];
    if (!initialMigration) {
      throw new Error('Missing initial schema migration.');
    }

    await ensureMigrationTable(client);
    const applied = await client.query<{ name: string }>(`SELECT name FROM schema_migrations`);
    const appliedNames = new Set(applied.rows.map((row) => row.name));

    if (appliedNames.size === 0) {
      const state = await initialSchemaState(client);
      if (state === 'absent') {
        await applyMigration(client, initialMigration);
        appliedNames.add(initialMigration.name);
      } else if (state === 'complete') {
        await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [
          initialMigration.name
        ]);
        appliedNames.add(initialMigration.name);
      } else if (await isLegacyDealerSchema(client)) {
        await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [
          initialMigration.name
        ]);
        appliedNames.add(initialMigration.name);
      } else {
        throw new Error(
          'The Green Way Motors schema is only partially present. Resolve it manually before running migrations.'
        );
      }
    }

    let changed = false;
    for (const migration of migrations) {
      if (!appliedNames.has(migration.name)) {
        await applyMigration(client, migration);
        changed = true;
      }
    }
    return changed;
  } finally {
    client.release();
  }
}

export async function applySeeds(pool: Pool): Promise<void> {
  const seeds = await readSqlFiles(seedDirectory);
  if (seeds.length === 0) {
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      for (const seed of seeds) {
        await client.query(seed.sql);
      }
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    client.release();
  }
}
