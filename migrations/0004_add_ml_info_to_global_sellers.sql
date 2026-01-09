-- Add Mercado Libre information fields to global_sellers table
ALTER TABLE global_sellers ADD COLUMN ml_nickname TEXT;
ALTER TABLE global_sellers ADD COLUMN ml_email TEXT;
ALTER TABLE global_sellers ADD COLUMN ml_first_name TEXT;
ALTER TABLE global_sellers ADD COLUMN ml_last_name TEXT;
ALTER TABLE global_sellers ADD COLUMN ml_country_id TEXT;
ALTER TABLE global_sellers ADD COLUMN ml_site_id TEXT;
ALTER TABLE global_sellers ADD COLUMN ml_registration_date TEXT;
ALTER TABLE global_sellers ADD COLUMN ml_phone TEXT;
ALTER TABLE global_sellers ADD COLUMN ml_address TEXT;
ALTER TABLE global_sellers ADD COLUMN ml_city TEXT;
ALTER TABLE global_sellers ADD COLUMN ml_state TEXT;
ALTER TABLE global_sellers ADD COLUMN ml_zip_code TEXT;
ALTER TABLE global_sellers ADD COLUMN ml_tax_id TEXT;
ALTER TABLE global_sellers ADD COLUMN ml_corporate_name TEXT;
ALTER TABLE global_sellers ADD COLUMN ml_brand_name TEXT;
ALTER TABLE global_sellers ADD COLUMN ml_seller_experience TEXT;
ALTER TABLE global_sellers ADD COLUMN ml_info_updated_at INTEGER;

