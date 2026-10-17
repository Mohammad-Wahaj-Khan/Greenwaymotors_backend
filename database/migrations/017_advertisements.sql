ALTER TABLE upload_intents DROP CONSTRAINT upload_intents_purpose_check;
ALTER TABLE upload_intents
  ADD CONSTRAINT upload_intents_purpose_check
  CHECK (purpose IN ('vehicle_media', 'advertisement_media'));

CREATE TABLE advertisements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  placement TEXT NOT NULL CHECK (placement IN ('home_inventory_rail', 'vehicle_catalog_rail')),
  upload_intent_id UUID NOT NULL UNIQUE REFERENCES upload_intents(id),
  image_url TEXT NOT NULL,
  target_url TEXT NOT NULL,
  is_published BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL REFERENCES users(id),
  updated_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_advertisements_public_placement
  ON advertisements (placement, updated_at DESC)
  WHERE is_published;
