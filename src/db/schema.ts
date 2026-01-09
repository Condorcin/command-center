export interface User {
  id: string;
  email: string;
  password_hash: string;
  role: string;
  created_at: number;
  ml_user_id?: string | null;
  ml_access_token?: string | null;
  ml_updated_at?: number | null;
}

export interface Session {
  id: string;
  user_id: string;
  expires_at: number;
  created_at: number;
}

export interface GlobalSeller {
  id: string;
  user_id: string;
  ml_user_id: string;
  ml_access_token: string;
  name?: string | null;
  created_at: number;
  updated_at: number;
  // Mercado Libre information
  ml_nickname?: string | null;
  ml_email?: string | null;
  ml_first_name?: string | null;
  ml_last_name?: string | null;
  ml_country_id?: string | null;
  ml_site_id?: string | null;
  ml_registration_date?: string | null;
  ml_phone?: string | null;
  ml_address?: string | null;
  ml_city?: string | null;
  ml_state?: string | null;
  ml_zip_code?: string | null;
  ml_tax_id?: string | null;
  ml_corporate_name?: string | null;
  ml_brand_name?: string | null;
  ml_seller_experience?: string | null;
  ml_info_updated_at?: number | null;
}

export interface Item {
  id: string;
  global_seller_id: string;
  ml_item_id: string;
  site_id: string | null;
  title: string | null;
  price: number | null;
  currency_id: string | null;
  available_quantity: number;
  sold_quantity: number;
  status: 'active' | 'paused' | 'closed';
  listing_type_id: string | null;
  condition: string | null;
  permalink: string | null;
  thumbnail: string | null;
  category_id: string | null;
  start_time: number | null;
  stop_time: number | null;
  end_time: number | null;
  created_at: number;
  updated_at: number;
  synced_at: number | null;
  metadata: string | null; // JSON string with complete ML API response
}

export type UserRole = 'operator' | 'admin' | 'super_admin';

