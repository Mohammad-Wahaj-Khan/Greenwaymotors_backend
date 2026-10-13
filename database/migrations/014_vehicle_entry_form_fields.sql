-- Additional listing fields used by the inventory entry form.
ALTER TABLE vehicles
  ADD COLUMN model_code TEXT,
  ADD COLUMN grade TEXT,
  ADD COLUMN manufacture_year SMALLINT CHECK (manufacture_year BETWEEN 1950 AND 2100),
  ADD COLUMN manufacture_month SMALLINT CHECK (manufacture_month BETWEEN 1 AND 12),
  ADD COLUMN registration_year SMALLINT CHECK (registration_year BETWEEN 1950 AND 2100),
  ADD COLUMN registration_month SMALLINT CHECK (registration_month BETWEEN 1 AND 12),
  ADD COLUMN engine_number TEXT,
  ADD COLUMN engine_code TEXT,
  ADD COLUMN total_seats SMALLINT CHECK (total_seats >= 0),
  ADD COLUMN weight_kg INTEGER CHECK (weight_kg >= 0),
  ADD COLUMN total_weight_kg INTEGER CHECK (total_weight_kg >= 0),
  ADD COLUMN max_loading_capacity_kg INTEGER CHECK (max_loading_capacity_kg >= 0),
  ADD COLUMN length_cm INTEGER CHECK (length_cm >= 0),
  ADD COLUMN width_cm INTEGER CHECK (width_cm >= 0),
  ADD COLUMN height_cm INTEGER CHECK (height_cm >= 0),
  ADD COLUMN notice_type TEXT CHECK (notice_type IN ('promotion', 'caution')),
  ADD COLUMN notice_title TEXT,
  ADD COLUMN youtube_video_id VARCHAR(11)
    CHECK (youtube_video_id IS NULL OR youtube_video_id ~ '^[A-Za-z0-9_-]{11}$');

ALTER TABLE vehicle_market_pricing
  ADD COLUMN available_discount_minor BIGINT CHECK (available_discount_minor >= 0);
