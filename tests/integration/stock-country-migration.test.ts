import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { applySeeds } from '../../scripts/database-files.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl ? describe : describe.skip;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 1 }) : undefined;
const migrationDirectory = fileURLToPath(new URL('../../database/migrations/', import.meta.url));

function requirePool() {
  if (!pool) throw new Error('DATABASE_TEST_URL is required.');
  return pool;
}

integration('stock-country migration', () => {
  beforeEach(async () => {
    const database = requirePool();
    await database.query('DROP SCHEMA public CASCADE');
    await database.query('CREATE SCHEMA public');
    await database.query(`
      CREATE TABLE schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    const files = (await readdir(migrationDirectory))
      .filter((name) => name.endsWith('.sql') && name < '015_stock_country_inventory.sql')
      .sort();
    for (const name of files) await database.query(await readFile(join(migrationDirectory, name), 'utf8'));
    await applySeeds(database);
  });

  afterAll(async () => pool?.end());

  it('archives legacy context, preserves featured state, and flags non-USD prices for review', async () => {
    const database = requirePool();
    const country = await database.query<{ id: number }>(
      "INSERT INTO countries (iso2,iso3,name) VALUES ('TH','THA','Thailand') RETURNING id"
    );
    const market = await database.query<{ id: string }>(
      `INSERT INTO markets (country_id,slug,status,currency_code,locale)
       VALUES ($1,'thailand','active','THB','th-TH') RETURNING id`,
      [country.rows[0]!.id]
    );
    const make = await database.query<{ id: number }>(
      "INSERT INTO makes(name,slug) VALUES ('Toyota','toyota') RETURNING id"
    );
    const model = await database.query<{ id: number }>(
      "INSERT INTO models(make_id,name,slug) VALUES ($1,'Camry','camry') RETURNING id",
      [make.rows[0]!.id]
    );
    const vehicle = await database.query<{ id: string }>(
      `INSERT INTO vehicles(make_id,model_id,year,stock_country_id,title)
       VALUES ($1,$2,2024,$3,'Camry') RETURNING id`,
      [make.rows[0]!.id, model.rows[0]!.id, country.rows[0]!.id]
    );
    await database.query(
      'INSERT INTO vehicle_markets(vehicle_id,market_id,is_active,featured,priority) VALUES ($1,$2,true,true,7)',
      [vehicle.rows[0]!.id, market.rows[0]!.id]
    );
    await database.query(
      `INSERT INTO vehicle_market_pricing(vehicle_id,market_id,currency_code,asking_price_minor,minimum_sale_price_minor)
       VALUES ($1,$2,'THB',42000000,40000000)`,
      [vehicle.rows[0]!.id, market.rows[0]!.id]
    );
    const staff = await database.query<{ id: string }>(
      "INSERT INTO users(user_type,email,password_hash,full_name) VALUES ('staff','migration-sales@example.test','hash','Sales') RETURNING id"
    );
    const lead = await database.query<{ id: string }>(
      `INSERT INTO leads(vehicle_id,market_id,vehicle_snapshot,contact_name,contact_email)
       VALUES ($1,$2,'{}'::jsonb,'Buyer','migration-buyer@example.test') RETURNING id`,
      [vehicle.rows[0]!.id, market.rows[0]!.id]
    );
    const deal = await database.query<{ id: string }>(
      `INSERT INTO deals(lead_id,vehicle_id,market_id,owner_salesperson_id,agreed_amount_minor,currency_code)
       VALUES ($1,$2,$3,$4,42000000,'THB') RETURNING id`,
      [lead.rows[0]!.id, vehicle.rows[0]!.id, market.rows[0]!.id, staff.rows[0]!.id]
    );
    await database.query(
      'UPDATE deals SET market_snapshot=$1::jsonb WHERE id=$2',
      [JSON.stringify({ slug: 'thailand' }), deal.rows[0]!.id]
    );
    await database.query(
      "INSERT INTO permissions(code,description) VALUES ('market.manage','legacy test permission')"
    );
    await database.query(
      `INSERT INTO role_permissions(role_id,permission_id)
       SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
       WHERE r.name='super_admin' AND p.code='market.manage'`
    );

    await database.query(
      await readFile(join(migrationDirectory, '015_stock_country_inventory.sql'), 'utf8')
    );

    const result = await database.query<{
      asking_price: string | null;
      is_featured: boolean;
      feature_priority: number;
      lead_country: number;
      deal_country: number;
      review_reason: string;
      legacy_price_currency: string;
      archived_deal_slug: string;
    }>(
      `SELECT v.trade_price_minor::text AS asking_price,v.is_featured,v.feature_priority,
        l.stock_country_id AS lead_country,d.stock_country_id AS deal_country,
        r.reason AS review_reason,p.currency_code AS legacy_price_currency,
        dc.market_snapshot->>'slug' AS archived_deal_slug
       FROM vehicles v JOIN leads l ON l.vehicle_id=v.id JOIN deals d ON d.lead_id=l.id
       JOIN vehicle_price_migration_review r ON r.vehicle_id=v.id
       JOIN legacy_vehicle_market_pricing p ON p.vehicle_id=v.id
       JOIN legacy_deal_market_context dc ON dc.deal_id=d.id
       WHERE v.id=$1`,
      [vehicle.rows[0]!.id]
    );
    expect(result.rows[0]).toMatchObject({
      asking_price: null,
      is_featured: true,
      feature_priority: 7,
      lead_country: country.rows[0]!.id,
      deal_country: country.rows[0]!.id,
      review_reason: 'non_usd_currency_requires_manual_entry',
      legacy_price_currency: 'THB',
      archived_deal_slug: 'thailand'
    });
    const tables = await database.query<{ markets: string | null; eligibility: string | null }>(
      `SELECT to_regclass('public.markets')::text AS markets,
        to_regclass('public.vehicle_markets')::text AS eligibility`
    );
    expect(tables.rows[0]).toEqual({ markets: null, eligibility: null });
    const permission = await database.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM permissions WHERE code='market.manage'"
    );
    expect(permission.rows[0]!.count).toBe(0);
  });
});
