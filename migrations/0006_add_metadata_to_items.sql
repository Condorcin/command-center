-- Add metadata JSON field to store complete item information from ML API
ALTER TABLE items ADD COLUMN metadata TEXT;

-- Add index for faster queries on metadata (if needed for specific searches)
-- Note: SQLite doesn't support JSON indexes directly, but we can query JSON fields

