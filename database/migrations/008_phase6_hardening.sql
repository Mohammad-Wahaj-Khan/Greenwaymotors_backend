CREATE TABLE cms_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('page','blog','faq','banner')),
  slug TEXT NOT NULL CHECK (length(slug) BETWEEN 1 AND 180),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  excerpt TEXT,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  seo_title TEXT,
  seo_description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  editor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, slug),
  CHECK (status <> 'published' OR published_at IS NOT NULL)
);
CREATE INDEX idx_cms_entries_public ON cms_entries (kind,published_at DESC,slug) WHERE status='published';
CREATE INDEX idx_cms_entries_admin ON cms_entries (kind,status,updated_at DESC);
CREATE TABLE cms_entry_markets (
  entry_id UUID NOT NULL REFERENCES cms_entries(id) ON DELETE CASCADE,
  market_id UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id,market_id)
);
CREATE TABLE vehicle_import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','partial','failed')),
  row_count INT NOT NULL CHECK (row_count >= 0),
  imported_count INT NOT NULL DEFAULT 0 CHECK (imported_count >= 0),
  failed_count INT NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CHECK (imported_count + failed_count <= row_count)
);
CREATE INDEX idx_vehicle_import_jobs_admin ON vehicle_import_jobs (created_at DESC,id DESC);
CREATE TABLE vehicle_import_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES vehicle_import_jobs(id) ON DELETE CASCADE,
  row_no INT NOT NULL CHECK (row_no > 0),
  raw_data JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','imported','failed')),
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id,row_no),
  CHECK ((status='imported') = (vehicle_id IS NOT NULL))
);
CREATE INDEX idx_vehicle_import_rows_job_status ON vehicle_import_rows (job_id,status,row_no);
CREATE TABLE outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic TEXT NOT NULL,
  payload JSONB NOT NULL,
  idempotency_key TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status='processing') = (locked_at IS NOT NULL))
);
CREATE INDEX idx_outbox_pending ON outbox_events (available_at,created_at) WHERE status IN ('pending','failed');
CREATE TABLE user_mfa (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_ciphertext TEXT NOT NULL,
  enabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE mfa_recovery_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id,code_hash)
);
CREATE INDEX idx_mfa_recovery_unused ON mfa_recovery_codes (user_id,created_at) WHERE used_at IS NULL;
CREATE TABLE mfa_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_mfa_challenges_expiry ON mfa_challenges (expires_at) WHERE consumed_at IS NULL;
CREATE INDEX idx_audit_action_created ON audit_logs (action,created_at DESC);
CREATE INDEX idx_audit_created ON audit_logs (created_at DESC);
CREATE INDEX idx_notifications_user_created ON notifications (user_id,created_at DESC);
CREATE INDEX idx_commercial_idempotency_created ON commercial_idempotency (created_at);

CREATE FUNCTION prevent_audit_log_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;
CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
