-- Items table to store Mercado Libre publications
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  global_seller_id TEXT NOT NULL,
  ml_item_id TEXT NOT NULL,
  site_id TEXT,
  title TEXT,
  price REAL,
  currency_id TEXT,
  available_quantity INTEGER DEFAULT 0,
  sold_quantity INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active', -- active, paused, closed
  listing_type_id TEXT,
  condition TEXT,
  permalink TEXT,
  thumbnail TEXT,
  category_id TEXT,
  start_time INTEGER,
  stop_time INTEGER,
  end_time INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  synced_at INTEGER,
  FOREIGN KEY (global_seller_id) REFERENCES global_sellers(id) ON DELETE CASCADE
);

-- Indexes for fast searches
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_global_seller_ml_item ON items(global_seller_id, ml_item_id);
CREATE INDEX IF NOT EXISTS idx_items_global_seller_id ON items(global_seller_id);
CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
CREATE INDEX IF NOT EXISTS idx_items_title ON items(title);
CREATE INDEX IF NOT EXISTS idx_items_updated_at ON items(updated_at);
CREATE INDEX IF NOT EXISTS idx_items_synced_at ON items(synced_at);

