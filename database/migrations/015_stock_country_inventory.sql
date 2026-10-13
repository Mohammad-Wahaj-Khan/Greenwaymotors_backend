-- Replace destination-market inventory with stock-country inventory and one USD price per vehicle.
-- Keep an immutable copy of the old market configuration/prices for review and data recovery.
CREATE TABLE legacy_market_configuration AS
SELECT m.*, c.iso2 AS country_iso2, c.iso3 AS country_iso3, c.name AS country_name
FROM markets m JOIN countries c ON c.id = m.country_id;
ALTER TABLE legacy_market_configuration ALTER COLUMN status TYPE TEXT USING status::text;

CREATE TABLE legacy_vehicle_market_eligibility AS
SELECT vm.*, m.slug AS market_slug, m.country_id, c.iso2 AS country_iso2, c.name AS country_name
FROM vehicle_markets vm JOIN markets m ON m.id = vm.market_id
JOIN countries c ON c.id = m.country_id;

CREATE TABLE legacy_vehicle_market_pricing AS
SELECT vmp.*, m.slug AS market_slug, m.country_id, c.iso2 AS country_iso2, c.name AS country_name
FROM vehicle_market_pricing vmp JOIN markets m ON m.id = vmp.market_id
JOIN countries c ON c.id = m.country_id;

CREATE TABLE legacy_cms_market_targets AS
SELECT em.entry_id, em.market_id, m.slug AS market_slug, m.country_id,
       c.iso2 AS country_iso2, c.name AS country_name
FROM cms_entry_markets em JOIN markets m ON m.id = em.market_id
JOIN countries c ON c.id = m.country_id;

CREATE TABLE legacy_lead_market_context AS
SELECT l.id AS lead_id, l.market_id, m.slug AS market_slug, m.country_id,
       c.iso2 AS country_iso2, c.name AS country_name
FROM leads l LEFT JOIN markets m ON m.id = l.market_id
LEFT JOIN countries c ON c.id = m.country_id WHERE l.market_id IS NOT NULL;

CREATE TABLE legacy_deal_market_context AS
SELECT d.id AS deal_id, d.market_id, d.market_snapshot,
       m.slug AS market_slug, m.country_id, c.iso2 AS country_iso2, c.name AS country_name
FROM deals d LEFT JOIN markets m ON m.id = d.market_id
LEFT JOIN countries c ON c.id = m.country_id;

ALTER TABLE vehicles
  ADD COLUMN trade_price_minor BIGINT CHECK (trade_price_minor >= 0),
  ADD COLUMN available_discount_minor BIGINT CHECK (available_discount_minor >= 0),
  ADD COLUMN minimum_sale_price_minor BIGINT CHECK (minimum_sale_price_minor >= 0),
  ADD COLUMN price_currency_code CHAR(3) NOT NULL DEFAULT 'USD'
    CHECK (price_currency_code = 'USD'),
  ADD COLUMN is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN feature_priority INTEGER NOT NULL DEFAULT 0 CHECK (feature_priority >= 0),
  ADD CONSTRAINT vehicle_discount_not_above_price CHECK (
    available_discount_minor IS NULL OR trade_price_minor IS NULL OR available_discount_minor <= trade_price_minor
  ),
  ADD CONSTRAINT vehicle_floor_not_above_price CHECK (
    minimum_sale_price_minor IS NULL OR trade_price_minor IS NULL OR minimum_sale_price_minor <= trade_price_minor
  );

-- Preserve legacy featured inventory as a single global display flag.
UPDATE vehicles v SET
  is_featured = featured.is_featured,
  feature_priority = featured.feature_priority
FROM (
  SELECT vehicle_id,
         bool_or(featured) AS is_featured,
         COALESCE(min(priority) FILTER (WHERE featured), 0) AS feature_priority
  FROM vehicle_markets GROUP BY vehicle_id
) featured
WHERE featured.vehicle_id = v.id;

-- Only collapse legacy prices automatically when all configured markets used USD and agreed on
-- the exact same values. Ambiguous/non-USD values remain available in legacy_vehicle_market_pricing.
WITH unambiguous_usd AS (
  SELECT vehicle_id,
         min(asking_price_minor) AS asking_price_minor,
         min(available_discount_minor) AS available_discount_minor,
         min(minimum_sale_price_minor) AS minimum_sale_price_minor
  FROM vehicle_market_pricing
  GROUP BY vehicle_id
  HAVING bool_and(currency_code = 'USD')
     AND count(DISTINCT (asking_price_minor, available_discount_minor, minimum_sale_price_minor)) = 1
)
UPDATE vehicles v SET
  trade_price_minor = p.asking_price_minor,
  available_discount_minor = p.available_discount_minor,
  minimum_sale_price_minor = p.minimum_sale_price_minor
FROM unambiguous_usd p WHERE p.vehicle_id = v.id;

CREATE TABLE vehicle_price_migration_review (
  vehicle_id UUID PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  legacy_price_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO vehicle_price_migration_review(vehicle_id, reason, legacy_price_count)
SELECT vmp.vehicle_id,
       CASE WHEN count(DISTINCT vmp.currency_code) > 1 THEN 'multiple_currencies'
            WHEN bool_and(vmp.currency_code = 'USD') THEN 'conflicting_market_prices'
            ELSE 'non_usd_currency_requires_manual_entry' END,
       count(*)::integer
FROM vehicle_market_pricing vmp
GROUP BY vmp.vehicle_id
HAVING NOT (bool_and(vmp.currency_code = 'USD')
            AND count(DISTINCT (vmp.asking_price_minor, vmp.available_discount_minor, vmp.minimum_sale_price_minor)) = 1);

ALTER TABLE leads ADD COLUMN stock_country_id SMALLINT REFERENCES countries(id);
UPDATE leads l SET stock_country_id = v.stock_country_id FROM vehicles v WHERE v.id = l.vehicle_id;
UPDATE leads SET vehicle_snapshot = (COALESCE(vehicle_snapshot, '{}'::jsonb) - 'marketSlug') ||
  jsonb_build_object('stockCountryId', stock_country_id)
WHERE vehicle_id IS NOT NULL;
CREATE INDEX idx_leads_stock_country_created ON leads (stock_country_id, created_at DESC);

ALTER TABLE deals ADD COLUMN stock_country_id SMALLINT REFERENCES countries(id);
UPDATE deals d SET stock_country_id = country.stock_country_id
FROM (
  SELECT d2.id, COALESCE(l.stock_country_id, v.stock_country_id) AS stock_country_id
  FROM deals d2 JOIN vehicles v ON v.id = d2.vehicle_id
  LEFT JOIN leads l ON l.id = d2.lead_id
) country WHERE country.id = d.id;
ALTER TABLE deals ALTER COLUMN stock_country_id SET NOT NULL;
CREATE INDEX idx_deals_stock_country_created ON deals (stock_country_id, created_at DESC);

ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_snapshot_required_after_conversion;
DROP TABLE cms_entry_markets;
ALTER TABLE leads DROP COLUMN market_id;
ALTER TABLE deals DROP COLUMN market_id, DROP COLUMN market_snapshot;
ALTER TABLE deals ADD CONSTRAINT deals_snapshot_required_after_conversion CHECK (
  accepted_quote_id IS NULL OR (
    customer_snapshot IS NOT NULL AND salesperson_snapshot IS NOT NULL AND vehicle_snapshot IS NOT NULL
  )
) NOT VALID;
DROP TABLE vehicle_market_pricing;
DROP TABLE vehicle_markets;
DROP TABLE markets;
DROP TYPE market_status;

DELETE FROM role_permissions rp USING permissions p
WHERE rp.permission_id = p.id AND p.code IN (
  'market.read', 'market.manage', 'vehicle_market.manage'
);
DELETE FROM permissions WHERE code IN (
  'market.read', 'market.manage', 'vehicle_market.manage'
);
