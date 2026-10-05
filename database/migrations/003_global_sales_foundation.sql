-- Foundation for destination markets and separate commercial records.
-- Existing migration history remains intact. No market is enabled implicitly.
CREATE TYPE market_status AS ENUM ('active', 'inactive');
CREATE TYPE vehicle_availability_status AS ENUM ('available', 'reserved', 'sourcing_hold', 'sold', 'unavailable');
CREATE TYPE quote_status AS ENUM ('draft', 'sent', 'accepted', 'rejected', 'expired', 'superseded', 'cancelled');
CREATE TYPE quote_item_kind AS ENUM ('vehicle', 'freight', 'inspection', 'insurance', 'documentation', 'service', 'tax', 'discount', 'other');
CREATE TYPE quote_item_visibility AS ENUM ('internal', 'customer');
CREATE TYPE reservation_status AS ENUM ('active', 'released', 'converted', 'expired');
CREATE TYPE deal_status AS ENUM ('won', 'source_confirming', 'source_confirmed', 'awaiting_customer', 'processing', 'ready_for_delivery', 'completed', 'cancelled');

CREATE TABLE markets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    country_id SMALLINT NOT NULL UNIQUE REFERENCES countries(id),
    slug TEXT NOT NULL UNIQUE,
    status market_status NOT NULL DEFAULT 'inactive',
    currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
    locale TEXT NOT NULL,
    sales_email CITEXT,
    sales_phone TEXT,
    sales_whatsapp TEXT,
    seo_title TEXT,
    seo_description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE vehicles
    ADD COLUMN availability_status vehicle_availability_status NOT NULL DEFAULT 'available',
    ADD COLUMN purchase_cost_minor BIGINT CHECK (purchase_cost_minor >= 0),
    ADD COLUMN purchase_cost_currency CHAR(3),
    ADD COLUMN estimated_local_cost_minor BIGINT CHECK (estimated_local_cost_minor >= 0),
    ADD COLUMN cost_notes TEXT,
    ADD COLUMN reserved_at TIMESTAMPTZ,
    ADD COLUMN sold_at TIMESTAMPTZ,
    ADD CONSTRAINT vehicle_purchase_cost_currency_pair CHECK ((purchase_cost_minor IS NULL) = (purchase_cost_currency IS NULL)),
    ADD CONSTRAINT vehicle_purchase_cost_currency_format CHECK (purchase_cost_currency IS NULL OR purchase_cost_currency ~ '^[A-Z]{3}$');
UPDATE vehicles SET availability_status = 'sold' WHERE status = 'sold';
CREATE INDEX idx_vehicles_public_available ON vehicles (published_at DESC, id DESC)
    WHERE status = 'published' AND availability_status = 'available' AND deleted_at IS NULL;

CREATE TABLE vehicle_markets (
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    market_id UUID NOT NULL REFERENCES markets(id),
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    featured BOOLEAN NOT NULL DEFAULT FALSE,
    priority INT NOT NULL DEFAULT 0,
    available_from TIMESTAMPTZ,
    available_until TIMESTAMPTZ,
    market_notes TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (vehicle_id, market_id),
    CONSTRAINT vehicle_market_window CHECK (available_until IS NULL OR available_from IS NULL OR available_until > available_from)
);
CREATE INDEX idx_vehicle_markets_market_active ON vehicle_markets (market_id, vehicle_id)
    WHERE is_active;

ALTER TYPE lead_status ADD VALUE 'qualified';
ALTER TYPE lead_status ADD VALUE 'quote_preparing';
ALTER TYPE lead_status ADD VALUE 'unresponsive';
ALTER TYPE lead_status ADD VALUE 'cancelled';
ALTER TABLE leads ADD COLUMN market_id UUID REFERENCES markets(id);
CREATE INDEX idx_leads_market_created ON leads (market_id, created_at DESC);

CREATE SEQUENCE quote_ref_seq START 1000;
CREATE TABLE quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference_no TEXT NOT NULL UNIQUE DEFAULT ('Q-' || nextval('quote_ref_seq')),
    lead_id UUID NOT NULL REFERENCES leads(id),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id),
    status quote_status NOT NULL DEFAULT 'draft',
    currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
    current_version_no INT NOT NULL DEFAULT 0 CHECK (current_version_no >= 0),
    valid_until TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES users(id),
    sent_by UUID REFERENCES users(id),
    sent_at TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_quotes_lead ON quotes (lead_id, created_at DESC);
CREATE TABLE quote_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_id UUID NOT NULL REFERENCES quotes(id),
    version_no INT NOT NULL CHECK (version_no > 0),
    vehicle_snapshot JSONB NOT NULL,
    source_cost_minor BIGINT CHECK (source_cost_minor >= 0),
    shipping_cost_minor BIGINT CHECK (shipping_cost_minor >= 0),
    other_cost_minor BIGINT CHECK (other_cost_minor >= 0),
    internal_total_cost_minor BIGINT CHECK (internal_total_cost_minor >= 0),
    customer_total_minor BIGINT NOT NULL CHECK (customer_total_minor >= 0),
    estimated_margin_minor BIGINT,
    estimated_margin_bps INT,
    terms_text TEXT,
    internal_notes TEXT,
    customer_notes TEXT,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (quote_id, version_no)
);
CREATE TABLE quote_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_version_id UUID NOT NULL REFERENCES quote_versions(id),
    kind quote_item_kind NOT NULL,
    label TEXT NOT NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    unit_amount_minor BIGINT NOT NULL,
    line_total_minor BIGINT NOT NULL,
    visibility quote_item_visibility NOT NULL DEFAULT 'customer',
    sort_order INT NOT NULL DEFAULT 0
);
CREATE INDEX idx_quote_items_version ON quote_items (quote_version_id, sort_order);

-- Quote revisions are append-only. Corrections create a new version.
CREATE FUNCTION reject_quote_version_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Quote versions and items are immutable; create a new version.';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_quote_versions_immutable BEFORE UPDATE OR DELETE ON quote_versions
    FOR EACH ROW EXECUTE FUNCTION reject_quote_version_mutation();
CREATE TRIGGER trg_quote_items_immutable BEFORE UPDATE OR DELETE ON quote_items
    FOR EACH ROW EXECUTE FUNCTION reject_quote_version_mutation();

CREATE TABLE vehicle_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id),
    lead_id UUID NOT NULL REFERENCES leads(id),
    quote_id UUID REFERENCES quotes(id),
    status reservation_status NOT NULL DEFAULT 'active',
    expires_at TIMESTAMPTZ NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    released_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX uq_vehicle_active_reservation ON vehicle_reservations (vehicle_id) WHERE status = 'active';
CREATE INDEX idx_vehicle_reservations_expiry ON vehicle_reservations (expires_at) WHERE status = 'active';

CREATE SEQUENCE deal_ref_seq START 1000;
CREATE TABLE deals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference_no TEXT NOT NULL UNIQUE DEFAULT ('DEAL-' || nextval('deal_ref_seq')),
    lead_id UUID NOT NULL UNIQUE REFERENCES leads(id),
    accepted_quote_id UUID REFERENCES quotes(id),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id),
    reservation_id UUID UNIQUE REFERENCES vehicle_reservations(id),
    customer_id UUID REFERENCES users(id),
    market_id UUID NOT NULL REFERENCES markets(id),
    owner_salesperson_id UUID NOT NULL REFERENCES users(id),
    status deal_status NOT NULL DEFAULT 'won',
    agreed_amount_minor BIGINT NOT NULL CHECK (agreed_amount_minor >= 0),
    currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
    source_id UUID REFERENCES inventory_sources(id),
    source_cost_minor BIGINT CHECK (source_cost_minor >= 0),
    margin_minor BIGINT,
    won_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    cancel_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_deals_active_vehicle ON deals (vehicle_id) WHERE status <> 'cancelled';
CREATE INDEX idx_deals_owner_created ON deals (owner_salesperson_id, created_at DESC);

DO $$ DECLARE t TEXT; BEGIN
    FOREACH t IN ARRAY ARRAY['markets', 'vehicle_markets', 'quotes', 'deals'] LOOP
        EXECUTE format('CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
    END LOOP;
END $$;
