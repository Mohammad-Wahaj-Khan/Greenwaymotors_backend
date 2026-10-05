-- Add relationship checks without changing the established 003 migration.
-- Composite foreign keys ensure a quote, reservation and deal describe the same exact vehicle and lead.
ALTER TABLE leads ADD CONSTRAINT uq_leads_id_vehicle UNIQUE (id, vehicle_id);
ALTER TABLE quotes ADD CONSTRAINT uq_quotes_id_lead_vehicle UNIQUE (id, lead_id, vehicle_id);
ALTER TABLE quotes ADD CONSTRAINT fk_quotes_lead_vehicle
    FOREIGN KEY (lead_id, vehicle_id) REFERENCES leads (id, vehicle_id);

ALTER TABLE quote_versions ADD CONSTRAINT uq_quote_versions_id_quote UNIQUE (id, quote_id);

ALTER TABLE vehicle_reservations ADD CONSTRAINT uq_reservations_id_lead_vehicle UNIQUE (id, lead_id, vehicle_id);
ALTER TABLE vehicle_reservations ADD CONSTRAINT fk_reservations_lead_vehicle
    FOREIGN KEY (lead_id, vehicle_id) REFERENCES leads (id, vehicle_id);

ALTER TABLE deals ADD COLUMN accepted_quote_version_id UUID;
ALTER TABLE deals ADD CONSTRAINT fk_deals_lead_vehicle
    FOREIGN KEY (lead_id, vehicle_id) REFERENCES leads (id, vehicle_id);
ALTER TABLE deals ADD CONSTRAINT fk_deals_accepted_quote
    FOREIGN KEY (accepted_quote_id, lead_id, vehicle_id) REFERENCES quotes (id, lead_id, vehicle_id);
ALTER TABLE deals ADD CONSTRAINT fk_deals_quote_version
    FOREIGN KEY (accepted_quote_version_id, accepted_quote_id) REFERENCES quote_versions (id, quote_id);
ALTER TABLE deals ADD CONSTRAINT fk_deals_reservation
    FOREIGN KEY (reservation_id, lead_id, vehicle_id) REFERENCES vehicle_reservations (id, lead_id, vehicle_id);
ALTER TABLE deals ADD CONSTRAINT deal_quote_version_pair
    CHECK ((accepted_quote_id IS NULL) = (accepted_quote_version_id IS NULL));

ALTER TABLE vehicles ADD CONSTRAINT vehicle_legacy_sold_availability
    CHECK (status <> 'sold' OR availability_status = 'sold');
