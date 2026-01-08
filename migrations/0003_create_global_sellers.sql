-- Global Sellers table
CREATE TABLE IF NOT EXISTS global_sellers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  ml_user_id TEXT NOT NULL,
  ml_access_token TEXT NOT NULL,
  name TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_global_sellers_user_id ON global_sellers(user_id);
CREATE INDEX IF NOT EXISTS idx_global_sellers_ml_user_id ON global_sellers(ml_user_id);

