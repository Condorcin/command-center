-- Add index on ml_item_id for faster LIKE 'CBT%' queries
CREATE INDEX IF NOT EXISTS idx_items_ml_item_id ON items(ml_item_id);

-- Add composite index for common query patterns (global_seller_id + ml_item_id + title)
-- This helps with queries that filter by global_seller_id and check title
CREATE INDEX IF NOT EXISTS idx_items_global_seller_title ON items(global_seller_id, title) WHERE title IS NOT NULL;

-- Add composite index for price queries
CREATE INDEX IF NOT EXISTS idx_items_global_seller_price ON items(global_seller_id, price) WHERE price IS NOT NULL AND price != 0;

-- Add composite index for CBT queries with ordering (global_seller_id + synced_at)
-- This significantly speeds up ORDER BY synced_at queries for CBTs
CREATE INDEX IF NOT EXISTS idx_items_global_seller_synced_at ON items(global_seller_id, synced_at) WHERE ml_item_id LIKE 'CBT%';

-- Add composite index for faster COUNT queries (global_seller_id + status)
-- This speeds up GROUP BY status queries
CREATE INDEX IF NOT EXISTS idx_items_global_seller_status ON items(global_seller_id, status);

-- Add composite index for faster CBT COUNT queries (global_seller_id + ml_item_id)
-- This speeds up COUNT(*) WHERE ml_item_id LIKE 'CBT%' queries
CREATE INDEX IF NOT EXISTS idx_items_global_seller_ml_item_cbt ON items(global_seller_id, ml_item_id) WHERE ml_item_id LIKE 'CBT%';
