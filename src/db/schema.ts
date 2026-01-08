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
}

export type UserRole = 'operator' | 'admin' | 'super_admin';

