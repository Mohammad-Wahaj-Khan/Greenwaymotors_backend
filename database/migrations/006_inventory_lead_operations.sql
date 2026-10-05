-- Phase 2–3 operational fields. Existing migration history is unchanged.
CREATE TYPE inventory_source_status AS ENUM ('active', 'inactive', 'blocked');
ALTER TABLE inventory_sources
  ADD COLUMN source_code TEXT,
  ADD COLUMN website TEXT,
  ADD COLUMN whatsapp TEXT,
  ADD COLUMN address TEXT,
  ADD COLUMN status inventory_source_status NOT NULL DEFAULT 'active',
  ADD COLUMN reliability_rating SMALLINT CHECK (reliability_rating BETWEEN 1 AND 5),
  ADD COLUMN payment_terms TEXT,
  ADD COLUMN internal_notes TEXT,
  ADD COLUMN created_by UUID REFERENCES users(id),
  ADD COLUMN updated_by UUID REFERENCES users(id);
UPDATE inventory_sources SET status = 'inactive' WHERE is_active = false;
-- Preserve the legacy flag for deployed readers while status becomes authoritative.
CREATE FUNCTION sync_inventory_source_active() RETURNS trigger AS $$
BEGIN
  NEW.is_active = (NEW.status = 'active');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_inventory_source_active BEFORE INSERT OR UPDATE OF status ON inventory_sources
  FOR EACH ROW EXECUTE FUNCTION sync_inventory_source_active();
CREATE UNIQUE INDEX uq_inventory_sources_code ON inventory_sources (source_code) WHERE source_code IS NOT NULL;
CREATE INDEX idx_inventory_sources_status_name ON inventory_sources (status, company_name);

CREATE TYPE upload_intent_status AS ENUM ('pending', 'completed');
CREATE TABLE upload_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_key TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('vehicle_media')),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'video/mp4')),
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 104857600),
  status upload_intent_status NOT NULL DEFAULT 'pending',
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ
);
CREATE INDEX idx_upload_intents_owner ON upload_intents (created_by, created_at DESC);
ALTER TABLE vehicle_media
  ADD COLUMN upload_intent_id UUID UNIQUE REFERENCES upload_intents(id),
  ADD COLUMN storage_key TEXT UNIQUE,
  ADD COLUMN mime_type TEXT,
  ADD COLUMN size_bytes BIGINT CHECK (size_bytes > 0);

ALTER TABLE leads
  ADD COLUMN city TEXT,
  ADD COLUMN customer_language TEXT,
  ADD COLUMN qualification_notes TEXT,
  ADD COLUMN lost_reason_code TEXT,
  ADD COLUMN utm_source TEXT,
  ADD COLUMN utm_medium TEXT,
  ADD COLUMN utm_campaign TEXT,
  ADD COLUMN utm_content TEXT,
  ADD COLUMN utm_term TEXT,
  ADD COLUMN landing_page TEXT,
  ADD COLUMN referrer TEXT,
  ADD COLUMN marketing_consent BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN possible_duplicate_of UUID REFERENCES leads(id);
CREATE INDEX idx_leads_contact_vehicle_created ON leads (contact_email, vehicle_id, created_at DESC);
CREATE INDEX idx_leads_market_status_created ON leads (market_id, status, created_at DESC);

CREATE TABLE lead_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  payload_hash TEXT NOT NULL,
  lead_id UUID NOT NULL UNIQUE REFERENCES leads(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_lead_idempotency_created ON lead_idempotency (created_at);
