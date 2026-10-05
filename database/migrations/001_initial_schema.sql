-- =====================================================================
-- Green Way Motors MVP schema (PostgreSQL 14+)
-- Single-seller inventory and lead CRM. No prices, orders, or payments.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE user_type AS ENUM ('customer', 'staff');
CREATE TYPE user_status AS ENUM ('active', 'suspended', 'deleted');
CREATE TYPE vehicle_status AS ENUM ('draft', 'pending_review', 'published', 'rejected', 'sold', 'archived');
CREATE TYPE vehicle_condition AS ENUM ('new', 'used');
CREATE TYPE fuel_type AS ENUM ('petrol', 'diesel', 'hybrid', 'plug_in_hybrid', 'electric', 'lpg', 'cng', 'other');
CREATE TYPE transmission_type AS ENUM ('automatic', 'manual', 'cvt', 'semi_automatic');
CREATE TYPE drive_type AS ENUM ('fwd', 'rwd', 'awd', '4wd');
CREATE TYPE steering_type AS ENUM ('lhd', 'rhd');
CREATE TYPE media_type AS ENUM ('image', 'video');
CREATE TYPE lead_status AS ENUM ('new', 'contacted', 'quote_sent', 'negotiating', 'won', 'lost', 'spam');
CREATE TYPE contact_method AS ENUM ('email', 'phone', 'whatsapp');
CREATE TYPE lead_activity_type AS ENUM ('created', 'status_changed', 'assigned', 'note', 'call', 'email', 'whatsapp');
CREATE TYPE token_purpose AS ENUM ('email_verification', 'password_reset');

CREATE TABLE countries (
    id SMALLSERIAL PRIMARY KEY,
    iso2 CHAR(2) NOT NULL UNIQUE,
    iso3 CHAR(3) NOT NULL UNIQUE,
    name TEXT NOT NULL,
    phone_code TEXT,
    region TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_type user_type NOT NULL,
    email CITEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    phone TEXT,
    whatsapp TEXT,
    country_id SMALLINT REFERENCES countries(id),
    city TEXT,
    preferred_contact contact_method,
    status user_status NOT NULL DEFAULT 'active',
    email_verified_at TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_type_status ON users (user_type, status);

CREATE TABLE roles (
    id SMALLSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT
);

CREATE TABLE permissions (
    id SERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    description TEXT
);

CREATE TABLE role_permissions (
    role_id SMALLINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id INT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id SMALLINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash TEXT NOT NULL UNIQUE,
    user_agent TEXT,
    ip_address INET,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_user_sessions_user ON user_sessions (user_id);

CREATE TABLE user_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose token_purpose NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_user_tokens_user ON user_tokens (user_id, purpose);

CREATE TABLE inventory_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name TEXT NOT NULL,
    country_id SMALLINT REFERENCES countries(id),
    city TEXT,
    contact_name TEXT,
    email CITEXT,
    phone TEXT,
    reference TEXT,
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_inventory_sources_country ON inventory_sources (country_id);

CREATE TABLE makes (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    logo_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE models (
    id SERIAL PRIMARY KEY,
    make_id INT NOT NULL REFERENCES makes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (make_id, name),
    UNIQUE (make_id, slug)
);

CREATE TABLE body_types (
    id SMALLSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE
);

CREATE TABLE features (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    category TEXT
);

CREATE SEQUENCE vehicle_ref_seq START 100000;

CREATE TABLE vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference_no TEXT NOT NULL UNIQUE DEFAULT ('GW-' || nextval('vehicle_ref_seq')),
    inventory_source_id UUID REFERENCES inventory_sources(id),
    stock_number TEXT,
    vin TEXT,
    status vehicle_status NOT NULL DEFAULT 'draft',
    condition vehicle_condition NOT NULL DEFAULT 'used',
    make_id INT NOT NULL REFERENCES makes(id),
    model_id INT NOT NULL REFERENCES models(id),
    variant TEXT,
    body_type_id SMALLINT REFERENCES body_types(id),
    year SMALLINT NOT NULL CHECK (year BETWEEN 1950 AND 2100),
    mileage_km INT CHECK (mileage_km >= 0),
    engine_cc INT CHECK (engine_cc >= 0),
    fuel fuel_type,
    transmission transmission_type,
    drive drive_type,
    steering steering_type,
    seats SMALLINT CHECK (seats > 0),
    doors SMALLINT CHECK (doors > 0),
    exterior_color TEXT,
    interior_color TEXT,
    stock_country_id SMALLINT NOT NULL REFERENCES countries(id),
    stock_city TEXT,
    title TEXT NOT NULL,
    description TEXT,
    review_notes TEXT,
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    view_count INT NOT NULL DEFAULT 0,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX uq_vehicles_stock_number ON vehicles (stock_number)
    WHERE stock_number IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_vehicles_vin ON vehicles (vin)
    WHERE vin IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_vehicles_search ON vehicles (make_id, model_id, year)
    WHERE status = 'published' AND deleted_at IS NULL;
CREATE INDEX idx_vehicles_country ON vehicles (stock_country_id)
    WHERE status = 'published' AND deleted_at IS NULL;
CREATE INDEX idx_vehicles_body ON vehicles (body_type_id)
    WHERE status = 'published' AND deleted_at IS NULL;
CREATE INDEX idx_vehicles_published ON vehicles (published_at DESC)
    WHERE status = 'published' AND deleted_at IS NULL;
CREATE INDEX idx_vehicles_source ON vehicles (inventory_source_id, status);
CREATE INDEX idx_vehicles_review ON vehicles (created_at)
    WHERE status = 'pending_review';

CREATE TABLE vehicle_features (
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    feature_id INT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
    PRIMARY KEY (vehicle_id, feature_id)
);

CREATE TABLE vehicle_media (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    type media_type NOT NULL DEFAULT 'image',
    url TEXT NOT NULL,
    thumb_url TEXT,
    sort_order INT NOT NULL DEFAULT 0,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_vehicle_media_vehicle ON vehicle_media (vehicle_id, sort_order);
CREATE UNIQUE INDEX uq_vehicle_media_primary ON vehicle_media (vehicle_id) WHERE is_primary;

CREATE TABLE favorites (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, vehicle_id)
);

CREATE TABLE saved_searches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT,
    filters JSONB NOT NULL,
    notify BOOLEAN NOT NULL DEFAULT TRUE,
    last_notified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_saved_searches_user ON saved_searches (user_id);

CREATE SEQUENCE lead_ref_seq START 10000;

CREATE TABLE leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference_no TEXT NOT NULL UNIQUE DEFAULT ('LEAD-' || nextval('lead_ref_seq')),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id),
    vehicle_snapshot JSONB NOT NULL,
    customer_id UUID REFERENCES users(id),
    contact_name TEXT NOT NULL,
    contact_email CITEXT NOT NULL,
    contact_phone TEXT,
    contact_whatsapp TEXT,
    preferred_contact contact_method,
    customer_country_id SMALLINT REFERENCES countries(id),
    destination_country_id SMALLINT REFERENCES countries(id),
    destination_port TEXT,
    message TEXT,
    status lead_status NOT NULL DEFAULT 'new',
    lost_reason TEXT,
    assigned_to UUID REFERENCES users(id),
    assigned_at TIMESTAMPTZ,
    first_contacted_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    source TEXT NOT NULL DEFAULT 'website',
    consent_given BOOLEAN NOT NULL DEFAULT FALSE,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_leads_status_created ON leads (status, created_at DESC);
CREATE INDEX idx_leads_assigned ON leads (assigned_to, status);
CREATE INDEX idx_leads_vehicle ON leads (vehicle_id);
CREATE INDEX idx_leads_customer ON leads (customer_id);
CREATE INDEX idx_leads_email ON leads (contact_email);

CREATE TABLE lead_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES users(id),
    type lead_activity_type NOT NULL,
    body TEXT,
    meta JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_lead_activities_lead ON lead_activities (lead_id, created_at);

CREATE TABLE lead_followups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    assigned_to UUID NOT NULL REFERENCES users(id),
    due_at TIMESTAMPTZ NOT NULL,
    note TEXT,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_lead_followups_due ON lead_followups (assigned_to, due_at)
    WHERE completed_at IS NULL;

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    data JSONB,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user_unread ON notifications (user_id, created_at DESC)
    WHERE read_at IS NULL;

CREATE TABLE audit_logs (
    id BIGSERIAL PRIMARY KEY,
    actor_id UUID REFERENCES users(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    changes JSONB,
    ip_address INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_logs (entity_type, entity_id);
CREATE INDEX idx_audit_actor ON audit_logs (actor_id, created_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
    FOR t IN
        SELECT table_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'updated_at'
    LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
            t,
            t
        );
    END LOOP;
END $$;

INSERT INTO roles (name, description) VALUES
    ('super_admin', 'Full Green Way Motors access'),
    ('inventory_manager', 'Manage and review Green Way Motors inventory'),
    ('sales_manager', 'Manage all leads and sales assignments'),
    ('sales_agent', 'Work assigned leads'),
    ('content_manager', 'Manage public vehicle and catalog content');
