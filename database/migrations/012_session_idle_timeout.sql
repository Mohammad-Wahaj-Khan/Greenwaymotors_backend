-- Refresh sessions remain valid for their configured absolute lifetime, but an
-- inactive browser session must be re-authenticated after the idle timeout.
ALTER TABLE user_sessions
  ADD COLUMN last_active_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX idx_user_sessions_active
  ON user_sessions (user_id, last_active_at)
  WHERE revoked_at IS NULL;
