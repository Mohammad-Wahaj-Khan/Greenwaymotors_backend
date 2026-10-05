-- Phase 4-5: quote authority, durable commands, and fulfillment snapshots.
ALTER TABLE quote_versions
  ADD COLUMN valid_until TIMESTAMPTZ;

CREATE TYPE quote_version_status AS ENUM ('draft', 'sent', 'accepted', 'rejected', 'expired', 'superseded', 'cancelled');
CREATE TABLE quote_version_lifecycle (
  quote_version_id UUID PRIMARY KEY REFERENCES quote_versions(id),
  status quote_version_status NOT NULL DEFAULT 'draft',
  changed_by UUID REFERENCES users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT
);
INSERT INTO quote_version_lifecycle (quote_version_id, status)
SELECT qv.id,
       CASE
         WHEN qv.version_no < q.current_version_no THEN 'superseded'::quote_version_status
         WHEN q.status = 'accepted' THEN 'accepted'::quote_version_status
         WHEN q.status = 'sent' THEN 'sent'::quote_version_status
         WHEN q.status = 'rejected' THEN 'rejected'::quote_version_status
         WHEN q.status = 'expired' THEN 'expired'::quote_version_status
         WHEN q.status = 'cancelled' THEN 'cancelled'::quote_version_status
         WHEN q.status = 'superseded' THEN 'superseded'::quote_version_status
         ELSE 'draft'::quote_version_status
       END
FROM quote_versions qv JOIN quotes q ON q.id = qv.quote_id;

ALTER TABLE deals ALTER COLUMN status SET DEFAULT 'source_confirming';
UPDATE deals SET status = 'source_confirming' WHERE status = 'won';
ALTER TABLE deals
  ADD COLUMN customer_snapshot JSONB,
  ADD COLUMN market_snapshot JSONB,
  ADD COLUMN salesperson_snapshot JSONB,
  ADD COLUMN vehicle_snapshot JSONB,
  ADD COLUMN source_snapshot JSONB,
  ADD COLUMN commercial_terms TEXT,
  ADD COLUMN internal_notes TEXT,
  ADD COLUMN source_confirmation_reference TEXT,
  ADD COLUMN source_confirmed_at TIMESTAMPTZ;

CREATE TABLE commercial_idempotency (
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, idempotency_key)
);

CREATE TABLE fulfillment_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id),
  task_type TEXT NOT NULL CHECK (length(task_type) BETWEEN 1 AND 80),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
  assigned_to UUID REFERENCES users(id),
  due_at TIMESTAMPTZ,
  notes TEXT,
  completed_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fulfillment_tasks_deal ON fulfillment_tasks (deal_id, created_at);
CREATE TRIGGER trg_fulfillment_tasks_updated_at BEFORE UPDATE ON fulfillment_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE deals ADD CONSTRAINT deals_no_lead_status_as_deal_status CHECK (status <> 'won');
ALTER TABLE deals ADD CONSTRAINT deals_snapshot_required_after_conversion CHECK (
  accepted_quote_id IS NULL OR (
    customer_snapshot IS NOT NULL AND market_snapshot IS NOT NULL AND
    salesperson_snapshot IS NOT NULL AND vehicle_snapshot IS NOT NULL
  )
) NOT VALID;
