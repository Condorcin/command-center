-- Add performance/quality score fields to marketplace_items table
ALTER TABLE marketplace_items ADD COLUMN performance_score REAL;
ALTER TABLE marketplace_items ADD COLUMN performance_level TEXT; -- 'Bad', 'Average', 'Good'
ALTER TABLE marketplace_items ADD COLUMN performance_level_wording TEXT; -- Localized name (e.g., 'Profesional')
ALTER TABLE marketplace_items ADD COLUMN performance_calculated_at TEXT; -- ISO 8601 timestamp
ALTER TABLE marketplace_items ADD COLUMN performance_data TEXT; -- Complete JSON response

-- Index for fast queries by performance score
CREATE INDEX IF NOT EXISTS idx_marketplace_items_performance_score ON marketplace_items(performance_score);
