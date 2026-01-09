/**
 * Service for handling Mercado Libre Items/Publications API calls
 * Implements rate limiting, batch processing, and best practices for scalability
 */

import { logger } from '../utils/logger';
import { ML_API_LIMITS, RETRY_CONFIG, VALID_ITEM_STATUSES, VALID_ORDER_OPTIONS, type ItemStatus, type OrderOption } from '../config/constants';

export interface MLItem {
  id: string;
  site_id: string;
  title: string;
  price: number;
  currency_id: string;
  available_quantity: number;
  sold_quantity: number;
  status: 'active' | 'paused' | 'closed';
  listing_type_id: string;
  condition: string;
  permalink: string;
  thumbnail: string;
  pictures?: Array<{ url: string; secure_url: string }>;
  category_id: string;
  start_time: string;
  stop_time: string;
  end_time: string;
}

export interface MLItemsSearchResponse {
  seller_id?: string;
  results: string[]; // Array of item IDs
  paging: {
    total: number;
    offset: number;
    limit: number;
  };
  paginationLimitReached?: boolean; // Indicates if ML API limit was reached
  query?: unknown;
  orders?: unknown[];
  available_orders?: unknown[];
}

export interface MLItemsBulkResponse {
  code: number;
  body: MLItem | { error: string; message: string };
}

export class MercadoLibreItemsService {
  private readonly BASE_URL = 'https://api.mercadolibre.com';
  private readonly MAX_ITEMS_PER_REQUEST = ML_API_LIMITS.MAX_ITEMS_PER_BULK_REQUEST;
  private readonly RATE_LIMIT_DELAY = ML_API_LIMITS.RATE_LIMIT_DELAY_MS;
  private lastRequestTime = 0;

  /**
   * Rate limiting helper - ensures we don't exceed ML rate limits
   */
  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.RATE_LIMIT_DELAY) {
      await new Promise(resolve => setTimeout(resolve, this.RATE_LIMIT_DELAY - timeSinceLastRequest));
    }
    
    this.lastRequestTime = Date.now();
  }

  /**
   * Make a request to ML API with error handling and retry logic
   */
  private async makeRequest<T>(url: string, accessToken: string, retries = RETRY_CONFIG.MAX_RETRIES): Promise<T> {
    await this.rateLimit();

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (response.status === 429 || response.status === 503) {
          // Rate limit exceeded or service unavailable - wait and retry
          const retryAfter = response.status === 429
            ? parseInt(response.headers.get('Retry-After') || String(RETRY_CONFIG.RETRY_AFTER_429_DEFAULT), 10)
            : Math.min(RETRY_CONFIG.RETRY_AFTER_503_DEFAULT * (attempt + 1), RETRY_CONFIG.MAX_DELAY_MS / 1000);
          
          logger.warn(`${response.status === 429 ? 'Rate limit' : 'Service unavailable'} (${response.status}). Waiting ${retryAfter}s before retry (attempt ${attempt + 1}/${retries})...`);
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          continue;
        }

        if (!response.ok) {
          const error = await response.json().catch(() => ({ message: 'Unknown error' })) as { message?: string };
          throw new Error(`ML API Error: ${error.message || response.statusText} (${response.status})`);
        }

        return await response.json() as T;
      } catch (error) {
        if (attempt === retries - 1) throw error;
        
        // Exponential backoff
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw new Error('Max retries exceeded');
  }

  /**
   * Get items/search for a user with filters
   * @param userId - ML User ID
   * @param accessToken - ML Access Token
   * @param options - Search options (status, offset, limit, order)
   */
  async searchItems(
    userId: string,
    accessToken: string,
    options: {
      status?: ItemStatus;
      offset?: number;
      limit?: number;
      order?: OrderOption;
    } = {}
  ): Promise<MLItemsSearchResponse> {
    const { status = 'active', offset = 0, limit = ML_API_LIMITS.MAX_ITEMS_PER_PAGE, order = 'start_time_desc' } = options;

    // Validate status
    const validStatus = VALID_ITEM_STATUSES.includes(status as ItemStatus) ? status : 'active';
    
    // Validate order
    const validOrder = VALID_ORDER_OPTIONS.includes(order as OrderOption) ? order : 'start_time_desc';

    // Validate and limit offset (ML has practical limits)
    const safeOffset = Math.min(Math.max(0, offset), ML_API_LIMITS.MAX_OFFSET);
    const safeLimit = Math.min(Math.max(1, limit), ML_API_LIMITS.MAX_ITEMS_PER_PAGE);

    // Warn if offset is very large
    if (offset > 1000) {
      logger.warn(`Large offset requested: ${offset}. ML API may be slow or unreliable.`);
    }

    const params = new URLSearchParams({
      status: validStatus,
      offset: safeOffset.toString(),
      limit: safeLimit.toString(),
      order: validOrder,
      access_token: accessToken, // ML API requires access_token as query parameter
    });

    const url = `${this.BASE_URL}/users/${userId}/items/search?${params.toString()}`;
    
    logger.debug(`Searching items: ${url.replace(accessToken, 'TOKEN_HIDDEN')}`);
    
    try {
      // Use direct fetch for search endpoint (it uses access_token as query param, not Bearer token)
      await this.rateLimit();
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      // Handle rate limiting (429) and service unavailable (503)
      if (response.status === 429 || response.status === 503) {
        const retryAfter = response.status === 429 
          ? parseInt(response.headers.get('Retry-After') || String(RETRY_CONFIG.RETRY_AFTER_429_DEFAULT), 10)
          : RETRY_CONFIG.RETRY_AFTER_503_DEFAULT;
        
        logger.warn(`${response.status === 429 ? 'Rate limit' : 'Service unavailable'} (${response.status}). Waiting ${retryAfter}s before retry...`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        
        // Retry once
        await this.rateLimit();
        const retryResponse = await fetch(url, {
          headers: {
            'Content-Type': 'application/json',
          },
        });
        if (!retryResponse.ok) {
          // If still failing after retry, throw error
          if (retryResponse.status === 503) {
            throw new Error(`ML API Error: Service Unavailable. Mercado Libre está temporalmente no disponible. Intenta de nuevo en unos momentos. (503)`);
          }
          const error = await retryResponse.json().catch(() => ({ message: 'Unknown error' })) as { message?: string };
          throw new Error(`ML API Error: ${error.message || retryResponse.statusText} (${retryResponse.status})`);
        }
        const result = await retryResponse.json() as MLItemsSearchResponse;
        logger.debug(`Search result after retry: ${result.results?.length || 0} items found`);
        return result;
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Unknown error' })) as { message?: string };
        const errorMessage = error.message || response.statusText || 'Unknown error';
        const errorStr = JSON.stringify(error).toLowerCase();
        
        // If it's an invalid offset/limit error (400), return empty results instead of throwing
        if (response.status === 400) {
          const isOffsetError = errorMessage.toLowerCase().includes('offset') || 
                                errorMessage.toLowerCase().includes('limit') || 
                                errorMessage.toLowerCase().includes('invalid') ||
                                errorStr.includes('offset') ||
                                errorStr.includes('limit');
          
          if (isOffsetError) {
            logger.debug(`Invalid offset/limit detected (offset=${safeOffset}, status=400). Error: ${errorMessage}. Pagination limit reached.`);
            return {
              seller_id: userId,
              results: [],
              paging: {
                total: 0,
                offset: safeOffset,
                limit: safeLimit,
              },
              query: undefined,
              orders: [],
              available_orders: [],
              paginationLimitReached: true, // Flag to indicate ML API pagination limit
            };
          }
        }
        
        throw new Error(`ML API Error: ${errorMessage} (${response.status})`);
      }

      const result = await response.json() as MLItemsSearchResponse;
      logger.debug(`Search result: ${result.results?.length || 0} items found, total: ${result.paging?.total || 0}`);
      
      // Validate response
      if (!result.paging) {
        throw new Error('Invalid response: missing paging information');
      }

      // Note: ML can return very large totals, this is normal for accounts with many items
      // We don't need to warn about this as it's expected behavior

      return result;
    } catch (error) {
      logger.error(`Error searching items:`, error);
      
      // If it's an invalid offset/limit error, return empty results
      if (error instanceof Error && 
          (error.message.includes('Invalid limit and offset') || 
           error.message.includes('Invalid offset') ||
           (error.message.includes('400') && error.message.includes('offset')))) {
        logger.debug(`Invalid offset/limit detected, returning empty results`);
        return {
          seller_id: userId,
          results: [],
          paging: {
            total: 0,
            offset: safeOffset,
            limit: safeLimit,
          },
          query: undefined,
          orders: [],
          available_orders: [],
        };
      }
      
      throw error;
    }
  }

  /**
   * Get item details by ID with full metadata
   * Uses access_token as query parameter as per ML API documentation
   */
  async getItem(itemId: string, accessToken: string): Promise<any> {
    const url = `${this.BASE_URL}/items/${itemId}?access_token=${accessToken}`;
    
    await this.rateLimit();
    
    try {
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || String(RETRY_CONFIG.RETRY_AFTER_429_DEFAULT), 10);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        return await this.getItem(itemId, accessToken); // Retry
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Unknown error' })) as { message?: string };
        throw new Error(`ML API Error: ${error.message || response.statusText} (${response.status})`);
      }

      return await response.json() as any;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Failed to fetch item details');
    }
  }

  /**
   * Get multiple items in bulk (respects ML limits)
   * ML allows up to 20 items per bulk request
   */
  async getItemsBulk(itemIds: string[], accessToken: string): Promise<MLItemsBulkResponse[]> {
    if (itemIds.length === 0) return [];

    // Split into chunks of MAX_ITEMS_PER_REQUEST
    const chunks: string[][] = [];
    for (let i = 0; i < itemIds.length; i += this.MAX_ITEMS_PER_REQUEST) {
      chunks.push(itemIds.slice(i, i + this.MAX_ITEMS_PER_REQUEST));
    }

    const allResults: MLItemsBulkResponse[] = [];

    // Process chunks sequentially to respect rate limits
    for (const chunk of chunks) {
      const idsParam = chunk.join(',');
      const url = `${this.BASE_URL}/items?ids=${idsParam}`;
      
      const results = await this.makeRequest<MLItemsBulkResponse[]>(url, accessToken);
      allResults.push(...results);
    }

    return allResults;
  }

  /**
   * Sync all items for a user (with pagination)
   * Fetches all items respecting rate limits and pagination
   */
  async syncAllItems(
    userId: string,
    accessToken: string,
    status: 'active' | 'paused' | 'closed' | 'all' = 'all',
    onProgress?: (current: number, total: number) => void
  ): Promise<MLItem[]> {
    const allItems: MLItem[] = [];
    let offset = 0;
    const limit = 50;
    let total = 0;
    let hasMore = true;

    while (hasMore) {
      const searchResult = await this.searchItems(userId, accessToken, {
        status,
        offset,
        limit,
      });

      if (total === 0) {
        total = searchResult.paging.total;
      }

      if (searchResult.results.length === 0) {
        hasMore = false;
        break;
      }

      // Fetch item details in bulk
      const itemsDetails = await this.getItemsBulk(searchResult.results, accessToken);
      
      // Filter successful responses and extract items
      for (const result of itemsDetails) {
        if (result.code === 200 && 'id' in result.body) {
          allItems.push(result.body as MLItem);
        }
      }

      if (onProgress) {
        onProgress(allItems.length, total);
      }

      offset += limit;
      hasMore = offset < total && searchResult.results.length === limit;
    }

    return allItems;
  }

  /**
   * Get items count by status
   */
  async getItemsCount(
    userId: string,
    accessToken: string
  ): Promise<{ active: number; paused: number; closed: number; total: number }> {
    try {
      const [activeResult, pausedResult, closedResult] = await Promise.all([
        this.searchItems(userId, accessToken, { status: 'active', limit: 1 }).catch(() => ({ paging: { total: 0 } })),
        this.searchItems(userId, accessToken, { status: 'paused', limit: 1 }).catch(() => ({ paging: { total: 0 } })),
        this.searchItems(userId, accessToken, { status: 'closed', limit: 1 }).catch(() => ({ paging: { total: 0 } })),
      ]);

      const active = activeResult?.paging?.total || 0;
      const paused = pausedResult?.paging?.total || 0;
      const closed = closedResult?.paging?.total || 0;

      return {
        active,
        paused,
        closed,
        total: active + paused + closed,
      };
    } catch (error) {
      logger.error('Error getting items count:', error);
      // Return zeros instead of throwing to allow UI to show something
      return {
        active: 0,
        paused: 0,
        closed: 0,
        total: 0,
      };
    }
  }
}

