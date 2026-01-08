-- Add Mercado Libre fields to users table
ALTER TABLE users ADD COLUMN ml_user_id TEXT;
ALTER TABLE users ADD COLUMN ml_access_token TEXT;
ALTER TABLE users ADD COLUMN ml_updated_at INTEGER;

-- Index for ML user_id lookups
CREATE INDEX IF NOT EXISTS idx_users_ml_user_id ON users(ml_user_id);

