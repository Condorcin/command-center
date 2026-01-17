-- Marketplace items table to store countries where a CBT is published
CREATE TABLE IF NOT EXISTS marketplace_items (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL, -- References items.id
  global_seller_id TEXT NOT NULL,
  ml_item_id TEXT NOT NULL, -- The marketplace item ID (e.g., MLC1818643789)
  site_id TEXT NOT NULL, -- The country site (e.g., MLC, MCO, MLB, MLM)
  date_created TEXT, -- ISO date string from ML API
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
  FOREIGN KEY (global_seller_id) REFERENCES global_sellers(id) ON DELETE CASCADE
);

-- Indexes for fast searches
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_items_ml_item ON marketplace_items(ml_item_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_items_item_id ON marketplace_items(item_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_items_global_seller ON marketplace_items(global_seller_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_items_site_id ON marketplace_items(site_id);
