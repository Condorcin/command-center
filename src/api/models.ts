/**
 * API Models and Types
 * 
 * Este archivo contiene todos los modelos y tipos utilizados en la API REST.
 * Estos modelos representan las estructuras de datos que se envían y reciben
 * a través de los endpoints de la API.
 */

/**
 * Formato estándar de respuesta de la API
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code?: string;
    details?: unknown;
  };
}

/**
 * Modelos de Request
 */

export interface SignupRequest {
  email: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface CreateGlobalSellerRequest {
  ml_user_id: string;
  ml_access_token: string;
  name?: string;
}

export interface UpdateGlobalSellerRequest {
  name?: string;
  ml_access_token?: string;
}

export interface SaveMercadoLibreCredentialsRequest {
  ml_user_id: string;
  ml_access_token: string;
}

/**
 * Modelos de Response
 */

export interface UserResponse {
  id: string;
  email: string;
  role: 'operator' | 'admin' | 'super_admin';
  created_at: number;
  ml_user_id?: string | null;
  ml_access_token?: string | null;
  ml_updated_at?: number | null;
}

export interface SignupResponse {
  user: UserResponse;
}

export interface LoginResponse {
  user: UserResponse;
}

export interface MeResponse {
  user: UserResponse;
}

export interface GlobalSellerResponse {
  id: string;
  user_id: string;
  ml_user_id: string;
  name?: string | null;
  created_at: number;
  updated_at: number;
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

export interface GetGlobalSellersResponse {
  globalSellers: GlobalSellerResponse[];
}

export interface GetGlobalSellerResponse {
  globalSeller: GlobalSellerResponse;
}

export interface CreateGlobalSellerResponse {
  globalSeller: GlobalSellerResponse;
}

export interface UpdateGlobalSellerResponse {
  globalSeller: GlobalSellerResponse;
}

export interface ItemsCountResponse {
  active: number;
  paused: number;
  closed: number;
  total: number;
  tokenInvalid?: boolean;
}

export interface CBTsCountResponse {
  total: number;
}

export interface CBTResponse {
  id: string;
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
  sync_log?: string | null; // 'OK' o mensaje de error
}

export interface GetSavedCBTsResponse {
  cbts: CBTResponse[];
  paging: {
    total: number;
    page: number;
    totalPages: number;
    limit: number;
  };
  syncStats: {
    synced: number;
    notSynced: number;
  };
}

export interface SyncCBTsResponse {
  message: string;
  status: 'processing';
  total: number;
}

export interface SyncIndividualCBTResponse {
  message: string;
  cbtId: string;
}

export interface SyncAllCBTsResponse {
  message: string;
  status: 'processing';
  total: number;
}

export interface PauseSyncResponse {
  message: string;
  synced: number;
  failed: number;
  currentBatchIndex: number;
}

export interface ResumeSyncResponse {
  message: string;
  synced: number;
  failed: number;
  currentBatchIndex: number;
}

export interface StopSyncResponse {
  message: string;
  synced: number;
  failed: number;
}

export interface ContinueSyncResponse {
  message: string;
  status: 'processing';
  total: number;
}

export interface MarketplaceItemResponse {
  id: string;
  item_id: string;
  global_seller_id: string;
  ml_item_id: string;
  site_id: string;
  date_created: string | null;
  created_at: number;
  updated_at: number;
  performance_score?: number | null;
  performance_level?: string | null;
  performance_level_wording?: string | null;
  performance_calculated_at?: string | null;
  performance_data?: string | null;
}

export interface GetMarketplaceItemsResponse {
  marketplaceItems: MarketplaceItemResponse[];
}

export interface PerformanceResponse {
  score: number;
  level: string;
  level_wording: string;
  calculated_at: string;
}

export interface GetPerformanceResponse {
  performance: PerformanceResponse;
}

export interface SyncPerformanceResponse {
  message: string;
  status: 'processing';
}

export interface MercadoLibreCredentialsStatusResponse {
  hasCredentials: boolean;
  ml_user_id?: string;
}

export interface MessageResponse {
  message: string;
}

/**
 * Tipos de utilidad
 */

export type UserRole = 'operator' | 'admin' | 'super_admin';

export type ItemStatus = 'active' | 'paused' | 'closed';

export type SyncStatus = 'processing' | 'paused' | 'stopped' | 'completed';

/**
 * Errores de la API
 */

export interface ApiError {
  message: string;
  code?: string;
  details?: unknown;
}

export enum ErrorCode {
  // Autenticación
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  
  // Validación
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  MISSING_ID = 'MISSING_ID',
  MISSING_TOKEN = 'MISSING_TOKEN',
  
  // Recursos
  NOT_FOUND = 'NOT_FOUND',
  DUPLICATE_EMAIL = 'DUPLICATE_EMAIL',
  
  // Mercado Libre
  ML_API_ERROR = 'ML_API_ERROR',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  
  // Servidor
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}
