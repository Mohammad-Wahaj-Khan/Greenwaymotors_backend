CREATE TABLE salesperson_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  salesperson_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT salesperson_ratings_one_per_deal UNIQUE (deal_id)
);

CREATE INDEX idx_salesperson_ratings_salesperson_created
  ON salesperson_ratings (salesperson_id, created_at DESC);
