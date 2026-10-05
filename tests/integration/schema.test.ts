import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { applyInitialSchema, applySeeds } from '../../scripts/database-files.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl ? describe : describe.skip;

function testPool(): Pool {
  if (!databaseUrl) {
    throw new Error('DATABASE_TEST_URL is required for database integration tests.');
  }

  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (!databaseName.endsWith('_test')) {
    throw new Error('DATABASE_TEST_URL must point to a database whose name ends in _test.');
  }

  return new Pool({ connectionString: databaseUrl, max: 1 });
}

const pool = databaseUrl ? testPool() : undefined;

function requirePool(): Pool {
  if (!pool) {
    throw new Error('Test database pool is unavailable.');
  }

  return pool;
}

async function insertVehicle(): Promise<{ vehicleId: string }> {
  const database = requirePool();
  const suffix = randomUUID();
  const country = await database.query<{ id: number }>(
    `INSERT INTO countries (iso2, iso3, name)
     VALUES ('ZZ', 'ZZZ', $1)
     RETURNING id`,
    [`Test Country ${suffix}`]
  );
  const countryId = country.rows[0]?.id;
  if (!countryId) {
    throw new Error('Failed to create test country.');
  }

  const make = await database.query<{ id: number }>(
    `INSERT INTO makes (name, slug) VALUES ($1, $2) RETURNING id`,
    [`Test Make ${suffix}`, `test-make-${suffix}`]
  );
  const makeId = make.rows[0]?.id;
  if (!makeId) {
    throw new Error('Failed to create test make.');
  }

  const model = await database.query<{ id: number }>(
    `INSERT INTO models (make_id, name, slug) VALUES ($1, $2, $3) RETURNING id`,
    [makeId, `Test Model ${suffix}`, `test-model-${suffix}`]
  );
  const modelId = model.rows[0]?.id;
  if (!modelId) {
    throw new Error('Failed to create test model.');
  }

  const vehicle = await database.query<{ id: string }>(
    `INSERT INTO vehicles (stock_number, vin, make_id, model_id, year, stock_country_id, title)
     VALUES ('stock-1', 'vin-1', $1, $2, 2024, $3, 'Schema test vehicle')
     RETURNING id`,
    [makeId, modelId, countryId]
  );
  const vehicleId = vehicle.rows[0]?.id;
  if (!vehicleId) {
    throw new Error('Failed to create test vehicle.');
  }

  return { vehicleId };
}

integration('initial SQL schema', () => {
  beforeEach(async () => {
    const database = requirePool();
    await database.query('DROP SCHEMA public CASCADE');
    await database.query('CREATE SCHEMA public');
    await applyInitialSchema(database);
    await applySeeds(database);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('creates the single-seller extensions, enum, and permission seed', async () => {
    const database = requirePool();
    const extensions = await database.query<{ extname: string }>(
      `SELECT extname FROM pg_extension WHERE extname IN ('citext', 'pgcrypto') ORDER BY extname`
    );
    const userTypes = await database.query<{ enumlabel: string }>(
      `SELECT enumlabel
       FROM pg_enum
       WHERE enumtypid = 'user_type'::regtype
       ORDER BY enumsortorder`
    );
    const permission = await database.query<{ code: string }>(
      `SELECT code FROM permissions WHERE code = 'lead.assign'`
    );

    expect(extensions.rows.map((row) => row.extname)).toEqual(['citext', 'pgcrypto']);
    expect(userTypes.rows.map((row) => row.enumlabel)).toEqual(['customer', 'staff']);
    expect(permission.rows).toHaveLength(1);
  });

  it('enforces case-insensitive unique user email', async () => {
    const database = requirePool();
    await database.query(
      `INSERT INTO users (user_type, email, password_hash, full_name)
       VALUES ('customer', 'customer@example.test', 'hash', 'Customer')`
    );

    await expect(
      database.query(
        `INSERT INTO users (user_type, email, password_hash, full_name)
         VALUES ('customer', 'CUSTOMER@EXAMPLE.TEST', 'hash', 'Another customer')`
      )
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('enforces global stock number and VIN uniqueness until a vehicle is soft deleted', async () => {
    const database = requirePool();
    const { vehicleId } = await insertVehicle();

    await expect(
      database.query(
        `INSERT INTO vehicles (stock_number, vin, make_id, model_id, year, stock_country_id, title)
         SELECT 'stock-1', 'vin-2', make_id, model_id, 2024, stock_country_id, 'Duplicate stock'
         FROM vehicles WHERE id = $1`,
        [vehicleId]
      )
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      database.query(
        `INSERT INTO vehicles (stock_number, vin, make_id, model_id, year, stock_country_id, title)
         SELECT 'stock-2', 'vin-1', make_id, model_id, 2024, stock_country_id, 'Duplicate VIN'
         FROM vehicles WHERE id = $1`,
        [vehicleId]
      )
    ).rejects.toMatchObject({ code: '23505' });

    await database.query(`UPDATE vehicles SET deleted_at = now() WHERE id = $1`, [vehicleId]);
    const replacement = await database.query<{ id: string }>(
      `INSERT INTO vehicles (stock_number, vin, make_id, model_id, year, stock_country_id, title)
       SELECT 'stock-1', 'vin-1', make_id, model_id, 2024, stock_country_id, 'Replacement vehicle'
       FROM vehicles WHERE id = $1
       RETURNING id`,
      [vehicleId]
    );

    expect(replacement.rows).toHaveLength(1);
  });

  it('keeps inventory sources internal and optional for a vehicle', async () => {
    const database = requirePool();
    const { vehicleId } = await insertVehicle();
    const source = await database.query<{ id: string }>(
      `INSERT INTO inventory_sources (company_name) VALUES ('Internal procurement source') RETURNING id`
    );
    const sourceId = source.rows[0]?.id;
    if (!sourceId) {
      throw new Error('Failed to create an inventory source.');
    }
    await database.query(`UPDATE vehicles SET inventory_source_id = $1 WHERE id = $2`, [
      sourceId,
      vehicleId
    ]);
    const vehicle = await database.query<{ inventory_source_id: string | null }>(
      `SELECT inventory_source_id FROM vehicles WHERE id = $1`,
      [vehicleId]
    );
    expect(vehicle.rows[0]?.inventory_source_id).toBe(sourceId);
  });

  it('allows only one primary media row for a vehicle', async () => {
    const database = requirePool();
    const { vehicleId } = await insertVehicle();

    await database.query(
      `INSERT INTO vehicle_media (vehicle_id, url, is_primary) VALUES ($1, 'https://example.test/one.jpg', true)`,
      [vehicleId]
    );
    await expect(
      database.query(
        `INSERT INTO vehicle_media (vehicle_id, url, is_primary) VALUES ($1, 'https://example.test/two.jpg', true)`,
        [vehicleId]
      )
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('updates updated_at through the supplied trigger', async () => {
    const database = requirePool();
    const inserted = await database.query<{ id: string; updated_at: Date }>(
      `INSERT INTO users (user_type, email, password_hash, full_name)
       VALUES ('customer', 'updated@example.test', 'hash', 'Before update')
       RETURNING id, updated_at`
    );
    const user = inserted.rows[0];
    if (!user) {
      throw new Error('Failed to create test user.');
    }

    await database.query('SELECT pg_sleep(0.01)');
    const updated = await database.query<{ updated_at: Date }>(
      `UPDATE users SET full_name = 'After update' WHERE id = $1 RETURNING updated_at`,
      [user.id]
    );

    expect(updated.rows[0]?.updated_at.getTime()).toBeGreaterThan(user.updated_at.getTime());
  });
});
