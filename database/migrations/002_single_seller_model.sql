-- Transition pre-release dealer-marketplace databases to the Green Way
-- Motors single-seller model. This is a no-op for a database created from
-- 001_initial_schema.sql.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'user_type'
    ) AND EXISTS (
        SELECT 1
        FROM pg_enum
        WHERE enumtypid = 'user_type'::regtype
          AND enumlabel = 'dealer_user'
    ) THEN
        IF EXISTS (SELECT 1 FROM users WHERE user_type::text = 'dealer_user') THEN
            RAISE EXCEPTION
                'Cannot automatically migrate dealer_user accounts. Classify or remove them before applying the single-seller migration.';
        END IF;

        CREATE TYPE user_type_single_seller AS ENUM ('customer', 'staff');
        ALTER TABLE users
            ALTER COLUMN user_type TYPE user_type_single_seller
            USING user_type::text::user_type_single_seller;
        DROP TYPE user_type;
        ALTER TYPE user_type_single_seller RENAME TO user_type;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS inventory_sources (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name TEXT NOT NULL,
    country_id   SMALLINT REFERENCES countries(id),
    city         TEXT,
    contact_name TEXT,
    email        CITEXT,
    phone        TEXT,
    reference    TEXT,
    notes        TEXT,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inventory_sources_country ON inventory_sources (country_id);

ALTER TABLE vehicles
    ADD COLUMN IF NOT EXISTS inventory_source_id UUID REFERENCES inventory_sources(id);

DO $$
BEGIN
    IF to_regclass('public.dealers') IS NOT NULL THEN
        INSERT INTO inventory_sources (
            id,
            company_name,
            country_id,
            city,
            email,
            phone,
            reference,
            notes,
            created_at,
            updated_at
        )
        SELECT
            id,
            company_name,
            country_id,
            city,
            email,
            phone,
            registration_number,
            'Migrated from the retired dealer marketplace model.',
            created_at,
            updated_at
        FROM dealers
        ON CONFLICT (id) DO NOTHING;

        UPDATE vehicles
        SET inventory_source_id = dealer_id
        WHERE inventory_source_id IS NULL;
    END IF;
END $$;

-- A marketplace allowed stock numbers to repeat across different dealers.
-- In the single-seller catalogue retain the oldest stock number and make each
-- later collision globally unique while retaining its internal source trace.
DO $$
BEGIN
    IF to_regclass('public.dealers') IS NOT NULL THEN
        WITH numbered AS (
            SELECT
                id,
                dealer_id,
                stock_number,
                row_number() OVER (
                    PARTITION BY stock_number
                    ORDER BY created_at, id
                ) AS position
            FROM vehicles
            WHERE stock_number IS NOT NULL AND deleted_at IS NULL
        )
        UPDATE vehicles AS vehicle
        SET stock_number = vehicle.stock_number || '-source-' || numbered.dealer_id::text
        FROM numbered
        WHERE vehicle.id = numbered.id
          AND numbered.position > 1;
    END IF;
END $$;

DROP INDEX IF EXISTS uq_vehicles_dealer_stock;
DROP INDEX IF EXISTS uq_vehicles_dealer_vin;
DROP INDEX IF EXISTS idx_vehicles_dealer;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicles_stock_number ON vehicles (stock_number)
    WHERE stock_number IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicles_vin ON vehicles (vin)
    WHERE vin IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vehicles_source ON vehicles (inventory_source_id, status);

ALTER TABLE vehicles DROP COLUMN IF EXISTS dealer_id;
ALTER TABLE leads DROP COLUMN IF EXISTS dealer_id;
DROP INDEX IF EXISTS idx_leads_dealer;

-- Preserve historical dealer uploads as internal procurement history. The operational
-- import workflow is intentionally retired, but this data remains valuable for audit.
CREATE TABLE IF NOT EXISTS inventory_import_history (
    id                  UUID PRIMARY KEY,
    inventory_source_id UUID REFERENCES inventory_sources(id),
    uploaded_by         UUID REFERENCES users(id),
    file_url            TEXT NOT NULL,
    legacy_status       TEXT NOT NULL,
    total_rows          INT,
    accepted_rows       INT,
    rejected_rows       INT,
    errors              JSONB,
    created_at          TIMESTAMPTZ NOT NULL,
    completed_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_inventory_import_history_source
    ON inventory_import_history (inventory_source_id, created_at DESC);

DO $$
BEGIN
    IF to_regclass('public.vehicle_imports') IS NOT NULL THEN
        INSERT INTO inventory_import_history (
            id,
            inventory_source_id,
            uploaded_by,
            file_url,
            legacy_status,
            total_rows,
            accepted_rows,
            rejected_rows,
            errors,
            created_at,
            completed_at
        )
        SELECT
            id,
            dealer_id,
            uploaded_by,
            file_url,
            status::text,
            total_rows,
            accepted_rows,
            rejected_rows,
            errors,
            created_at,
            completed_at
        FROM vehicle_imports
        ON CONFLICT (id) DO NOTHING;

        DROP TABLE vehicle_imports;
    END IF;
END $$;

DROP TABLE IF EXISTS dealer_documents;
DROP TABLE IF EXISTS dealer_users;
DROP TABLE IF EXISTS dealers;
DROP TYPE IF EXISTS document_status;
DROP TYPE IF EXISTS dealer_member_role;
DROP TYPE IF EXISTS dealer_status;
DROP TYPE IF EXISTS import_status;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_inventory_sources_updated_at'
          AND tgrelid = 'inventory_sources'::regclass
    ) THEN
        CREATE TRIGGER trg_inventory_sources_updated_at
            BEFORE UPDATE ON inventory_sources
            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
END $$;

INSERT INTO roles (name, description)
VALUES ('content_manager', 'Manage public vehicle and catalog content')
ON CONFLICT (name) DO NOTHING;
