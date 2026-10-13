-- Customer asking prices and salesperson-only sale floors are configured per destination market.
-- Currency is captured with each price so a market currency change cannot silently reinterpret it.
CREATE TABLE vehicle_market_pricing (
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    market_id UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
    asking_price_minor BIGINT CHECK (asking_price_minor >= 0),
    minimum_sale_price_minor BIGINT CHECK (minimum_sale_price_minor >= 0),
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (vehicle_id, market_id),
    CONSTRAINT vehicle_market_price_present CHECK (
        asking_price_minor IS NOT NULL OR minimum_sale_price_minor IS NOT NULL
    ),
    CONSTRAINT vehicle_market_floor_not_above_asking CHECK (
        minimum_sale_price_minor IS NULL OR asking_price_minor IS NULL
        OR minimum_sale_price_minor <= asking_price_minor
    )
);
