/**
 * Application constants
 * Centralized configuration values
 */

export const ML_API_LIMITS = {
  MAX_OFFSET: 10000,
  MAX_ITEMS_PER_PAGE: 50,
  MAX_ITEMS_PER_BULK_REQUEST: 20,
  BATCH_SIZE: 100,
  RATE_LIMIT_DELAY_MS: 100,
} as const;

export const VALID_ITEM_STATUSES = ['active', 'paused', 'closed', 'all'] as const;
export type ItemStatus = typeof VALID_ITEM_STATUSES[number];

export const VALID_ORDER_OPTIONS = [
  'start_time_desc',
  'start_time_asc',
  'price_desc',
  'price_asc',
] as const;
export type OrderOption = typeof VALID_ORDER_OPTIONS[number];

export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 50,
  MAX_PAGE_SIZE: 100,
  DEFAULT_PAGE: 0,
} as const;

export const RETRY_CONFIG = {
  MAX_RETRIES: 3,
  INITIAL_DELAY_MS: 1000,
  MAX_DELAY_MS: 30000,
  RETRY_AFTER_429_DEFAULT: 60,
  RETRY_AFTER_503_DEFAULT: 5,
} as const;

export const SCAN_CONFIG = {
  SCROLL_ID_EXPIRY_MS: 5 * 60 * 1000, // 5 minutes in milliseconds
  MAX_ITEMS_PER_SCAN_PAGE: 100, // Max items per page when using scan
  DEFAULT_SCAN_LIMIT: 50, // Default limit for scan requests
} as const;

export const NETWORK_CONFIG = {
  REQUEST_TIMEOUT_MS: 30000, // 30 seconds timeout for requests
  CONNECTION_RETRY_DELAY_MS: 2000, // 2 seconds delay before retrying on connection errors
  MAX_CONNECTION_RETRIES: 5, // Max retries for connection errors
} as const;

