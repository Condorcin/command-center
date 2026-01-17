/**
 * Service for handling Mercado Libre Items/Publications API calls
 * Implements rate limiting, batch processing, and best practices for scalability
 */

import { logger } from '../utils/logger';
import { ML_API_LIMITS, RETRY_CONFIG, SCAN_CONFIG, NETWORK_CONFIG, VALID_ITEM_STATUSES, VALID_ORDER_OPTIONS, type ItemStatus, type OrderOption } from '../config/constants';

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
  scroll_id?: string; // For scan mode (search_type=scan)
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
   * Make a request to ML API with error handling, retry logic, and timeout
   */
  private async makeRequest<T>(url: string, accessToken: string, retries = RETRY_CONFIG.MAX_RETRIES): Promise<T> {
    await this.rateLimit();

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        // Create AbortController for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), NETWORK_CONFIG.REQUEST_TIMEOUT_MS);

        try {
          const response = await fetch(url, {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

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
            const error = await response.json().catch(() => ({ message: 'Unknown error', code: '' })) as { message?: string; code?: string };
            
            // Special handling for 401 (unauthorized/invalid token)
            if (response.status === 401) {
              const errorMessage = error.message || 'invalid access token';
              const errorCode = error.code || 'unauthorized';
              throw new Error(`ML API Error 401: ${errorCode} - ${errorMessage}`);
            }
            
            throw new Error(`ML API Error: ${error.message || response.statusText} (${response.status})`);
          }

          return await response.json() as T;
        } catch (fetchError) {
          clearTimeout(timeoutId);
          
          // Handle AbortError (timeout)
          if (fetchError instanceof Error && fetchError.name === 'AbortError') {
            throw new Error(`Request timeout after ${NETWORK_CONFIG.REQUEST_TIMEOUT_MS}ms`);
          }
          
          throw fetchError;
        }
      } catch (error) {
        const isNetworkError = error instanceof Error && (
          error.message.includes('Network connection lost') ||
          error.message.includes('Failed to fetch') ||
          error.message.includes('NetworkError') ||
          error.message.includes('timeout') ||
          error.name === 'TypeError' ||
          error.name === 'AbortError'
        );

        if (isNetworkError && attempt < retries - 1) {
          const delay = NETWORK_CONFIG.CONNECTION_RETRY_DELAY_MS * (attempt + 1);
          logger.warn(`Network error (attempt ${attempt + 1}/${retries}): ${error instanceof Error ? error.message : String(error)}. Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        if (attempt === retries - 1) {
          if (isNetworkError) {
            throw new Error(`Network connection error after ${retries} attempts: ${error instanceof Error ? error.message : String(error)}`);
          }
          throw error;
        }
        
        // Exponential backoff for other errors
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
    
// logger.debug(`Searching items: ${url.replace(accessToken, 'TOKEN_HIDDEN')}`);
    
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
// logger.debug(`Search result after retry: ${result.results?.length || 0} items found`);
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
// logger.debug(`Invalid offset/limit detected (offset=${safeOffset}, status=400). Error: ${errorMessage}. Pagination limit reached.`);
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
// logger.debug(`Search result: ${result.results?.length || 0} items found, total: ${result.paging?.total || 0}`);
      
      // Validate response
      if (!result.paging) {
        throw new Error('Invalid response: missing paging information');
      }

      // Note: ML can return very large totals, this is normal for accounts with many items
      // We don't need to warn about this as it's expected behavior

      return result;
    } catch (error) {
      // Handle network errors specifically
      if (error instanceof Error && (
        error.message.includes('Network connection lost') ||
        error.message.includes('Network connection error') ||
        error.message.includes('Failed to fetch') ||
        error.message.includes('timeout')
      )) {
        logger.error(`Network error searching items:`, error);
        throw new Error(`Network connection error: ${error.message}. Please check your internet connection and try again.`);
      }
      
      logger.error(`Error searching items:`, error);
      
      // If it's an invalid offset/limit error, return empty results
      if (error instanceof Error && 
          (error.message.includes('Invalid limit and offset') || 
           error.message.includes('Invalid offset') ||
           (error.message.includes('400') && error.message.includes('offset')))) {
// logger.debug(`Invalid offset/limit detected, returning empty results`);
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
   * Get marketplace item details for a CBT
   * Endpoint: /marketplace/items/{CBT_ID}?access_token={TOKEN}
   * Returns title, price, category_id, sold_quantity, pictures, etc.
   */
  async getMarketplaceItemDetails(cbtId: string, accessToken: string): Promise<{
    title: string;
    listing_type_id: string;
    price: number;
    category_id: string;
    sold_quantity: number;
    status: string;
    sub_status: string[];
    pictures: Array<{
      id: string;
      url: string;
      secure_url: string;
    }>;
    [key: string]: any; // Allow other fields
  }> {
    const url = `${this.BASE_URL}/marketplace/items/${cbtId}?access_token=${accessToken}`;
    
// logger.debug(`Getting marketplace item details for CBT: ${cbtId}`);
    
    await this.rateLimit();
    
    try {
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      // Special handling for 401 (unauthorized/invalid token)
      if (response.status === 401) {
        const error = await response.json().catch(() => ({ message: 'Unknown error', code: '' })) as { message?: string; code?: string };
        const errorMessage = error.message || 'invalid access token';
        const errorCode = error.code || 'unauthorized';
        throw new Error(`ML API Error 401: ${errorCode} - ${errorMessage}`);
      }

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
          // Check if retry also failed with 401
          if (retryResponse.status === 401) {
            const error = await retryResponse.json().catch(() => ({ message: 'Unknown error', code: '' })) as { message?: string; code?: string };
            const errorMessage = error.message || 'invalid access token';
            const errorCode = error.code || 'unauthorized';
            throw new Error(`ML API Error 401: ${errorCode} - ${errorMessage}`);
          }
          
          const error = await retryResponse.json().catch(() => ({ message: 'Unknown error' })) as { message?: string };
          throw new Error(`ML API Error: ${error.message || retryResponse.statusText} (${retryResponse.status})`);
        }
        
        return await retryResponse.json();
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Unknown error', code: '' })) as { message?: string; code?: string };
        
        // Check for 401 in other error responses
        if (response.status === 401) {
          const errorMessage = error.message || 'invalid access token';
          const errorCode = error.code || 'unauthorized';
          throw new Error(`ML API Error 401: ${errorCode} - ${errorMessage}`);
        }
        
        throw new Error(`ML API Error: ${error.message || response.statusText} (${response.status})`);
      }

      const result = await response.json() as {
        title: string;
        listing_type_id: string;
        price: number;
        category_id: string;
        sold_quantity: number;
        status: string;
        sub_status: string[];
        pictures: Array<{
          id: string;
          url: string;
          secure_url: string;
        }>;
        [key: string]: any;
      };
      
// logger.debug(`Got marketplace item details for CBT ${cbtId}: title=${result.title}, price=${result.price}`);
      
      return result;
    } catch (error) {
      logger.error(`Error getting marketplace item details for CBT ${cbtId}:`, error);
      throw error;
    }
  }

  /**
   * Get multiple items in bulk using Multiget endpoint
   * ML allows up to 20 items per bulk request
   * Returns items in verbose format: [{ code: 200, body: {...} }, ...]
   */
  async getItemsBulk(itemIds: string[], accessToken: string): Promise<Array<{
    code: number;
    body?: {
      id: string;
      title: string;
      listing_type_id: string;
      price: number;
      category_id: string;
      sold_quantity: number;
      status: string;
      sub_status: string[];
      pictures?: Array<{
        id: string;
        url: string;
        secure_url: string;
      }>;
      [key: string]: any;
    };
    message?: string;
  }>> {
    if (itemIds.length === 0) {
      return [];
    }

    if (itemIds.length > ML_API_LIMITS.MAX_ITEMS_PER_BULK_REQUEST) {
      throw new Error(`Cannot request more than ${ML_API_LIMITS.MAX_ITEMS_PER_BULK_REQUEST} items at once`);
    }

    const idsParam = itemIds.join(',');
    const url = `${this.BASE_URL}/items?ids=${idsParam}&access_token=${accessToken}`;
    
// logger.debug(`Getting bulk items for ${itemIds.length} items using Multiget`);
    
    await this.rateLimit();
    
    try {
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      // Special handling for 401 (unauthorized/invalid token)
      if (response.status === 401) {
        const error = await response.json().catch(() => ({ message: 'Unknown error', code: '' })) as { message?: string; code?: string };
        const errorMessage = error.message || 'invalid access token';
        const errorCode = error.code || 'unauthorized';
        throw new Error(`ML API Error 401: ${errorCode} - ${errorMessage}`);
      }

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
          // Check if retry also failed with 401
          if (retryResponse.status === 401) {
            const error = await retryResponse.json().catch(() => ({ message: 'Unknown error', code: '' })) as { message?: string; code?: string };
            const errorMessage = error.message || 'invalid access token';
            const errorCode = error.code || 'unauthorized';
            throw new Error(`ML API Error 401: ${errorCode} - ${errorMessage}`);
          }
          
          const error = await retryResponse.json().catch(() => ({ message: 'Unknown error' })) as { message?: string };
          throw new Error(`ML API Error: ${error.message || retryResponse.statusText} (${retryResponse.status})`);
        }
        
        return await retryResponse.json();
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Unknown error', code: '' })) as { message?: string; code?: string };
        
        // Check for 401 in other error responses
        if (response.status === 401) {
          const errorMessage = error.message || 'invalid access token';
          const errorCode = error.code || 'unauthorized';
          throw new Error(`ML API Error 401: ${errorCode} - ${errorMessage}`);
        }
        
        throw new Error(`ML API Error: ${error.message || response.statusText} (${response.status})`);
      }

      const result = await response.json() as Array<{
        code: number;
        body?: {
          id: string;
          title: string;
          listing_type_id: string;
          price: number;
          category_id: string;
          sold_quantity: number;
          status: string;
          sub_status: string[];
          pictures?: Array<{
            id: string;
            url: string;
            secure_url: string;
          }>;
          [key: string]: any;
        };
        message?: string;
      }>;
      
// logger.debug(`Got bulk items: ${result.filter(r => r.code === 200).length}/${itemIds.length} successful`);
      
      return result;
    } catch (error) {
      logger.error(`Error getting bulk items:`, error);
      throw error;
    }
  }


  /**
   * Sync all items for a user (with pagination)
   * Automatically uses scan mode if total > 1000, otherwise uses regular pagination
   * Fetches all items respecting rate limits and pagination
   */
  async syncAllItems(
    userId: string,
    accessToken: string,
    status: 'active' | 'paused' | 'closed' | 'all' = 'all',
    onProgress?: (current: number, total: number) => void
  ): Promise<MLItem[]> {
    // First, check total count to decide which method to use
// logger.debug(`[SYNC ALL] Checking total items count for user ${userId}, status: ${status}`);
    
    let totalCount = 0;
    try {
      // Get a small sample to check total
      const sampleResult = await this.searchItems(userId, accessToken, {
        status,
        offset: 0,
        limit: 1,
      });
      totalCount = sampleResult.paging?.total || 0;
// logger.debug(`[SYNC ALL] Total items: ${totalCount}`);
    } catch (error) {
      logger.warn(`[SYNC ALL] Could not get total count, will use scan mode:`, error);
      totalCount = 1001; // Force scan mode
    }

    // If total > 1000, use scan mode (required by ML API)
    if (totalCount > 1000) {
      logger.info(`[SYNC ALL] Total (${totalCount}) > 1000, using scan mode`);
      return await this.syncAllItemsWithScan(userId, accessToken, status, onProgress);
    } else {
      logger.info(`[SYNC ALL] Total (${totalCount}) <= 1000, using regular pagination`);
      return await this.syncAllItemsWithOffset(userId, accessToken, status, onProgress);
    }
  }

  /**
   * Sync all items using scan mode (for >1000 items)
   */
  private async syncAllItemsWithScan(
    userId: string,
    accessToken: string,
    status: ItemStatus,
    onProgress?: (current: number, total: number) => void
  ): Promise<MLItem[]> {
    const allItems: MLItem[] = [];

    // Get all item IDs using scan mode
    const allItemIds = await this.getAllItemsWithScan(
      userId,
      accessToken,
      status,
      (current, totalEstimated) => {
        if (onProgress) {
          onProgress(current, totalEstimated || current);
        }
      }
    );

    logger.info(`[SYNC ALL SCAN] Retrieved ${allItemIds.length} item IDs, now fetching details...`);

    // Fetch item details in bulk (respecting 20 items per request)
    const batchSize = this.MAX_ITEMS_PER_REQUEST;
    for (let i = 0; i < allItemIds.length; i += batchSize) {
      const batch = allItemIds.slice(i, i + batchSize);
      const itemsDetails = await this.getItemsBulk(batch, accessToken);
      
      // Filter successful responses and extract items
      for (const result of itemsDetails) {
        if (result.code === 200 && result.body && 'id' in result.body) {
          allItems.push(result.body as unknown as MLItem);
        }
      }

      if (onProgress) {
        onProgress(allItems.length, allItemIds.length);
      }

// logger.debug(`[SYNC ALL SCAN] Fetched details for ${allItems.length}/${allItemIds.length} items...`);
    }

    logger.info(`[SYNC ALL SCAN] Complete: ${allItems.length} items synced`);
    return allItems;
  }

  /**
   * Sync all items using regular offset pagination (for <=1000 items)
   */
  private async syncAllItemsWithOffset(
    userId: string,
    accessToken: string,
    status: ItemStatus,
    onProgress?: (current: number, total: number) => void
  ): Promise<MLItem[]> {
    const allItems: MLItem[] = [];
    let offset = 0;
    const limit = ML_API_LIMITS.MAX_ITEMS_PER_PAGE;
    let total = 0;
    let hasMore = true;

    while (hasMore) {
      const searchResult = await this.searchItems(userId, accessToken, {
        status,
        offset,
        limit,
      });

      if (total === 0) {
        total = searchResult.paging?.total || 0;
      }

      if (searchResult.results.length === 0) {
        hasMore = false;
        break;
      }

      // Fetch item details in bulk
      const itemsDetails = await this.getItemsBulk(searchResult.results, accessToken);
      
      // Filter successful responses and extract items
      for (const result of itemsDetails) {
        if (result.code === 200 && result.body && 'id' in result.body) {
          allItems.push(result.body as unknown as MLItem);
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
  ): Promise<{ active: number; paused: number; closed: number; total: number; tokenInvalid?: boolean }> {
    try {
      const [activeResult, pausedResult, closedResult] = await Promise.all([
        this.searchItems(userId, accessToken, { status: 'active', limit: 1 }).catch((err) => {
          // Check if it's a 401 error (invalid token)
          if (err instanceof Error && (err.message.includes('401') || err.message.includes('invalid access token'))) {
            return { paging: { total: 0 }, tokenInvalid: true };
          }
          return { paging: { total: 0 } };
        }),
        this.searchItems(userId, accessToken, { status: 'paused', limit: 1 }).catch((err) => {
          if (err instanceof Error && (err.message.includes('401') || err.message.includes('invalid access token'))) {
            return { paging: { total: 0 }, tokenInvalid: true };
          }
          return { paging: { total: 0 } };
        }),
        this.searchItems(userId, accessToken, { status: 'closed', limit: 1 }).catch((err) => {
          if (err instanceof Error && (err.message.includes('401') || err.message.includes('invalid access token'))) {
            return { paging: { total: 0 }, tokenInvalid: true };
          }
          return { paging: { total: 0 } };
        }),
      ]);

      // Check if any request indicated token is invalid
      const tokenInvalid = (activeResult as any)?.tokenInvalid || 
                          (pausedResult as any)?.tokenInvalid || 
                          (closedResult as any)?.tokenInvalid;

      const active = activeResult?.paging?.total || 0;
      const paused = pausedResult?.paging?.total || 0;
      const closed = closedResult?.paging?.total || 0;

      return {
        active,
        paused,
        closed,
        total: active + paused + closed,
        tokenInvalid: tokenInvalid || undefined,
      };
    } catch (error) {
      // Check if it's a 401 error (invalid token)
      const isTokenError = error instanceof Error && 
                          (error.message.includes('401') || error.message.includes('invalid access token'));
      
      if (isTokenError) {
        logger.warn('Invalid access token when getting items count. Token may have expired.');
      } else {
        logger.error('Error getting items count:', error);
      }
      
      // Return zeros instead of throwing to allow UI to show something
      return {
        active: 0,
        paused: 0,
        closed: 0,
        total: 0,
        tokenInvalid: isTokenError || undefined,
      };
    }
  }

  /**
   * Search items using scan mode (for more than 1000 items)
   * Uses search_type=scan and scroll_id for pagination
   * @param userId - ML User ID
   * @param accessToken - ML Access Token
   * @param options - Search options (status, limit, scroll_id)
   * @returns Search result with item IDs and scroll_id for next page
   */
  async searchItemsWithScan(
    userId: string,
    accessToken: string,
    options: {
      limit?: number;
      scroll_id?: string;
    } = {}
  ): Promise<MLItemsSearchResponse> {
    const { limit = SCAN_CONFIG.DEFAULT_SCAN_LIMIT, scroll_id } = options;
    
    // Validate limit (max 100 for scan mode)
    const safeLimit = Math.min(Math.max(1, limit), SCAN_CONFIG.MAX_ITEMS_PER_SCAN_PAGE);

    const params = new URLSearchParams({
      search_type: 'scan',
      limit: safeLimit.toString(),
      access_token: accessToken,
    });

    // If scroll_id is provided, add it to params (for subsequent pages)
    if (scroll_id) {
      params.append('scroll_id', scroll_id);
    }

    const url = `${this.BASE_URL}/users/${userId}/items/search?${params.toString()}`;
    
// logger.debug(`Searching items with scan mode: ${url.replace(accessToken, 'TOKEN_HIDDEN')}${scroll_id ? ` (scroll_id: ${scroll_id.substring(0, 20)}...)` : ''}`);
    
    try {
      await this.rateLimit();
      
      console.log(`[SCAN] 🌐 Making request to ML API (timeout: ${NETWORK_CONFIG.REQUEST_TIMEOUT_MS}ms)...`);
      
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        console.error(`[SCAN] ⏱️ Request timeout after ${NETWORK_CONFIG.REQUEST_TIMEOUT_MS}ms`);
        controller.abort();
      }, NETWORK_CONFIG.REQUEST_TIMEOUT_MS);

      let response: Response;
      try {
        const fetchStartTime = Date.now();
        response = await fetch(url, {
          headers: {
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
        });
        const fetchDuration = Date.now() - fetchStartTime;
        console.log(`[SCAN] ✅ Response received in ${fetchDuration}ms, status: ${response.status}`);
        console.log(`[SCAN] 📋 Response URL: ${url.replace(accessToken, 'TOKEN_HIDDEN')}`);
        clearTimeout(timeoutId);
      } catch (fetchError) {
        clearTimeout(timeoutId);
        
        // Handle timeout and network errors
        if (fetchError instanceof Error && (fetchError.name === 'AbortError' || fetchError.message.includes('Network'))) {
          throw new Error(`Network connection error: ${fetchError.message}`);
        }
        throw fetchError;
      }

      // Handle rate limiting (429) and service unavailable (503)
      if (response.status === 429 || response.status === 503) {
        const retryAfter = response.status === 429 
          ? parseInt(response.headers.get('Retry-After') || String(RETRY_CONFIG.RETRY_AFTER_429_DEFAULT), 10)
          : RETRY_CONFIG.RETRY_AFTER_503_DEFAULT;
        
        logger.warn(`${response.status === 429 ? 'Rate limit' : 'Service unavailable'} (${response.status}). Waiting ${retryAfter}s before retry...`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        
        // Retry once with timeout
        await this.rateLimit();
        const retryController = new AbortController();
        const retryTimeoutId = setTimeout(() => retryController.abort(), NETWORK_CONFIG.REQUEST_TIMEOUT_MS);
        
        try {
          const retryResponse = await fetch(url, {
            headers: {
              'Content-Type': 'application/json',
            },
            signal: retryController.signal,
          });
          clearTimeout(retryTimeoutId);
          
          if (!retryResponse.ok) {
            const error = await retryResponse.json().catch(() => ({ message: 'Unknown error' })) as { message?: string };
            throw new Error(`ML API Error: ${error.message || retryResponse.statusText} (${retryResponse.status})`);
          }
          const result = await retryResponse.json() as MLItemsSearchResponse;
// logger.debug(`Search result after retry: ${result.results?.length || 0} items found`);
          return result;
        } catch (retryError) {
          clearTimeout(retryTimeoutId);
          if (retryError instanceof Error && retryError.name === 'AbortError') {
            throw new Error(`Request timeout after ${NETWORK_CONFIG.REQUEST_TIMEOUT_MS}ms`);
          }
          throw retryError;
        }
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Unknown error', code: '' })) as { message?: string; code?: string };
        
        // Special handling for 401 (unauthorized/invalid token)
        if (response.status === 401) {
          const errorMessage = error.message || 'invalid access token';
          const errorCode = error.code || 'unauthorized';
          throw new Error(`ML API Error 401: ${errorCode} - ${errorMessage}`);
        }
        
        // Special handling for scroll_id expiration (usually 400 with message about scroll_id)
        if (response.status === 400) {
          const errorMessage = (error.message || '').toLowerCase();
          const errorCode = (error.code || '').toLowerCase();
          if (errorMessage.includes('scroll_id') || errorCode.includes('scroll_id') || 
              errorMessage.includes('scroll') || (errorMessage.includes('invalid') && errorMessage.includes('id'))) {
            throw new Error(`ML API Error 400: scroll_id expired or invalid - ${error.message || 'scroll_id expired'}`);
          }
        }
        
        throw new Error(`ML API Error: ${error.message || response.statusText} (${response.status})`);
      }

      const result = await response.json() as MLItemsSearchResponse;
      
      // Handle null scroll_id (end of results per ML docs)
      const scrollIdStatus = result.scroll_id === null 
        ? 'null (end of results)' 
        : result.scroll_id === undefined 
          ? 'undefined (end of results)' 
          : `present (${result.scroll_id.substring(0, 20)}...)`;
      
// logger.debug(`[SCAN] Search result: ${result.results?.length || 0} items found, scroll_id: ${scrollIdStatus}`);
      console.log(`[SCAN] 📦 Search result: ${result.results?.length || 0} items found, scroll_id: ${scrollIdStatus}`);
      
      // Validate response - paging might not be present in scan mode
      // According to ML docs, scan mode doesn't always return paging info
      if (result.paging) {
// logger.debug(`[SCAN] Paging info: total=${result.paging.total}, offset=${result.paging.offset}, limit=${result.paging.limit}`);
      }

      return result;
      } catch (error) {
        console.error(`[SCAN] ❌ Error in searchItemsWithScan:`, error);
        logger.error(`[SCAN] Error in searchItemsWithScan:`, error);
        
        // Handle network errors specifically
        if (error instanceof Error && (
          error.message.includes('Network connection lost') ||
          error.message.includes('Network connection error') ||
          error.message.includes('Failed to fetch') ||
          error.message.includes('timeout')
        )) {
          logger.error(`Network error in scan mode:`, error);
          console.error(`[SCAN] ❌ Network error: ${error.message}`);
          throw new Error(`Network connection error: ${error.message}. Please check your internet connection and try again.`);
        }
        
        logger.error(`Error searching items with scan mode:`, error);
        throw error;
      }
  }

  /**
   * Get all items using scan mode (handles pagination automatically)
   * Fetches all items respecting rate limits and scroll_id pagination
   * According to ML docs: when scroll_id is null, we've reached the end
   * @param userId - ML User ID
   * @param accessToken - ML Access Token
   * @param status - Item status filter
   * @param onProgress - Optional callback for progress updates (current, total_estimated)
   * @returns Array of all item IDs
   */
  async getAllItemsWithScan(
    userId: string,
    accessToken: string,
    status: ItemStatus = 'active',
    onProgress?: (current: number, totalEstimated?: number) => void
  ): Promise<string[]> {
    const allItemIds: string[] = [];
    let scrollId: string | null | undefined;
    let hasMore = true;
    let pageCount = 0;
    let totalEstimated: number | undefined;

    logger.info(`[SCAN] Starting scan mode search for user ${userId}, status: ${status}`);
    logger.info(`[SCAN] Using limit: ${SCAN_CONFIG.MAX_ITEMS_PER_SCAN_PAGE} items per page (max allowed by ML API)`);

    // First request: get initial results and scroll_id
    while (hasMore) {
      pageCount++;
      
      try {
        const searchResult = await this.searchItemsWithScan(userId, accessToken, {
          limit: SCAN_CONFIG.MAX_ITEMS_PER_SCAN_PAGE, // Use max limit (100) for efficiency
          scroll_id: scrollId || undefined, // Only include scroll_id if we have one
        });

        // Get total from first page if available
        if (pageCount === 1 && searchResult.paging?.total) {
          totalEstimated = searchResult.paging.total;
          logger.info(`[SCAN] Total items estimated: ${totalEstimated}`);
        }

        // Add results if any
        if (searchResult.results && searchResult.results.length > 0) {
          allItemIds.push(...searchResult.results);
          
          if (onProgress) {
            onProgress(allItemIds.length, totalEstimated);
          }

          logger.info(`[SCAN] Page ${pageCount}: Got ${searchResult.results.length} items (total so far: ${allItemIds.length}${totalEstimated ? ` / ${totalEstimated}` : ''})`);
        }

        // Check scroll_id: null means end of results (per ML docs)
        if (searchResult.scroll_id === null || searchResult.scroll_id === undefined) {
          // No scroll_id means we've reached the end
          hasMore = false;
          logger.info(`[SCAN] Reached end of results (scroll_id is null/undefined). Total items retrieved: ${allItemIds.length}`);
        } else {
          // We have a scroll_id, continue to next page
          scrollId = searchResult.scroll_id;
          hasMore = true;
          
          // Log progress every 10 pages
          if (pageCount % 10 === 0) {
            logger.info(`[SCAN] Progress: ${allItemIds.length} items retrieved in ${pageCount} pages...`);
          }
        }

        // Safety check: if we got no results and no scroll_id, we're done
        if ((!searchResult.results || searchResult.results.length === 0) && !searchResult.scroll_id) {
          hasMore = false;
          logger.info(`[SCAN] No more results available. Total items retrieved: ${allItemIds.length}`);
        }
      } catch (error) {
        logger.error(`[SCAN] Error on page ${pageCount}:`, error);
        // If we have some items, continue; otherwise throw
        if (allItemIds.length === 0) {
          throw error;
        }
        // Log warning but continue with what we have
        logger.warn(`[SCAN] Continuing with ${allItemIds.length} items retrieved so far...`);
        hasMore = false;
      }
    }

    logger.info(`[SCAN] Scan complete: Retrieved ${allItemIds.length} item IDs in ${pageCount} pages${totalEstimated ? ` (expected: ${totalEstimated})` : ''}`);
    return allItemIds;
  }

  /**
   * Sync marketplace items for all CBTs of a user
   * Identifies CBTs and fetches their marketplace items
   * @param userId - ML User ID
   * @param accessToken - ML Access Token
   * @param onProgress - Optional callback for progress updates
   * @returns Summary of sync operation
   */
  async syncCbtMarketplaceItems(
    userId: string,
    accessToken: string,
    onProgress?: (current: number, total: number, cbtId: string) => void
  ): Promise<{
    total_cbts: number;
    total_marketplace_items: number;
    synced_cbts: number;
    failed_cbts: number;
    errors: Array<{ cbt_id: string; error: string }>;
  }> {
    const results = {
      total_cbts: 0,
      total_marketplace_items: 0,
      synced_cbts: 0,
      failed_cbts: 0,
      errors: [] as Array<{ cbt_id: string; error: string }>,
    };

    try {
// logger.debug(`Starting CBT marketplace items sync for user ${userId}`);

      // Get all items using scan mode (to handle >1000 items)
      const allItemIds = await this.getAllItemsWithScan(
        userId,
        accessToken,
        'all', // Get all statuses
        (current) => {
// logger.debug(`Scanning items: ${current} item IDs found so far...`);
        }
      );

// logger.debug(`Found ${allItemIds.length} total items. Checking which are CBTs...`);

      // Get item details in bulk to identify CBTs
      // CBTs typically have site_id starting with "CBT" or have marketplace_items
      // We'll check by fetching details in batches
      const batchSize = this.MAX_ITEMS_PER_REQUEST;
      const cbtIds: string[] = [];

      for (let i = 0; i < allItemIds.length; i += batchSize) {
        const batch = allItemIds.slice(i, i + batchSize);
        const itemsDetails = await this.getItemsBulk(batch, accessToken);

        for (const result of itemsDetails) {
          if (result.code === 200 && result.body && 'id' in result.body) {
            const item = result.body;
            // Check if item is a CBT (site_id starts with "CBT" or has specific characteristics)
            // Note: We'll try to get marketplace_items for all items, and if it fails, it's not a CBT
            if (item.site_id && typeof item.site_id === 'string' && item.site_id.startsWith('CBT')) {
              cbtIds.push(item.id);
            }
          }
        }
      }

      // If we didn't find CBTs by site_id, we'll try to get marketplace_items for all items
      // and see which ones succeed (those are CBTs)
      if (cbtIds.length === 0) {
// logger.debug(`No CBTs found by site_id pattern. Checking all items for marketplace_items...`);
        
        // Sample first 100 items to check if they're CBTs
        const sampleSize = Math.min(100, allItemIds.length);
        const sampleIds = allItemIds.slice(0, sampleSize);
        
        for (const itemId of sampleIds) {
          try {
            const marketplaceData = await this.getMarketplaceItems(itemId, accessToken);
            if (marketplaceData.marketplace_items && marketplaceData.marketplace_items.length > 0) {
              cbtIds.push(itemId);
            }
          } catch (error) {
            // Not a CBT or error fetching - skip
            continue;
          }
        }

        // If we found CBTs in the sample, check all items
        if (cbtIds.length > 0) {
// logger.debug(`Found ${cbtIds.length} CBTs in sample. Checking all ${allItemIds.length} items...`);
          cbtIds.length = 0; // Clear sample results
          
          // Check all items (this might take a while)
          for (let i = 0; i < allItemIds.length; i++) {
            const itemId = allItemIds[i];
            try {
              const marketplaceData = await this.getMarketplaceItems(itemId, accessToken);
              if (marketplaceData.marketplace_items && marketplaceData.marketplace_items.length > 0) {
                cbtIds.push(itemId);
                if (onProgress) {
                  onProgress(i + 1, allItemIds.length, itemId);
                }
              }
            } catch (error) {
              // Not a CBT or error fetching - skip
              continue;
            }
            
            // Small delay to respect rate limits
            if (i % 10 === 0) {
              await this.rateLimit();
            }
          }
        }
      }

      results.total_cbts = cbtIds.length;
// logger.debug(`Found ${cbtIds.length} CBTs. Syncing marketplace items...`);

      // For each CBT, get marketplace items
      for (let i = 0; i < cbtIds.length; i++) {
        const cbtId = cbtIds[i];
        try {
          const marketplaceData = await this.getMarketplaceItems(cbtId, accessToken);
          
          if (marketplaceData.marketplace_items && marketplaceData.marketplace_items.length > 0) {
            results.total_marketplace_items += marketplaceData.marketplace_items.length;
            results.synced_cbts++;
            
            if (onProgress) {
              onProgress(i + 1, cbtIds.length, cbtId);
            }
            
// logger.debug(`CBT ${cbtId}: ${marketplaceData.marketplace_items.length} marketplace items`);
          }
        } catch (error) {
          results.failed_cbts++;
          const errorMessage = error instanceof Error ? error.message : String(error);
          results.errors.push({ cbt_id: cbtId, error: errorMessage });
          logger.warn(`Failed to get marketplace items for CBT ${cbtId}:`, errorMessage);
        }
        
        // Rate limiting
        await this.rateLimit();
      }

// logger.debug(`CBT marketplace items sync complete: ${results.synced_cbts}/${results.total_cbts} CBTs synced, ${results.total_marketplace_items} total marketplace items`);
      
      return results;
    } catch (error) {
      logger.error(`Error in syncCbtMarketplaceItems:`, error);
      throw error;
    }
  }

  /**
   * Get marketplace items for a CBT (Cross-Border Trade item)
   * Returns information about which countries/sites the CBT is published in
   */
  async getMarketplaceItems(
    cbtId: string,
    accessToken: string
  ): Promise<{
    item_id: string;
    user_id: number;
    site_id: string;
    date_created: string;
    marketplace_items: Array<{
      item_id: string;
      user_id: number;
      site_id: string;
      date_created: string;
      logistic_type: string;
      parent_id: string;
      parent_user_id: number;
    }>;
  }> {
    const url = `${this.BASE_URL}/items/${cbtId}/marketplace_items?access_token=${accessToken}`;
    
// logger.debug(`Getting marketplace items for CBT: ${cbtId}`);
    
    await this.rateLimit();
    
    try {
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

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
          const error = await retryResponse.json().catch(() => ({ message: 'Unknown error' })) as { message?: string };
          throw new Error(`ML API Error: ${error.message || retryResponse.statusText} (${retryResponse.status})`);
        }
        
        return await retryResponse.json();
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Unknown error' })) as { message?: string };
        throw new Error(`ML API Error: ${error.message || response.statusText} (${response.status})`);
      }

      const result = await response.json() as {
        item_id: string;
        user_id: number;
        site_id: string;
        date_created: string;
        marketplace_items: Array<{
          item_id: string;
          user_id: number;
          site_id: string;
          date_created: string;
          logistic_type: string;
          parent_id: string;
          parent_user_id: number;
        }>;
      };
// logger.debug(`Got ${result.marketplace_items?.length || 0} marketplace items for CBT ${cbtId}`);
      
      return result;
    } catch (error) {
      logger.error(`Error getting marketplace items for CBT ${cbtId}:`, error);
      throw error;
    }
  }

  /**
   * Get item performance/quality score (Listings Quality)
   * Returns quality metrics for a marketplace item
   */
  async getItemPerformance(
    mlItemId: string,
    accessToken: string
  ): Promise<{
    entity_type: string;
    entity_id: string;
    score: number;
    level: 'Bad' | 'Average' | 'Good';
    level_wording: string;
    calculated_at: string;
    buckets: Array<{
      key: string;
      type: string;
      status: 'PENDING' | 'COMPLETED';
      score: number;
      title: string;
      calculated_at: string;
      variables: Array<{
        key: string;
        status: 'PENDING' | 'COMPLETED';
        score: number;
        calculated_at: string;
        title: string;
        rules: Array<{
          key: string;
          status: 'PENDING' | 'COMPLETED';
          progress: number;
          mode: 'OPPORTUNITY' | 'WARNING';
          calculated_at: string;
          wordings: {
            title: string;
            label: string;
            link: string;
          };
        }>;
      }>;
    }>;
  }> {
    const url = `${this.BASE_URL}/items/${mlItemId}/performance?access_token=${accessToken}`;
    
// logger.debug(`Getting performance for item: ${mlItemId}`);
    
    await this.rateLimit();
    
    try {
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

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
          const error = await retryResponse.json().catch(() => ({ message: 'Unknown error' })) as { message?: string };
          throw new Error(`ML API Error: ${error.message || retryResponse.statusText} (${retryResponse.status})`);
        }
        
        return await retryResponse.json();
      }

      if (!response.ok) {
        // 404 is valid - item might not have performance data yet
        if (response.status === 404) {
          throw new Error('Performance data not available for this item');
        }
        const error = await response.json().catch(() => ({ message: 'Unknown error' })) as { message?: string };
        throw new Error(`ML API Error: ${error.message || response.statusText} (${response.status})`);
      }

      const result = await response.json() as {
        entity_type: string;
        entity_id: string;
        score: number;
        level: 'Bad' | 'Average' | 'Good';
        level_wording: string;
        calculated_at: string;
        buckets: Array<{
          key: string;
          type: string;
          status: 'PENDING' | 'COMPLETED';
          score: number;
          title: string;
          calculated_at: string;
          variables: Array<{
            key: string;
            status: 'PENDING' | 'COMPLETED';
            score: number;
            calculated_at: string;
            title: string;
            rules: Array<{
              key: string;
              status: 'PENDING' | 'COMPLETED';
              progress: number;
              mode: 'OPPORTUNITY' | 'WARNING';
              calculated_at: string;
              wordings: {
                title: string;
                label: string;
                link: string;
              };
            }>;
          }>;
        }>;
      };
// logger.debug(`Got performance for item ${mlItemId}: score=${result.score}, level=${result.level}`);
      
      return result;
    } catch (error) {
      logger.error(`Error getting performance for item ${mlItemId}:`, error);
      throw error;
    }
  }

  /**
   * Get all CBTs (Cross Border Trade items) for a user using scan mode
   * Processes items in batches and stops when maxCBTs is reached (if specified)
   * CBTs are identified by site_id starting with "CBT"
   * 
   * @param userId - ML User ID
   * @param accessToken - ML Access Token
   * @param options - Options for CBT search
   * @returns Array of CBT items with details
   */
  /**
   * Phase 1: Get all CBT IDs using scan mode (handles scroll_id expiration)
   * This phase only gets item IDs and identifies CBTs by checking site_id
   */
  async getAllCBTIds(
    userId: string,
    accessToken: string,
    options: {
      status?: ItemStatus;
      maxCBTs?: number;
      maxItems?: number; // Maximum items to process (stops when reached)
      onProgress?: (processed: number, found: number, totalEstimated?: number) => void;
    } = {}
  ): Promise<{
    cbtIds: string[];
    totalProcessed: number;
    totalEstimated?: number;
  }> {
    const { 
      status = 'active', 
      maxCBTs,
      maxItems,
      onProgress 
    } = options;

    const cbtIds: string[] = [];
    let scrollId: string | null | undefined = null;
    let scrollIdStartTime: number | null = null; // Track when scroll_id was obtained
    let hasMore = true;
    let pageCount = 0;
    let totalEstimated: number | undefined;
    let processedCount = 0;
    const batchSize = this.MAX_ITEMS_PER_REQUEST; // 20 items per bulk request

    logger.info(`[GET CBT IDs] Phase 1: Starting CBT ID collection for user ${userId}, status: ${status}${maxCBTs ? `, max: ${maxCBTs}` : ''}`);

    // Process in batches: get items and identify CBTs by site_id
    while (hasMore && (!maxCBTs || cbtIds.length < maxCBTs) && (!maxItems || processedCount < maxItems)) {
      // Check if we've reached maxItems limit
      if (maxItems && processedCount >= maxItems) {
        logger.info(`[GET CBT IDs] Reached maxItems limit: ${processedCount} items processed (limit: ${maxItems})`);
        hasMore = false;
        break;
      }

      // Check if scroll_id has expired (5 minutes)
      const now = Date.now();
      if (scrollId && scrollIdStartTime && (now - scrollIdStartTime) >= SCAN_CONFIG.SCROLL_ID_EXPIRY_MS) {
        logger.warn(`[GET CBT IDs] Scroll ID expired after ${(now - scrollIdStartTime) / 1000}s, renewing...`);
        scrollId = null;
        scrollIdStartTime = null;
      }

      try {
        console.log(`[GET CBT IDs] 🔍 Fetching page ${pageCount + 1} with scan mode${scrollId ? ` (using scroll_id)` : ' (first page)'}...`);
        const searchResult = await this.searchItemsWithScan(userId, accessToken, {
          limit: SCAN_CONFIG.MAX_ITEMS_PER_SCAN_PAGE,
          scroll_id: scrollId || undefined,
        });

        console.log(`[GET CBT IDs] ✅ Received ${searchResult.results?.length || 0} item IDs from page ${pageCount + 1}`);

        // Track when we get a new scroll_id
        if (searchResult.scroll_id && !scrollId) {
          scrollIdStartTime = Date.now();
// logger.debug(`[GET CBT IDs] New scroll_id obtained at ${new Date(scrollIdStartTime).toISOString()}`);
          console.log(`[GET CBT IDs] 🔑 New scroll_id obtained`);
        }

        if (pageCount === 1 && searchResult.paging?.total) {
          totalEstimated = searchResult.paging.total;
          logger.info(`[GET CBT IDs] Total estimated: ${totalEstimated}`);
          console.log(`[GET CBT IDs] 📊 Total estimated: ${totalEstimated.toLocaleString()} items`);
        }

        if (searchResult.results && searchResult.results.length > 0) {
          // Process this batch to identify CBTs
// logger.debug(`[GET CBT IDs] Processing batch of ${searchResult.results.length} item IDs...`);
          console.log(`[GET CBT IDs] 🔄 Processing batch of ${searchResult.results.length} item IDs...`);

          // IMPORTANT: With scan_mode, all results are already CBTs (IDs start with "CBT")
          // So we can identify them directly by ID without needing to check site_id
          // But we still need to get details for Phase 2 (to get price, status, etc.)
          const batchCbtIds = searchResult.results.filter(id => id && id.startsWith('CBT'));
// logger.debug(`[GET CBT IDs] Found ${batchCbtIds.length} CBT IDs directly from scan results (out of ${searchResult.results.length} items)`);
          console.log(`[GET CBT IDs] 🔍 Found ${batchCbtIds.length} CBT IDs directly from scan results (out of ${searchResult.results.length} items)`);
          
          // Get item details in bulk to get complete info (price, status, etc.)
          const numBatches = Math.ceil(searchResult.results.length / batchSize);
          console.log(`[GET CBT IDs] 📦 Getting details for ${searchResult.results.length} items in ${numBatches} batches...`);
          for (let i = 0; i < searchResult.results.length; i += batchSize) {
            const batch = searchResult.results.slice(i, i + batchSize);
            const batchNum = Math.floor(i / batchSize) + 1;
            console.log(`[GET CBT IDs] 📦 Fetching details for batch ${batchNum}/${numBatches} (${batch.length} items)...`);
            const itemsDetails = await this.getItemsBulk(batch, accessToken);
            console.log(`[GET CBT IDs] ✅ Batch ${batchNum}/${numBatches} completed`);

            for (const result of itemsDetails) {
              if (result.code === 200 && result.body && 'id' in result.body) {
                const item = result.body;
                processedCount++;

                // With scan_mode, all items are CBTs (IDs start with "CBT")
                // Add to cbtIds if ID starts with "CBT" OR site_id starts with "CBT" (double check)
                const siteId = item.site_id as string | undefined;
                if ((item.id && item.id.startsWith('CBT')) || (siteId && siteId.startsWith('CBT'))) {
                  if (!cbtIds.includes(item.id)) {
                    cbtIds.push(item.id);
                  }
                } else {
                  // Log if we find an item that doesn't match (shouldn't happen with scan_mode)
                  logger.warn(`[GET CBT IDs] Item ${item.id} doesn't match CBT pattern (site_id: ${siteId})`);
                }
              }
            }

            // Report progress
            if (onProgress) {
              onProgress(processedCount, cbtIds.length, totalEstimated);
            }

            // Stop if we found enough CBTs
            if (maxCBTs && cbtIds.length >= maxCBTs) {
              logger.info(`[GET CBT IDs] Limit reached: ${cbtIds.length} CBT IDs found (max: ${maxCBTs})`);
              hasMore = false;
              break;
            }

            // Stop if we've processed enough items
            if (maxItems && processedCount >= maxItems) {
              logger.info(`[GET CBT IDs] MaxItems limit reached: ${processedCount} items processed (limit: ${maxItems})`);
              hasMore = false;
              break;
            }
          }
        }

        // Check scroll_id: null means end of results
        if (searchResult.scroll_id === null || searchResult.scroll_id === undefined) {
          hasMore = false;
          scrollId = null;
          logger.info(`[GET CBT IDs] Reached end of results. Total CBT IDs: ${cbtIds.length}`);
        } else {
          scrollId = searchResult.scroll_id;
          hasMore = true;
        }

        // Log progress every 10 pages or every 1000 items
        if ((pageCount % 10 === 0 && pageCount > 0) || (processedCount % 1000 === 0 && processedCount > 0)) {
          logger.info(`[GET CBT IDs] Progress: ${cbtIds.length.toLocaleString()} CBT IDs found from ${processedCount.toLocaleString()} items processed${totalEstimated ? ` / ${totalEstimated.toLocaleString()} total` : ''}...`);
          console.log(`[GET CBT IDs] 📊 Progress: ${cbtIds.length.toLocaleString()} CBT IDs found from ${processedCount.toLocaleString()} items processed${totalEstimated ? ` / ${totalEstimated.toLocaleString()} total` : ''}...`);
        }

        pageCount++;
        console.log(`[GET CBT IDs] ✅ Page ${pageCount} completed. Total so far: ${cbtIds.length} CBTs from ${processedCount} items`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`[GET CBT IDs] Error on page ${pageCount}:`, errorMessage);
        console.error(`[GET CBT IDs] ❌ Error on page ${pageCount}:`, errorMessage);

        // Check if error is due to expired scroll_id
        if (errorMessage.includes('scroll_id') || errorMessage.includes('expired') || errorMessage.includes('invalid')) {
          logger.warn(`[GET CBT IDs] Possible scroll_id expiration, renewing...`);
          scrollId = null;
          scrollIdStartTime = null;
          // Continue with new scroll_id
          continue;
        }

        // If we have some CBTs, continue; otherwise throw
        if (cbtIds.length === 0 && processedCount === 0) {
          throw error;
        }
        // Log warning but continue with what we have
        logger.warn(`[GET CBT IDs] Continuing with ${cbtIds.length} CBT IDs found so far...`);
        hasMore = false;
      }
    }

    logger.info(`[GET CBT IDs] Phase 1 complete: ${cbtIds.length} CBT IDs found from ${processedCount} items processed`);

    return {
      cbtIds,
      totalProcessed: processedCount,
      totalEstimated,
    };
  }

  /**
   * Phase 2: Get full details for CBT IDs using bulk requests
   */
  async getCBTDetails(
    cbtIds: string[],
    accessToken: string,
    onProgress?: (processed: number, total: number) => void
  ): Promise<Array<{
    id: string;
    site_id: string;
    title: string;
    status: string;
    price?: number;
    currency_id?: string;
    available_quantity?: number;
    sold_quantity?: number;
    permalink?: string;
    thumbnail?: string;
    category_id?: string;
  }>> {
    const cbtDetails: Array<{
      id: string;
      site_id: string;
      title: string;
      status: string;
      price?: number;
      currency_id?: string;
      available_quantity?: number;
      sold_quantity?: number;
      permalink?: string;
      thumbnail?: string;
      category_id?: string;
    }> = [];

    const batchSize = this.MAX_ITEMS_PER_REQUEST; // 20 items per bulk request
    let processedCount = 0;

    logger.info(`[GET CBT DETAILS] Phase 2: Getting details for ${cbtIds.length} CBTs...`);

    // Process in batches
    for (let i = 0; i < cbtIds.length; i += batchSize) {
      const batch = cbtIds.slice(i, i + batchSize);
      const itemsDetails = await this.getItemsBulk(batch, accessToken);

      for (const result of itemsDetails) {
        if (result.code === 200 && result.body && 'id' in result.body) {
          const item = result.body;
          processedCount++;

          cbtDetails.push({
            id: item.id,
            site_id: (item.site_id as string) || '',
            title: item.title,
            status: item.status,
            price: item.price,
            currency_id: item.currency_id as string | undefined,
            available_quantity: item.available_quantity as number | undefined,
            sold_quantity: item.sold_quantity,
            permalink: item.permalink as string | undefined,
            thumbnail: item.thumbnail as string | undefined,
            category_id: item.category_id,
          });
        }
      }

      // Report progress
      if (onProgress) {
        onProgress(processedCount, cbtIds.length);
      }

      // Log progress every 10 batches
      if ((i / batchSize) % 10 === 0 && i > 0) {
        logger.info(`[GET CBT DETAILS] Progress: ${processedCount}/${cbtIds.length} CBTs processed...`);
      }
    }

    logger.info(`[GET CBT DETAILS] Phase 2 complete: ${cbtDetails.length} CBTs with full details`);

    return cbtDetails;
  }

  /**
   * Get all CBTs in two phases:
   * Phase 1: Get all CBT IDs (handles scroll_id expiration)
   * Phase 2: Get full details for all CBTs
   */
  async getAllCBTs(
    userId: string,
    accessToken: string,
    options: {
      status?: ItemStatus;
      maxCBTs?: number;
      maxItems?: number; // Maximum items to process (stops when reached)
      onProgress?: (processed: number, found: number, totalEstimated?: number) => void;
    } = {}
  ): Promise<{
    cbts: Array<{
      id: string;
      site_id: string;
      title: string;
      status: string;
      price?: number;
      currency_id?: string;
      available_quantity?: number;
      sold_quantity?: number;
      permalink?: string;
      thumbnail?: string;
      category_id?: string;
    }>;
    totalProcessed: number;
    totalEstimated?: number;
  }> {
    const { onProgress } = options;

    logger.info(`[GET CBTS] Starting two-phase CBT retrieval...`);

    // Phase 1: Get all CBT IDs
    const phase1Result = await this.getAllCBTIds(userId, accessToken, {
      status: options.status,
      maxCBTs: options.maxCBTs,
      maxItems: options.maxItems,
      onProgress: (processed, found, totalEstimated) => {
        if (onProgress) {
          onProgress(processed, found, totalEstimated);
        }
      },
    });

    logger.info(`[GET CBTS] Phase 1 complete: ${phase1Result.cbtIds.length} CBT IDs found`);

    // Phase 2: Get full details for all CBTs
    const cbts = await this.getCBTDetails(
      phase1Result.cbtIds,
      accessToken,
      (processed, total) => {
// logger.debug(`[GET CBTS] Phase 2 progress: ${processed}/${total}`);
      }
    );

    logger.info(`[GET CBTS] Complete: ${cbts.length} CBTs with full details`);

    return {
      cbts,
      totalProcessed: phase1Result.totalProcessed,
      totalEstimated: phase1Result.totalEstimated,
    };
  }
}

