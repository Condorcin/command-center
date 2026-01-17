import { requireAuth } from '../middlewares/auth';
import { GlobalSellerService } from '../services/global-seller.service';
import { GlobalSellerRepository } from '../repositories/global-seller.repository';
import { MercadoLibreAPIService } from '../services/mercado-libre-api.service';
import { MercadoLibreItemsService } from '../services/mercado-libre-items.service';
import { ItemRepository } from '../repositories/item.repository';
import { MarketplaceItemRepository } from '../repositories/marketplace-item.repository';
import { UserRepository } from '../repositories/user.repository';
import { SessionRepository } from '../repositories/session.repository';
import { AuthService } from '../services/auth.service';
import { successResponse, errorResponse, handleError } from '../utils/response';
import { logger } from '../utils/logger';
import { ML_API_LIMITS, VALID_ITEM_STATUSES, VALID_ORDER_OPTIONS, PAGINATION, type ItemStatus, type OrderOption } from '../config/constants';
import { Item } from '../db/schema';
import { MLItem } from '../services/mercado-libre-items.service';

export interface Env {
  DB: D1Database;
}

// Global state for sync all processes (in-memory)
// Key: globalSellerId, Value: { paused: boolean, stopped: boolean, currentBatchIndex: number }
const syncAllState = new Map<string, { paused: boolean; stopped: boolean; currentBatchIndex: number }>();

// Global state for continue sync processes (in-memory)
// Key: globalSellerId, Value: { paused: boolean, stopped: boolean, currentBatchIndex: number }
const continueSyncState = new Map<string, { paused: boolean; stopped: boolean; currentBatchIndex: number }>();

/**
 * GET /api/global-sellers/:id/items/count
 * Get items count for a Global Seller (from database, fallback to ML API)
 */
export async function getItemsCountHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const globalSellerRepo = new GlobalSellerRepository(env.DB);
    const mlAPIService = new MercadoLibreAPIService();
    const globalSellerService = new GlobalSellerService(globalSellerRepo, mlAPIService);
    const itemsService = new MercadoLibreItemsService();
    const itemRepo = new ItemRepository(env.DB);

    const user = await requireAuth(request, env, authService);

    const url = new URL(request.url);
    const id = url.pathname.split('/')[3]; // /api/global-sellers/:id/items/count

    if (!id) {
      logger.error('[GET ITEMS COUNT] Missing Global Seller ID');
      return errorResponse('Global Seller ID is required', 400, 'MISSING_ID');
    }

    const globalSeller = await globalSellerService.getById(id);

    if (!globalSeller) {
      logger.error(`[GET ITEMS COUNT] Global Seller not found: ${id}`);
      return errorResponse('Global Seller not found', 404, 'NOT_FOUND');
    }

    if (globalSeller.user_id !== user.id) {
      logger.error(`[GET ITEMS COUNT] Access denied for user: ${user.id}, Global Seller: ${globalSeller.id}`);
      return errorResponse('Access denied', 403, 'FORBIDDEN');
    }

// logger.debug(`[GET ITEMS COUNT] Getting counts for Global Seller: ${globalSeller.id}, ml_user_id: ${globalSeller.ml_user_id}`);

    // Optimize: Get database counts first (fast), skip ML API call for speed
    // Get database counts in parallel (both use indexes, should be fast)
    const [dbCount, cbtsCount] = await Promise.all([
      itemRepo.getCountByStatus(globalSeller.id),
      itemRepo.getCBTsCount(globalSeller.id),
    ]);
    
    // Skip ML API call by default for faster response
    // Only get ML count if explicitly requested or database is empty
    const needMLCount = dbCount.total === 0 || url.searchParams.get('includeML') === 'true';
    
    let mlTotal = 0;
    let mlCount = null;
    let tokenInvalid = false;
    
    if (needMLCount) {
      try {
        // Get total from ML API by summing all statuses
        mlCount = await itemsService.getItemsCount(
          globalSeller.ml_user_id,
          globalSeller.ml_access_token
        );
        mlTotal = mlCount?.total || 0;
        tokenInvalid = mlCount?.tokenInvalid || false;
// logger.debug(`ML total from API: ${mlTotal} (active: ${mlCount?.active || 0}, paused: ${mlCount?.paused || 0}, closed: ${mlCount?.closed || 0})`);
        
        if (tokenInvalid) {
          logger.warn('Access token is invalid or expired for Global Seller:', globalSeller.id);
        }
      } catch (mlError) {
        // Check if it's a token error
        const isTokenError = mlError instanceof Error && 
                            (mlError.message.includes('401') || mlError.message.includes('invalid access token'));
        if (isTokenError) {
          tokenInvalid = true;
          logger.warn('Access token is invalid or expired. Using database count only.');
        } else {
          logger.warn('Failed to get ML total, using database count only:', mlError);
        }
        // Continue without ML total - not critical
      }
    }
    
    // If database has data, return immediately (fast response)
    // ML count can be loaded later if needed
    if (dbCount.total > 0) {
      return successResponse({ 
        count: dbCount, 
        source: 'database',
        ml_total: mlTotal > 0 ? mlTotal : dbCount.total, // Use DB total as fallback if ML total not available
        ml_count: mlCount ? { active: mlCount.active || 0, paused: mlCount.paused || 0, closed: mlCount.closed || 0 } : (dbCount.active !== undefined ? { active: dbCount.active || 0, paused: dbCount.paused || 0, closed: dbCount.closed || 0 } : undefined),
        token_invalid: tokenInvalid || undefined,
        cbts_count: cbtsCount, // Total CBTs in database
      });
    } else {
      // Database is empty, get fresh data from ML API
      try {
        const mlCount = await itemsService.getItemsCount(
          globalSeller.ml_user_id,
          globalSeller.ml_access_token
        );
        return successResponse({ 
          count: mlCount || { active: 0, paused: 0, closed: 0, total: 0 }, 
          source: 'ml_api',
          ml_total: mlCount?.total || 0,
          ml_count: mlCount ? { active: mlCount.active || 0, paused: mlCount.paused || 0, closed: mlCount.closed || 0 } : undefined,
        });
      } catch (mlError) {
        logger.error('Failed to get ML count:', mlError);
        // Return empty count if ML API fails
        return successResponse({ 
          count: { active: 0, paused: 0, closed: 0, total: 0 }, 
          source: 'ml_api',
          ml_total: 0,
          ml_count: undefined,
        });
      }
    }
  } catch (error) {
    logger.error('[GET ITEMS COUNT] Error in handler:', error);
    logger.error('[GET ITEMS COUNT] Error type:', error?.constructor?.name || typeof error);
    logger.error('[GET ITEMS COUNT] Error message:', error instanceof Error ? error.message : String(error));
    logger.error('[GET ITEMS COUNT] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return handleError(error);
  }
}

/**
 * GET /api/global-sellers/:id/items
 * Get items for a Global Seller with filters
 */
export async function getItemsHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const globalSellerRepo = new GlobalSellerRepository(env.DB);
    const mlAPIService = new MercadoLibreAPIService();
    const globalSellerService = new GlobalSellerService(globalSellerRepo, mlAPIService);
    const itemsService = new MercadoLibreItemsService();
    const itemRepo = new ItemRepository(env.DB);

    const user = await requireAuth(request, env, authService);

    const url = new URL(request.url);
    const id = url.pathname.split('/')[3]; // /api/global-sellers/:id/items

    if (!id) {
      return errorResponse('Global Seller ID is required', 400, 'MISSING_ID');
    }

    const globalSeller = await globalSellerService.getById(id);

    if (!globalSeller) {
      return errorResponse('Global Seller not found', 404, 'NOT_FOUND');
    }

    if (globalSeller.user_id !== user.id) {
      return errorResponse('Access denied', 403, 'FORBIDDEN');
    }

    // Get and validate query parameters
    const statusParam = url.searchParams.get('status');
    const status: ItemStatus = (statusParam && VALID_ITEM_STATUSES.includes(statusParam as ItemStatus)) 
      ? (statusParam as ItemStatus) 
      : 'active';
    
    const offsetParam = url.searchParams.get('offset');
    let offset = typeof offsetParam === 'string' && !isNaN(parseInt(offsetParam, 10))
      ? parseInt(offsetParam, 10)
      : 0;
    offset = Math.max(0, Math.min(offset, ML_API_LIMITS.MAX_OFFSET));
    
    const limitParam = url.searchParams.get('limit');
    let limit = typeof limitParam === 'string' && !isNaN(parseInt(limitParam, 10))
      ? parseInt(limitParam, 10)
      : PAGINATION.DEFAULT_PAGE_SIZE;
    limit = Math.max(1, Math.min(limit, PAGINATION.MAX_PAGE_SIZE));
    
    const search = url.searchParams.get('search') || undefined;
    const useDatabase = url.searchParams.get('source') !== 'ml'; // Default to database

    const orderParam = url.searchParams.get('order');
    const order: OrderOption = (orderParam && VALID_ORDER_OPTIONS.includes(orderParam as OrderOption))
      ? (orderParam as OrderOption)
      : 'start_time_desc';

    try {
      // Try database first if enabled
      if (useDatabase) {
        // Map order to database fields
        // Default to synced_at DESC to show most recently synced items first
        // Use updated_at as fallback if synced_at is not available
        let orderBy: 'title' | 'price' | 'updated_at' | 'start_time' | 'synced_at' = 'synced_at';
        let orderDir: 'ASC' | 'DESC' = 'DESC';
        
        if (order === 'price_desc') {
          orderBy = 'price';
          orderDir = 'DESC';
        } else if (order === 'price_asc') {
          orderBy = 'price';
          orderDir = 'ASC';
        } else if (order === 'start_time_desc') {
          orderBy = 'start_time';
          orderDir = 'DESC';
        } else if (order === 'start_time_asc') {
          orderBy = 'start_time';
          orderDir = 'ASC';
        }
        
        // Always use synced_at for database queries to show latest synced items first
        // This ensures we see newly synced items immediately, even if start_time is null
        if (orderBy === 'start_time') {
          orderBy = 'synced_at';
          orderDir = 'DESC';
        }

        const queryStatus = status !== 'all' ? status : undefined;
// logger.debug(`Querying database: status=${queryStatus}, limit=${limit}, offset=${offset}, orderBy=${orderBy}`);
        
        const dbResult = await itemRepo.findByGlobalSellerId(globalSeller.id, {
          status: queryStatus,
          search,
          limit,
          offset,
          orderBy,
          orderDir,
        });
        
// logger.debug(`Database query result: ${dbResult.items.length} items, total: ${dbResult.total}`);

        // Convert to response format
        const items = dbResult.items.map(item => ({
          id: item.ml_item_id,
          site_id: item.site_id,
          title: item.title,
          price: item.price,
          currency_id: item.currency_id,
          available_quantity: item.available_quantity,
          sold_quantity: item.sold_quantity,
          status: item.status,
          listing_type_id: item.listing_type_id,
          condition: item.condition,
          permalink: item.permalink,
          thumbnail: item.thumbnail,
          category_id: item.category_id,
          start_time: item.start_time ? new Date(item.start_time * 1000).toISOString() : null,
          stop_time: item.stop_time ? new Date(item.stop_time * 1000).toISOString() : null,
          end_time: item.end_time ? new Date(item.end_time * 1000).toISOString() : null,
        }));

        return successResponse({
          items,
          paging: {
            total: dbResult.total,
            offset,
            limit,
          },
          source: 'database',
        });
      }

      // Fallback to ML API
      const searchResult = await itemsService.searchItems(
        globalSeller.ml_user_id,
        globalSeller.ml_access_token,
        { status, offset, limit, order }
      );

      // Validate we got results
      if (!searchResult.results || searchResult.results.length === 0) {
        return successResponse({
          items: [],
          paging: {
            total: searchResult.paging?.total || 0,
            offset: searchResult.paging?.offset || offset,
            limit: searchResult.paging?.limit || limit,
          },
          warning: offset > 0 ? 'No hay más resultados disponibles' : undefined,
          source: 'ml_api',
        });
      }

      // Get item details in bulk (respecting 20 items per request)
      const itemsDetails = await itemsService.getItemsBulk(
        searchResult.results,
        globalSeller.ml_access_token
      );

      // Filter successful responses and collect errors
      const items: any[] = [];
      const errors: string[] = [];

      for (const result of itemsDetails) {
        if (result.code === 200 && result.body && 'id' in result.body) {
          items.push(result.body as any);
        } else if (result.code !== 200) {
          const errorBody = (result.body ?? {}) as { error?: string; message?: string };
          errors.push(errorBody.message || errorBody.error || `Error ${result.code}`);
        }
      }

      // Build response with warnings if there were errors
      const response: any = {
        items,
        paging: {
          total: searchResult.paging?.total || 0,
          offset: searchResult.paging?.offset || offset,
          limit: searchResult.paging?.limit || limit,
        },
        source: 'ml_api',
      };

      if (errors.length > 0) {
        response.warnings = {
          failed_items: errors.length,
          errors: errors.slice(0, 5), // Only include first 5 errors
        };
      }

      // Add warning if total is very large
      if (searchResult.paging?.total && searchResult.paging.total > 10000) {
        response.warning = `Total muy grande (${searchResult.paging.total}). La paginación puede ser lenta más allá del offset 10,000.`;
      }

      return successResponse(response);
    } catch (error) {
      logger.error('Error fetching items:', error);
      
      // Provide helpful error message
      if (error instanceof Error) {
        if (error.message.includes('429') || error.message.includes('rate limit')) {
          return errorResponse('Límite de rate limit alcanzado. Por favor espera unos momentos e intenta de nuevo.', 429, 'RATE_LIMIT');
        }
        if (error.message.includes('offset')) {
          return errorResponse(`Offset ${offset} es demasiado grande. Intenta con un offset menor.`, 400, 'INVALID_OFFSET');
        }
      }

      return handleError(error);
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return handleError(error);
  }
}

/**
 * GET /api/global-sellers/:id/items/sync-status
 * Get sync status and recent synced items count
 */
export async function getSyncStatusHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const globalSellerRepo = new GlobalSellerRepository(env.DB);
    const mlAPIService = new MercadoLibreAPIService();
    const globalSellerService = new GlobalSellerService(globalSellerRepo, mlAPIService);
    const itemRepo = new ItemRepository(env.DB);

    const user = await requireAuth(request, env, authService);

    const url = new URL(request.url);
    const id = url.pathname.split('/')[3]; // /api/global-sellers/:id/items/sync-status

    if (!id) {
      return errorResponse('Global Seller ID is required', 400, 'MISSING_ID');
    }

    const globalSeller = await globalSellerService.getById(id);

    if (!globalSeller) {
      return errorResponse('Global Seller not found', 404, 'NOT_FOUND');
    }

    if (globalSeller.user_id !== user.id) {
      return errorResponse('Access denied', 403, 'FORBIDDEN');
    }

    // Get count from database
    const dbCount = await itemRepo.getCountByStatus(globalSeller.id);
    
    // Get most recent synced items
    const recentItems = await itemRepo.findByGlobalSellerId(globalSeller.id, {
      limit: 50,
      offset: 0,
      orderBy: 'synced_at',
      orderDir: 'DESC',
    });

    // Calculate last page based on total items in DB (assuming 50 items per page)
    const itemsPerPage = 50;
    const lastPage = Math.floor(dbCount.total / itemsPerPage);

    return successResponse({
      count: dbCount,
      recentItemsCount: recentItems.items.length,
      lastSynced: recentItems.items[0]?.synced_at || null,
      lastPage: lastPage,
      totalItemsInDb: dbCount.total,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return handleError(error);
  }
}

/**
 * GET /api/global-sellers/:id/items/saved
 * Get saved items from database for display
 */
export async function getSavedItemsHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const globalSellerRepo = new GlobalSellerRepository(env.DB);
    const mlAPIService = new MercadoLibreAPIService();
    const globalSellerService = new GlobalSellerService(globalSellerRepo, mlAPIService);
    const itemRepo = new ItemRepository(env.DB);

    const user = await requireAuth(request, env, authService);

    const url = new URL(request.url);
    const id = url.pathname.split('/')[3]; // /api/global-sellers/:id/items/saved

    if (!id) {
      return errorResponse('Global Seller ID is required', 400, 'MISSING_ID');
    }

    const globalSeller = await globalSellerService.getById(id);

    if (!globalSeller) {
      return errorResponse('Global Seller not found', 404, 'NOT_FOUND');
    }

    if (globalSeller.user_id !== user.id) {
      return errorResponse('Access denied', 403, 'FORBIDDEN');
    }

    // Get query parameters
    const statusParam = url.searchParams.get('status');
    // Only filter by status if explicitly provided, otherwise get all items
    const status = statusParam ? (statusParam as 'active' | 'paused' | 'closed') : undefined;
    let limit = parseInt(url.searchParams.get('limit') || '1000', 10); // Default to 1000 items per page
    let offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const orderBy = url.searchParams.get('orderBy') as 'title' | 'price' | 'updated_at' | 'start_time' | 'synced_at' || 'synced_at';
    const orderDir = url.searchParams.get('orderDir') as 'ASC' | 'DESC' || 'DESC';

    // Cap limit to reasonable maximum (1000 items per request)
    limit = Math.max(1, Math.min(limit, 1000));
    offset = Math.max(0, offset);

// logger.debug(`[GET SAVED] Fetching items: status=${status || 'ALL (no filter)'}, limit=${limit}, offset=${offset}`);

    // Get items from database - pass undefined for status to get all items
    const dbResult = await itemRepo.findByGlobalSellerId(globalSeller.id, {
      status: status, // undefined means no filter - get all statuses
      limit,
      offset,
      orderBy,
      orderDir,
    });
    
// logger.debug(`[GET SAVED] Found ${dbResult.items.length} items, total: ${dbResult.total}`);
    if (dbResult.items.length > 0) {
      const statusCounts = {
        active: dbResult.items.filter(i => i.status === 'active').length,
        paused: dbResult.items.filter(i => i.status === 'paused').length,
        closed: dbResult.items.filter(i => i.status === 'closed').length,
      };
// logger.debug(`[GET SAVED] Status distribution in response:`, statusCounts);
    }

    // Convert to response format
    const items = dbResult.items.map(item => ({
      id: item.ml_item_id,
      site_id: item.site_id,
      title: item.title,
      price: item.price,
      currency_id: item.currency_id,
      available_quantity: item.available_quantity,
      sold_quantity: item.sold_quantity,
      status: item.status,
      listing_type_id: item.listing_type_id,
      condition: item.condition,
      permalink: item.permalink,
      thumbnail: item.thumbnail,
      category_id: item.category_id,
      start_time: item.start_time ? new Date(item.start_time * 1000).toISOString() : null,
      stop_time: item.stop_time ? new Date(item.stop_time * 1000).toISOString() : null,
      end_time: item.end_time ? new Date(item.end_time * 1000).toISOString() : null,
    }));

    return successResponse({
      items,
      paging: {
        total: dbResult.total,
        offset,
        limit,
      },
      source: 'database',
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return handleError(error);
  }
}

/**
 * POST /api/global-sellers/:id/items/sync
 * Sync all items for a Global Seller
 */
export async function syncItemsHandler(request: Request, env: Env): Promise<Response> {
  try {
// logger.debug('[SYNC] syncItemsHandler called');
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const globalSellerRepo = new GlobalSellerRepository(env.DB);
    const mlAPIService = new MercadoLibreAPIService();
    const globalSellerService = new GlobalSellerService(globalSellerRepo, mlAPIService);
    const itemsService = new MercadoLibreItemsService();
    const itemRepo = new ItemRepository(env.DB);

// logger.debug('[SYNC] Authenticating user...');
    const user = await requireAuth(request, env, authService);
// logger.debug('[SYNC] User authenticated:', user.id);

    const url = new URL(request.url);
    const id = url.pathname.split('/')[3]; // /api/global-sellers/:id/items/sync

    if (!id) {
      logger.error('[SYNC] Missing Global Seller ID');
      return errorResponse('Global Seller ID is required', 400, 'MISSING_ID');
    }

// logger.debug('[SYNC] Fetching Global Seller:', id);
    const globalSeller = await globalSellerService.getById(id);

    if (!globalSeller) {
      logger.error('[SYNC] Global Seller not found:', id);
      return errorResponse('Global Seller not found', 404, 'NOT_FOUND');
    }

    if (globalSeller.user_id !== user.id) {
      logger.error('[SYNC] Access denied for user:', user.id, 'Global Seller:', globalSeller.id);
      return errorResponse('Access denied', 403, 'FORBIDDEN');
    }

    const body = await request.json().catch(() => ({})) as { status?: string };
    const statusParam = body?.status;
    const status: ItemStatus = (typeof statusParam === 'string' && VALID_ITEM_STATUSES.includes(statusParam as ItemStatus))
      ? (statusParam as ItemStatus)
      : 'all';

// logger.debug(`[SYNC] Received sync request for Global Seller ${globalSeller.id}, status: ${status}, ml_user_id: ${globalSeller.ml_user_id}`);

    // Start sync in background with batch processing
    // Automatically uses scan mode if total > 1000, otherwise uses regular pagination
    // This gets full metadata for each item and saves it to database
    (async () => {
      try {
// logger.debug(`[SYNC] Starting sync for Global Seller ${globalSeller.id}, status: ${status}`);
        
        // First, check total to decide which method to use
        let totalCount = 0;
        try {
          const sampleResult = await itemsService.searchItems(
            globalSeller.ml_user_id,
            globalSeller.ml_access_token,
            { status, offset: 0, limit: 1 }
          );
          totalCount = sampleResult.paging?.total || 0;
          logger.info(`[SYNC] Total items: ${totalCount}`);
        } catch (error) {
          logger.warn(`[SYNC] Could not get total count:`, error);
        }

        let syncedCount = 0;
        const batchSize = ML_API_LIMITS.BATCH_SIZE; // Save in batches to DB

        // Use scan mode if total > 1000 (required by ML API)
        if (totalCount > 1000) {
          logger.info(`[SYNC] Total (${totalCount}) > 1000, using scan mode to get all items`);
          
          // Get all item IDs using scan mode
          const allItemIds = await itemsService.getAllItemsWithScan(
            globalSeller.ml_user_id,
            globalSeller.ml_access_token,
            status,
            (current, totalEstimated) => {
// logger.debug(`[SYNC] Scan progress: ${current}${totalEstimated ? ` / ${totalEstimated}` : ''} item IDs retrieved...`);
            }
          );

          logger.info(`[SYNC] Retrieved ${allItemIds.length} item IDs using scan mode, now fetching details...`);

          // Process items in batches
          for (let i = 0; i < allItemIds.length; i += batchSize) {
            const batch = allItemIds.slice(i, i + batchSize);
            
            // Get item details in bulk (respecting 20 items per request)
            const itemsDetails = await itemsService.getItemsBulk(
              batch,
              globalSeller.ml_access_token
            );

            // Process items and save to database
            const itemsToSave: any[] = [];
            
            for (const result of itemsDetails) {
              if (result.code === 200 && result.body && 'id' in result.body) {
                const item = result.body as unknown as MLItem;
                itemsToSave.push({
                  global_seller_id: globalSeller.id,
                  ml_item_id: item.id,
                  site_id: item.site_id,
                  title: item.title,
                  price: item.price,
                  currency_id: item.currency_id,
                  available_quantity: item.available_quantity,
                  sold_quantity: item.sold_quantity,
                  status: item.status,
                  listing_type_id: item.listing_type_id,
                  condition: item.condition,
                  permalink: item.permalink,
                  thumbnail: item.thumbnail,
                  category_id: item.category_id,
                  start_time: item.start_time ? Math.floor(new Date(item.start_time).getTime() / 1000) : null,
                  stop_time: item.stop_time ? Math.floor(new Date(item.stop_time).getTime() / 1000) : null,
                  end_time: item.end_time ? Math.floor(new Date(item.end_time).getTime() / 1000) : null,
                  metadata: item,
                });
              }
            }

            if (itemsToSave.length > 0) {
              await itemRepo.bulkUpsert(itemsToSave);
              syncedCount += itemsToSave.length;
// logger.debug(`[SYNC] Saved batch: ${itemsToSave.length} items (total: ${syncedCount}/${allItemIds.length})`);
            }
          }

          logger.info(`[SYNC] Scan mode sync complete: ${syncedCount} items synced`);
        } else {
          // Use regular pagination for <= 1000 items
          logger.info(`[SYNC] Total (${totalCount}) <= 1000, using regular pagination`);
          let offset = 0;
          const limit = ML_API_LIMITS.MAX_ITEMS_PER_PAGE;

          while (true) {
            // Get item IDs from ML
// logger.debug(`[SYNC] Fetching items from ML API: offset=${offset}, limit=${limit}`);
            const searchResult = await itemsService.searchItems(
              globalSeller.ml_user_id,
              globalSeller.ml_access_token,
              { status, offset, limit }
            );
            
// logger.debug(`[SYNC] Got ${searchResult.results?.length || 0} item IDs from ML API`);

            if (!searchResult.results || searchResult.results.length === 0) {
              break;
            }

            // Get basic item details in bulk (respecting 20 items per request)
            const itemsDetails = await itemsService.getItemsBulk(
              searchResult.results,
              globalSeller.ml_access_token
            );

            // Process items directly from bulk response (it already has all the info we need)
            // This is more efficient than calling /items/{id} for each item
            const itemsToSave: any[] = [];
            
// logger.debug(`[SYNC] Processing ${itemsDetails.length} items from bulk response`);
            
            for (const result of itemsDetails) {
              if (result.code === 200 && result.body && 'id' in result.body) {
                const mlItem = result.body as any;
                
                // The bulk endpoint already returns complete item information
                // We can use it directly without additional API calls
                itemsToSave.push({
                  global_seller_id: globalSeller.id,
                  ml_item_id: mlItem.id,
                  site_id: mlItem.site_id || null,
                  title: mlItem.title || null,
                  price: mlItem.price || null,
                  currency_id: mlItem.currency_id || null,
                  available_quantity: mlItem.available_quantity || 0,
                  sold_quantity: mlItem.sold_quantity || 0,
                  status: mlItem.status || 'active',
                  listing_type_id: mlItem.listing_type_id || null,
                  condition: mlItem.condition || null,
                  permalink: mlItem.permalink || null,
                  thumbnail: mlItem.thumbnail || null,
                  category_id: mlItem.category_id || null,
                  start_time: mlItem.start_time ? Math.floor(new Date(mlItem.start_time).getTime() / 1000) : null,
                  stop_time: mlItem.stop_time ? Math.floor(new Date(mlItem.stop_time).getTime() / 1000) : null,
                  end_time: mlItem.end_time ? Math.floor(new Date(mlItem.end_time).getTime() / 1000) : null,
                  metadata: mlItem, // Store complete metadata (will be stringified by repository)
                });
              } else {
                logger.warn(`[SYNC] Skipping item with code ${result.code}:`, result.body);
              }
            }
            
// logger.debug(`[SYNC] Prepared ${itemsToSave.length} items to save to database`);
            
            // Save items in batches to database for better performance
            if (itemsToSave.length > 0) {
              // Save in batches of 100 for optimal database performance
              for (let i = 0; i < itemsToSave.length; i += batchSize) {
                const batch = itemsToSave.slice(i, i + batchSize);
                try {
// logger.debug(`[SYNC] Attempting to save batch ${i}-${i + batch.length} (${batch.length} items) to database`);
                  await itemRepo.bulkUpsert(batch);
                  syncedCount += batch.length;
// logger.debug(`[SYNC] ✓ Successfully synced ${syncedCount} items (batch of ${batch.length} saved) for Global Seller ${globalSeller.id}`);
                } catch (error) {
                  logger.error(`[SYNC] ✗ Error saving batch ${i}-${i + batch.length}:`, error);
                  logger.error('[SYNC] Error details:', error instanceof Error ? error.message : String(error));
                  logger.error('[SYNC] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
                  // Continue with next batch even if one fails
                }
              }
            } else {
// logger.debug(`[SYNC] No items to save for offset ${offset} (got ${itemsDetails.length} results from ML)`);
            }

            // Check if we've reached the limit or end
            if (offset + limit >= ML_API_LIMITS.MAX_OFFSET || searchResult.results.length < limit) {
              break;
            }

            offset += limit;
          }

          logger.info(`[SYNC] Regular pagination sync complete: ${syncedCount} items synced`);
        }
      } catch (error) {
        logger.error('[SYNC] Sync error:', error);
        logger.error('[SYNC] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        logger.error('[SYNC] Error details:', error);
      }
    })();
    
// logger.debug(`[SYNC] Background sync task started for Global Seller ${globalSeller.id}`);

    return successResponse({
      message: 'Sync started in background. Processing items in batches of 5 to get full metadata.',
      status: 'processing',
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return handleError(error);
  }
}

/**
 * POST /api/global-sellers/:id/items/check
 * Check which ML item IDs already exist in database
 */
export async function checkItemsHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const globalSellerRepo = new GlobalSellerRepository(env.DB);
    const mlAPIService = new MercadoLibreAPIService();
    const globalSellerService = new GlobalSellerService(globalSellerRepo, mlAPIService);
    const itemRepo = new ItemRepository(env.DB);

    const user = await requireAuth(request, env, authService);

    const url = new URL(request.url);
    const id = url.pathname.split('/')[3]; // /api/global-sellers/:id/items/check

    if (!id) {
      return errorResponse('Global Seller ID is required', 400, 'MISSING_ID');
    }

    const globalSeller = await globalSellerService.getById(id);

    if (!globalSeller) {
      return errorResponse('Global Seller not found', 404, 'NOT_FOUND');
    }

    if (globalSeller.user_id !== user.id) {
      return errorResponse('Access denied', 403, 'FORBIDDEN');
    }

    const body = await request.json().catch(() => ({})) as { ml_item_ids?: string[] };
    const mlItemIds = body?.ml_item_ids || [];

    if (!Array.isArray(mlItemIds) || mlItemIds.length === 0) {
      return errorResponse('ml_item_ids array is required', 400, 'MISSING_IDS');
    }

    // Check which items already exist
    const existingIds = await itemRepo.findExistingMlItemIds(globalSeller.id, mlItemIds);
    const newIds = mlItemIds.filter(id => !existingIds.has(id));

    return successResponse({
      total_checked: mlItemIds.length,
      existing: existingIds.size,
      new: newIds.length,
      existing_ids: Array.from(existingIds),
      new_ids: newIds,
    });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * POST /api/global-sellers/:id/items/load
 * Load items page by page from ML API, save to database, and return items for display
 */
export async function loadItemsHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const globalSellerRepo = new GlobalSellerRepository(env.DB);
    const mlAPIService = new MercadoLibreAPIService();
    const globalSellerService = new GlobalSellerService(globalSellerRepo, mlAPIService);
    const itemsService = new MercadoLibreItemsService();
    const itemRepo = new ItemRepository(env.DB);

    const user = await requireAuth(request, env, authService);

    const url = new URL(request.url);
    const id = url.pathname.split('/')[3]; // /api/global-sellers/:id/items/load

    if (!id) {
      return errorResponse('Global Seller ID is required', 400, 'MISSING_ID');
    }

    const globalSeller = await globalSellerService.getById(id);

    if (!globalSeller) {
      return errorResponse('Global Seller not found', 404, 'NOT_FOUND');
    }

    if (globalSeller.user_id !== user.id) {
      return errorResponse('Access denied', 403, 'FORBIDDEN');
    }

    const body = await request.json().catch(() => ({})) as { status?: string; order?: string; page?: number | string };
    
    // Validate and sanitize status
    const statusParam = body?.status;
    const validStatus: ItemStatus = (typeof statusParam === 'string' && VALID_ITEM_STATUSES.includes(statusParam as ItemStatus) && statusParam !== 'all')
      ? (statusParam as ItemStatus)
      : 'active'; // ML API doesn't accept 'all', use 'active' as fallback
    
    // Validate and sanitize order
    const orderParam = body?.order;
    const order: OrderOption = (typeof orderParam === 'string' && VALID_ORDER_OPTIONS.includes(orderParam as OrderOption))
      ? (orderParam as OrderOption)
      : 'start_time_desc';
    
    // Validate and sanitize page
    const pageParam = body?.page;
    const page = (typeof pageParam === 'number' && pageParam >= 0 && Number.isInteger(pageParam))
      ? pageParam
      : (typeof pageParam === 'string' && !isNaN(parseInt(pageParam, 10)) && parseInt(pageParam, 10) >= 0)
        ? parseInt(pageParam, 10)
        : 0;
    
    const limit = ML_API_LIMITS.MAX_ITEMS_PER_PAGE;
    const offset = page * limit;

    // Validate offset limit
    if (offset >= ML_API_LIMITS.MAX_OFFSET) {
      return errorResponse(`Límite de paginación alcanzado. ML API no permite offsets mayores a ${ML_API_LIMITS.MAX_OFFSET}.`, 400, 'MAX_OFFSET_REACHED');
    }

// logger.debug(`[LOAD] Loading page ${page} (offset ${offset}) for Global Seller ${globalSeller.id}`);
// logger.debug(`[LOAD] Parameters: status=${validStatus}, order=${order}, ml_user_id=${globalSeller.ml_user_id}`);

    try {
      // 1. Get item IDs from ML API for this page
// logger.debug(`[LOAD] Calling searchItems with: ml_user_id=${globalSeller.ml_user_id}, status=${validStatus}, offset=${offset}, limit=${limit}, order=${order}`);
      let searchResult;
      try {
        searchResult = await itemsService.searchItems(
          globalSeller.ml_user_id,
          globalSeller.ml_access_token,
          { status: validStatus, offset, limit, order }
        );
      } catch (searchError) {
        logger.error('[LOAD] Error in searchItems:', searchError);
        logger.error('[LOAD] Error details:', searchError instanceof Error ? searchError.message : String(searchError));
        logger.error('[LOAD] Error stack:', searchError instanceof Error ? searchError.stack : 'No stack trace');
        
        // Provide more specific error messages
        const errorMessage = searchError instanceof Error ? searchError.message : String(searchError);
        if (errorMessage.includes('503') || errorMessage.includes('Service Unavailable')) {
          return errorResponse(
            'Mercado Libre está temporalmente no disponible. Por favor, intenta de nuevo en unos momentos.',
            503,
            'SERVICE_UNAVAILABLE'
          );
        }
        
        throw new Error(`Error al buscar items en ML API: ${errorMessage}`);
      }

      // logger.debug(`[LOAD] searchItems returned:`, {
      //   resultsCount: searchResult.results?.length || 0,
      //   total: searchResult.paging?.total || 0,
      //   hasResults: !!searchResult.results && searchResult.results.length > 0
      // });

      if (!searchResult.results || searchResult.results.length === 0) {
        // Check if it's a pagination limit issue
        if (searchResult.paginationLimitReached) {
// logger.debug(`[LOAD] ML API pagination limit reached at offset ${offset}`);
          
          // Aggressive strategy: try multiple offsets and orders to get more items
          if (offset >= 1000) {
// logger.debug(`[LOAD] Attempting aggressive strategy to get more items beyond pagination limit`);
            
            const strategies = [
              // Try smaller offsets (going backwards)
              { offset: offset - 50, order, status: validStatus, name: 'offset-50' },
              { offset: offset - 100, order, status: validStatus, name: 'offset-100' },
              { offset: offset - 200, order, status: validStatus, name: 'offset-200' },
              { offset: offset - 500, order, status: validStatus, name: 'offset-500' },
              // Try different orders with smaller offsets
              { offset: Math.max(0, offset - 100), order: 'start_time_asc', status: validStatus, name: 'different-order-asc' },
              { offset: Math.max(0, offset - 100), order: 'price_desc', status: validStatus, name: 'different-order-price-desc' },
              { offset: Math.max(0, offset - 100), order: 'price_asc', status: validStatus, name: 'different-order-price-asc' },
            ];
            
            let totalNewItems = 0;
            const allItemsToSave: any[] = [];
            
            for (const strategy of strategies) {
              if (strategy.offset < 0) continue;
              
              try {
// logger.debug(`[LOAD] Trying strategy: ${strategy.name} (offset=${strategy.offset}, order=${strategy.order})`);
                
                const alternativeResult = await itemsService.searchItems(
                  globalSeller.ml_user_id,
                  globalSeller.ml_access_token,
                  { 
                    status: strategy.status, 
                    offset: strategy.offset, 
                    limit, 
                    order: strategy.order as any 
                  }
                );
                
                if (alternativeResult.results && alternativeResult.results.length > 0 && !alternativeResult.paginationLimitReached) {
// logger.debug(`[LOAD] Strategy ${strategy.name} worked! Got ${alternativeResult.results.length} item IDs`);
                  
                  // Check which items already exist
                  const existingIds = await itemRepo.findExistingMlItemIds(globalSeller.id, alternativeResult.results);
                  const newItemIds = alternativeResult.results.filter(id => !existingIds.has(id));
                  
                  if (newItemIds.length > 0) {
// logger.debug(`[LOAD] Found ${newItemIds.length} new items via strategy ${strategy.name}`);
                    
                    // Get item details using bulk endpoint (in chunks of 20)
                    const itemsDetails = await itemsService.getItemsBulk(
                      newItemIds,
                      globalSeller.ml_access_token
                    );
                    
                    // Process items
                    for (const result of itemsDetails) {
                      if (result.code === 200 && result.body && 'id' in result.body) {
                        const item = result.body as any;
                        allItemsToSave.push({
                          global_seller_id: globalSeller.id,
                          ml_item_id: item.id,
                          site_id: item.site_id,
                          title: item.title,
                          price: item.price,
                          currency_id: item.currency_id,
                          available_quantity: item.available_quantity || 0,
                          sold_quantity: item.sold_quantity || 0,
                          status: item.status,
                          listing_type_id: item.listing_type_id,
                          condition: item.condition,
                          permalink: item.permalink,
                          thumbnail: item.thumbnail,
                          category_id: item.category_id,
                          start_time: item.start_time ? new Date(item.start_time).getTime() / 1000 : null,
                          stop_time: item.stop_time ? new Date(item.stop_time).getTime() / 1000 : null,
                          end_time: item.end_time ? new Date(item.end_time).getTime() / 1000 : null,
                          metadata: item,
                        });
                      }
                    }
                    
                    totalNewItems += newItemIds.length;
                    
                    // Small delay to respect rate limits
                    await new Promise(resolve => setTimeout(resolve, 200));
                  }
                } else if (alternativeResult.paginationLimitReached) {
// logger.debug(`[LOAD] Strategy ${strategy.name} also hit pagination limit, skipping`);
                }
              } catch (altError) {
                logger.error(`[LOAD] Strategy ${strategy.name} failed:`, altError);
                // Continue with next strategy
              }
            }
            
            if (allItemsToSave.length > 0) {
              // Save all items in bulk
              await itemRepo.bulkUpsert(allItemsToSave);
// logger.debug(`[LOAD] Saved ${allItemsToSave.length} items via aggressive strategy`);
              
              // Return the items we got
              return successResponse({
                items: allItemsToSave.map(item => ({
                  id: item.ml_item_id,
                  title: item.title,
                  price: item.price,
                  currency_id: item.currency_id,
                  available_quantity: item.available_quantity,
                  sold_quantity: item.sold_quantity,
                  status: item.status,
                  permalink: item.permalink,
                  thumbnail: item.thumbnail,
                  start_time: item.start_time ? new Date(item.start_time * 1000).toISOString() : null,
                })),
                paging: {
                  total: searchResult.paging?.total || 0,
                  offset,
                  limit,
                },
                page,
                saved: allItemsToSave.length,
                hasMore: false, // We've reached the limit
                paginationLimitReached: true,
                message: `Límite de paginación alcanzado. Se obtuvieron ${allItemsToSave.length} items adicionales usando estrategias alternativas (múltiples offsets y órdenes).`,
              });
            }
          }
          
          return successResponse({
            items: [],
            paging: {
              total: searchResult.paging?.total || 0,
              offset,
              limit,
            },
            page,
            saved: 0,
            hasMore: false,
            paginationLimitReached: true,
            message: `Límite de paginación de Mercado Libre alcanzado (offset ${offset}). No se pueden cargar más items desde la API.`,
          });
        }
        
// logger.debug(`[LOAD] No results found for page ${page}, returning empty response`);
        return successResponse({
          items: [],
          paging: {
            total: searchResult.paging?.total || 0,
            offset,
            limit,
          },
          page,
          saved: 0,
          hasMore: false,
          message: 'No hay más items disponibles',
        });
      }

// logger.debug(`[LOAD] Got ${searchResult.results.length} item IDs from ML API`);

      // 2. Check which items already exist in database
// logger.debug(`[LOAD] Checking which items already exist in database...`);
      const existingIds = await itemRepo.findExistingMlItemIds(globalSeller.id, searchResult.results);
// logger.debug(`[LOAD] Found ${existingIds.size} items already in database out of ${searchResult.results.length} total`);

      // 3. Filter out items that already exist - only fetch details for new items
      const newItemIds = searchResult.results.filter(id => !existingIds.has(id));
// logger.debug(`[LOAD] Need to fetch details for ${newItemIds.length} new items (skipping ${existingIds.size} existing)`);

      // 4. Get item details in bulk only for new items (max 20 per request)
      let itemsDetails: any[] = [];
      if (newItemIds.length > 0) {
        try {
          itemsDetails = await itemsService.getItemsBulk(
            newItemIds,
            globalSeller.ml_access_token
          );
        } catch (bulkError) {
          logger.error('[LOAD] Error in getItemsBulk:', bulkError);
          logger.error('[LOAD] Error details:', bulkError instanceof Error ? bulkError.message : String(bulkError));
          logger.error('[LOAD] Error stack:', bulkError instanceof Error ? bulkError.stack : 'No stack trace');
          throw new Error(`Error al obtener detalles de items: ${bulkError instanceof Error ? bulkError.message : String(bulkError)}`);
        }
// logger.debug(`[LOAD] Got ${itemsDetails.length} item details from bulk API`);
      } else {
// logger.debug(`[LOAD] All items already exist in database, skipping API call`);
      }

      // 5. Get existing items from database to return them in response
      const existingItemsMap = new Map<string, Item>();
      if (existingIds.size > 0) {
        // Fetch existing items in batches
        const existingIdsArray = Array.from(existingIds);
        for (let i = 0; i < existingIdsArray.length; i += 100) {
          const batch = existingIdsArray.slice(i, i + 100);
          const placeholders = batch.map(() => '?').join(',');
          const query = `SELECT * FROM items WHERE global_seller_id = ? AND ml_item_id IN (${placeholders})`;
          const stmt = env.DB.prepare(query);
          const results = await stmt.bind(globalSeller.id, ...batch).all<Item>();
          
          if (results.results) {
            results.results.forEach(item => {
              existingItemsMap.set(item.ml_item_id, item);
            });
          }
        }
      }

      // 6. Process and save new items to database
      const itemsToSave: any[] = [];
      const itemsToReturnMap = new Map<string, any>();

      // First, add existing items from DB to response map
      for (const mlItemId of searchResult.results) {
        if (existingItemsMap.has(mlItemId)) {
          const dbItem = existingItemsMap.get(mlItemId)!;
          itemsToReturnMap.set(mlItemId, {
            id: dbItem.ml_item_id,
            site_id: dbItem.site_id,
            title: dbItem.title,
            price: dbItem.price,
            currency_id: dbItem.currency_id,
            available_quantity: dbItem.available_quantity,
            sold_quantity: dbItem.sold_quantity,
            status: dbItem.status,
            listing_type_id: dbItem.listing_type_id,
            condition: dbItem.condition,
            permalink: dbItem.permalink,
            thumbnail: dbItem.thumbnail,
            category_id: dbItem.category_id,
            start_time: dbItem.start_time ? new Date(dbItem.start_time * 1000).toISOString() : null,
            stop_time: dbItem.stop_time ? new Date(dbItem.stop_time * 1000).toISOString() : null,
            end_time: dbItem.end_time ? new Date(dbItem.end_time * 1000).toISOString() : null,
          });
        }
      }

      // Process new items from ML API
      for (const result of itemsDetails) {
        if (result.code === 200 && 'id' in result.body) {
          const mlItem = result.body as any;

          // Prepare item for database
          itemsToSave.push({
            global_seller_id: globalSeller.id,
            ml_item_id: mlItem.id,
            site_id: mlItem.site_id || null,
            title: mlItem.title || null,
            price: mlItem.price || null,
            currency_id: mlItem.currency_id || null,
            available_quantity: mlItem.available_quantity || 0,
            sold_quantity: mlItem.sold_quantity || 0,
            status: mlItem.status || 'active',
            listing_type_id: mlItem.listing_type_id || null,
            condition: mlItem.condition || null,
            permalink: mlItem.permalink || null,
            thumbnail: mlItem.thumbnail || null,
            category_id: mlItem.category_id || null,
            start_time: mlItem.start_time ? Math.floor(new Date(mlItem.start_time).getTime() / 1000) : null,
            stop_time: mlItem.stop_time ? Math.floor(new Date(mlItem.stop_time).getTime() / 1000) : null,
            end_time: mlItem.end_time ? Math.floor(new Date(mlItem.end_time).getTime() / 1000) : null,
            metadata: mlItem, // Store complete metadata
          });

          // Add to response map
          itemsToReturnMap.set(mlItem.id, {
            id: mlItem.id,
            site_id: mlItem.site_id,
            title: mlItem.title,
            price: mlItem.price,
            currency_id: mlItem.currency_id,
            available_quantity: mlItem.available_quantity,
            sold_quantity: mlItem.sold_quantity,
            status: mlItem.status,
            listing_type_id: mlItem.listing_type_id,
            condition: mlItem.condition,
            permalink: mlItem.permalink,
            thumbnail: mlItem.thumbnail,
            category_id: mlItem.category_id,
            start_time: mlItem.start_time,
            stop_time: mlItem.stop_time,
            end_time: mlItem.end_time,
          });
        } else {
          logger.warn(`[LOAD] Skipping item with code ${result.code}:`, result.body);
        }
      }

      // Build final response array in the order of searchResult.results
      const itemsToReturn: any[] = [];
      for (const mlItemId of searchResult.results) {
        if (itemsToReturnMap.has(mlItemId)) {
          itemsToReturn.push(itemsToReturnMap.get(mlItemId)!);
        }
      }

      // 4. Save to database
      let savedCount = 0;
      if (itemsToSave.length > 0) {
        try {
// logger.debug(`[LOAD] Attempting to save ${itemsToSave.length} items to database...`);
          await itemRepo.bulkUpsert(itemsToSave);
          savedCount = itemsToSave.length;
// logger.debug(`[LOAD] ✓ Saved ${savedCount} items to database for page ${page}`);
        } catch (dbError) {
          logger.error(`[LOAD] ✗ Error saving items to database:`, dbError);
          logger.error('[LOAD] DB Error details:', dbError instanceof Error ? dbError.message : String(dbError));
          logger.error('[LOAD] DB Error stack:', dbError instanceof Error ? dbError.stack : 'No stack trace');
          // Continue even if save fails, still return items
        }
      } else {
// logger.debug(`[LOAD] No items to save (itemsToSave.length = 0)`);
      }

      return successResponse({
        items: itemsToReturn,
        paging: {
          total: searchResult.paging?.total || 0,
          offset,
          limit,
        },
        page,
        saved: savedCount,
        hasMore: offset + limit < Math.min(ML_API_LIMITS.MAX_OFFSET, searchResult.paging?.total || 0),
      });
    } catch (error) {
      logger.error('[LOAD] Error in inner try-catch:', error);
      logger.error('[LOAD] Error type:', error?.constructor?.name || typeof error);
      logger.error('[LOAD] Error message:', error instanceof Error ? error.message : String(error));
      logger.error('[LOAD] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      if (error instanceof Error) {
        if (error.message.includes('429') || error.message.includes('rate limit')) {
          return errorResponse('Límite de rate limit alcanzado. Por favor espera unos momentos e intenta de nuevo.', 429, 'RATE_LIMIT');
        }
      }
      throw error;
    }
  } catch (error) {
    logger.error('[LOAD] Error in outer catch:', error);
    logger.error('[LOAD] Error type:', error?.constructor?.name || typeof error);
    logger.error('[LOAD] Error message:', error instanceof Error ? error.message : String(error));
    logger.error('[LOAD] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return handleError(error);
  }
}

/**
 * GET /api/global-sellers/:id/items/:cbtId/marketplace-items
 * Get marketplace items (countries) where a CBT is published
 */
export async function getMarketplaceItemsHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const globalSellerRepo = new GlobalSellerRepository(env.DB);
    const mlAPIService = new MercadoLibreAPIService();
    const globalSellerService = new GlobalSellerService(globalSellerRepo, mlAPIService);
    const itemsService = new MercadoLibreItemsService();
    const itemRepo = new ItemRepository(env.DB);
    const marketplaceItemRepo = new MarketplaceItemRepository(env.DB);

    const user = await requireAuth(request, env, authService);

    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const globalSellerId = pathParts[3]; // /api/global-sellers/:id/items/:cbtId/marketplace-items
    const cbtId = pathParts[5]; // The CBT ID (e.g., CBT3343294634)

    if (!globalSellerId || !cbtId) {
      return errorResponse('Global Seller ID and CBT ID are required', 400, 'MISSING_PARAMS');
    }

    const globalSeller = await globalSellerService.getById(globalSellerId);

    if (!globalSeller) {
      return errorResponse('Global Seller not found', 404, 'NOT_FOUND');
    }

    if (globalSeller.user_id !== user.id) {
      return errorResponse('Access denied', 403, 'FORBIDDEN');
    }

    // Find the item in database
    const item = await itemRepo.findByMlItemId(globalSellerId, cbtId);

    if (!item) {
      return errorResponse('Item not found in database', 404, 'ITEM_NOT_FOUND');
    }

    // Get marketplace items from ML API
    try {
      const marketplaceData = await itemsService.getMarketplaceItems(
        cbtId,
        globalSeller.ml_access_token
      );

      // Save marketplace items to database
      const marketplaceItemsToSave = marketplaceData.marketplace_items.map(mi => ({
        item_id: mi.item_id,
        site_id: mi.site_id,
        date_created: mi.date_created,
      }));

      await marketplaceItemRepo.upsertMarketplaceItems(
        item.id,
        globalSellerId,
        cbtId,
        marketplaceItemsToSave
      );

      // Get saved marketplace items from database
      const savedMarketplaceItems = await marketplaceItemRepo.findByItemId(item.id);
      
      // Optionally sync performance for new marketplace items (in background, non-blocking)
      // Check if ?sync_performance=true query parameter is present
      const syncPerformance = url.searchParams.get('sync_performance') === 'true';
      if (syncPerformance && savedMarketplaceItems.length > 0) {
        // Sync performance in background (don't wait for it)
        (async () => {
          const itemsService = new MercadoLibreItemsService();
          for (const mi of savedMarketplaceItems) {
            // Only sync if we don't have performance data yet
            if (!mi.performance_score && !mi.performance_data) {
              await syncMarketplaceItemPerformance(
                mi.ml_item_id,
                globalSeller.ml_access_token,
                marketplaceItemRepo,
                itemsService
              );
              // Small delay to respect rate limits
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }
        })().catch(err => {
          logger.warn('Background performance sync failed:', err);
        });
      }

      return successResponse({
        cbt_id: cbtId,
        item_id: item.id,
        marketplace_items: savedMarketplaceItems.map(mi => ({
          id: mi.id,
          ml_item_id: mi.ml_item_id,
          site_id: mi.site_id,
          date_created: mi.date_created,
          performance_score: mi.performance_score,
          performance_level: mi.performance_level,
          performance_level_wording: mi.performance_level_wording,
        })),
        total_countries: savedMarketplaceItems.length,
        countries: savedMarketplaceItems.map(mi => mi.site_id),
      });
    } catch (error) {
      logger.error(`Error getting marketplace items for CBT ${cbtId}:`, error);
      
      // If API fails, try to return cached data from database
      const cachedMarketplaceItems = await marketplaceItemRepo.findByItemId(item.id);
      
      if (cachedMarketplaceItems.length > 0) {
        logger.warn(`Returning cached marketplace items for CBT ${cbtId}`);
        return successResponse({
          cbt_id: cbtId,
          item_id: item.id,
          marketplace_items: cachedMarketplaceItems.map(mi => ({
            id: mi.id,
            ml_item_id: mi.ml_item_id,
            site_id: mi.site_id,
            date_created: mi.date_created,
          })),
          total_countries: cachedMarketplaceItems.length,
          countries: cachedMarketplaceItems.map(mi => mi.site_id),
          cached: true,
          warning: 'Using cached data. ML API request failed.',
        });
      }

      // If no cached data and API failed, return error
      if (error instanceof Error) {
        if (error.message.includes('404')) {
          return errorResponse('CBT not found or not a cross-border trade item', 404, 'CBT_NOT_FOUND');
        }
      }

      return handleError(error);
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return handleError(error);
  }
}


/**
 * GET /api/global-sellers/:id/marketplace-items
 * Get all marketplace items for all CBTs of a global seller from database
 */
export async function getAllMarketplaceItemsHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const globalSellerRepo = new GlobalSellerRepository(env.DB);
    const mlAPIService = new MercadoLibreAPIService();
    const globalSellerService = new GlobalSellerService(globalSellerRepo, mlAPIService);
    const marketplaceItemRepo = new MarketplaceItemRepository(env.DB);
    const itemRepo = new ItemRepository(env.DB);

    const user = await requireAuth(request, env, authService);

    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const globalSellerId = pathParts[3]; // /api/global-sellers/:id/marketplace-items

    if (!globalSellerId) {
      return errorResponse('Global Seller ID is required', 400, 'MISSING_PARAMS');
    }

    const globalSeller = await globalSellerService.getById(globalSellerId);

    if (!globalSeller) {
      return errorResponse('Global Seller not found', 404, 'NOT_FOUND');
    }

    if (globalSeller.user_id !== user.id) {
      return errorResponse('Access denied', 403, 'FORBIDDEN');
    }

    // Get all marketplace items for this global seller from database
    const allMarketplaceItems = await marketplaceItemRepo.findByGlobalSellerId(globalSellerId);

    // Group by CBT ID (ml_item_id) with performance data
    const marketplaceItemsByCbt: Record<string, Array<{
      site_id: string;
      ml_item_id: string;
      performance_score?: number | null;
      performance_level?: string | null;
      performance_level_wording?: string | null;
    }>> = {};
    
    for (const mi of allMarketplaceItems) {
      // Find the CBT ID by looking up the item
      const item = await itemRepo.findById(mi.item_id);
      if (!item) continue;
      
      const cbtId = item.ml_item_id;
      if (!marketplaceItemsByCbt[cbtId]) {
        marketplaceItemsByCbt[cbtId] = [];
      }
      marketplaceItemsByCbt[cbtId].push({
        site_id: mi.site_id,
        ml_item_id: mi.ml_item_id,
        performance_score: mi.performance_score,
        performance_level: mi.performance_level,
        performance_level_wording: mi.performance_level_wording,
      });
    }

    return successResponse({
      global_seller_id: globalSellerId,
      marketplace_items_by_cbt: marketplaceItemsByCbt,
      total_cbts: Object.keys(marketplaceItemsByCbt).length,
      total_marketplace_items: allMarketplaceItems.length,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return handleError(error);
  }
}

/**
 * POST /api/global-sellers/:id/items/sync-cbt-marketplace-items
 * Sync marketplace items (items_id) for all CBTs of a Global Seller
 * This endpoint identifies all CBTs and fetches their marketplace items
 */
export async function syncCbtMarketplaceItemsHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const globalSellerRepo = new GlobalSellerRepository(env.DB);
    const mlAPIService = new MercadoLibreAPIService();
    const globalSellerService = new GlobalSellerService(globalSellerRepo, mlAPIService);
    const itemsService = new MercadoLibreItemsService();
    const itemRepo = new ItemRepository(env.DB);
    const marketplaceItemRepo = new MarketplaceItemRepository(env.DB);

    const user = await requireAuth(request, env, authService);

    const url = new URL(request.url);
    const id = url.pathname.split('/')[3]; // /api/global-sellers/:id/items/sync-cbt-marketplace-items

    if (!id) {
      return errorResponse('Global Seller ID is required', 400, 'MISSING_ID');
    }

    const globalSeller = await globalSellerService.getById(id);

    if (!globalSeller) {
      return errorResponse('Global Seller not found', 404, 'NOT_FOUND');
    }

    if (globalSeller.user_id !== user.id) {
      return errorResponse('Access denied', 403, 'FORBIDDEN');
    }

// logger.debug(`[SYNC CBT MARKETPLACE] Starting sync for Global Seller ${globalSeller.id}, ml_user_id: ${globalSeller.ml_user_id}`);

    // Start sync in background
    (async () => {
      try {
        // Step 1: Get all items using scan mode
// logger.debug(`[SYNC CBT MARKETPLACE] Step 1: Getting all items using scan mode...`);
        const allItemIds = await itemsService.getAllItemsWithScan(
          globalSeller.ml_user_id,
          globalSeller.ml_access_token,
          'all', // Get all statuses
          (current) => {
// logger.debug(`[SYNC CBT MARKETPLACE] Scanned ${current} items so far...`);
          }
        );

// logger.debug(`[SYNC CBT MARKETPLACE] Found ${allItemIds.length} total items`);

        // Step 2: Get item details in bulk to identify CBTs
// logger.debug(`[SYNC CBT MARKETPLACE] Step 2: Identifying CBTs...`);
        const batchSize = ML_API_LIMITS.MAX_ITEMS_PER_BULK_REQUEST;
        const cbtIds: string[] = [];
        const itemDetailsMap = new Map<string, any>();

        for (let i = 0; i < allItemIds.length; i += batchSize) {
          const batch = allItemIds.slice(i, i + batchSize);
          const itemsDetails = await itemsService.getItemsBulk(batch, globalSeller.ml_access_token);

          for (const result of itemsDetails) {
            if (result.code === 200 && result.body !== undefined) {
              const body = result.body;
              if ('id' in body) {
                const item = body as unknown as MLItem;
                itemDetailsMap.set(item.id, item);
                
                // Check if item is a CBT (site_id starts with "CBT")
                if (item.site_id && item.site_id.startsWith('CBT')) {
                  cbtIds.push(item.id);
                }
              }
            }
          }
        }

// logger.debug(`[SYNC CBT MARKETPLACE] Found ${cbtIds.length} CBTs by site_id pattern`);

        // Step 3: For each CBT, get marketplace items and save to database
// logger.debug(`[SYNC CBT MARKETPLACE] Step 3: Syncing marketplace items for ${cbtIds.length} CBTs...`);
        let syncedCount = 0;
        let failedCount = 0;
        let totalMarketplaceItems = 0;
        const errors: Array<{ cbt_id: string; error: string }> = [];

        for (let i = 0; i < cbtIds.length; i++) {
          const cbtId = cbtIds[i];
          try {
            // Get marketplace items from ML API
            const marketplaceData = await itemsService.getMarketplaceItems(
              cbtId,
              globalSeller.ml_access_token
            );

            if (marketplaceData.marketplace_items && marketplaceData.marketplace_items.length > 0) {
              // Find the item in database
              const item = await itemRepo.findByMlItemId(globalSeller.id, cbtId);
              
              if (item) {
                // Save marketplace items to database
                const marketplaceItemsToSave = marketplaceData.marketplace_items.map(mi => ({
                  item_id: mi.item_id,
                  site_id: mi.site_id,
                  date_created: mi.date_created,
                }));

                await marketplaceItemRepo.upsertMarketplaceItems(
                  item.id,
                  globalSeller.id,
                  cbtId,
                  marketplaceItemsToSave
                );

                totalMarketplaceItems += marketplaceItemsToSave.length;
                syncedCount++;
                
// logger.debug(`[SYNC CBT MARKETPLACE] CBT ${cbtId}: ${marketplaceItemsToSave.length} marketplace items saved (${i + 1}/${cbtIds.length})`);
              } else {
                logger.warn(`[SYNC CBT MARKETPLACE] CBT ${cbtId} not found in database, skipping`);
                failedCount++;
                errors.push({ cbt_id: cbtId, error: 'Item not found in database' });
              }
            } else {
// logger.debug(`[SYNC CBT MARKETPLACE] CBT ${cbtId}: No marketplace items found`);
            }
          } catch (error) {
            failedCount++;
            const errorMessage = error instanceof Error ? error.message : String(error);
            errors.push({ cbt_id: cbtId, error: errorMessage });
            logger.warn(`[SYNC CBT MARKETPLACE] Failed to sync CBT ${cbtId}:`, errorMessage);
          }
        }

// logger.debug(`[SYNC CBT MARKETPLACE] Sync complete: ${syncedCount}/${cbtIds.length} CBTs synced, ${totalMarketplaceItems} total marketplace items, ${failedCount} failed`);
      } catch (error) {
        logger.error(`[SYNC CBT MARKETPLACE] Error in background sync:`, error);
      }
    })();

    // Return immediately with success response
    return successResponse({
      message: 'CBT marketplace items sync started in background',
      status: 'started',
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return handleError(error);
  }
}

/**
 * Helper function to sync performance for a single marketplace item
 * Returns true if successful, false otherwise (doesn't throw)
 */
async function syncMarketplaceItemPerformance(
  mlItemId: string,
  accessToken: string,
  marketplaceItemRepo: MarketplaceItemRepository,
  itemsService: MercadoLibreItemsService
): Promise<boolean> {
  try {
    const performance = await itemsService.getItemPerformance(mlItemId, accessToken);
    
    await marketplaceItemRepo.updatePerformance(mlItemId, {
      score: performance.score,
      level: performance.level,
      level_wording: performance.level_wording,
      calculated_at: performance.calculated_at,
      data: JSON.stringify(performance),
    });
    
    return true;
  } catch (error) {
    logger.warn(`Failed to sync performance for ${mlItemId}:`, error);
    return false;
  }
}

/**
 * GET /api/global-sellers/:id/items/:cbtId/performance
 * Get or update performance (Listings Quality) for all marketplace items of a CBT
 */
export async function getItemPerformanceHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const globalSellerRepo = new GlobalSellerRepository(env.DB);
    const mlAPIService = new MercadoLibreAPIService();
    const globalSellerService = new GlobalSellerService(globalSellerRepo, mlAPIService);
    const itemsService = new MercadoLibreItemsService();
    const itemRepo = new ItemRepository(env.DB);
    const marketplaceItemRepo = new MarketplaceItemRepository(env.DB);

    const user = await requireAuth(request, env, authService);

    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const globalSellerId = pathParts[3]; // /api/global-sellers/:id/items/:cbtId/performance
    const cbtId = pathParts[5]; // The CBT ID (e.g., CBT3343294634)

    if (!globalSellerId || !cbtId) {
      return errorResponse('Global Seller ID and CBT ID are required', 400, 'MISSING_PARAMS');
    }

    const globalSeller = await globalSellerService.getById(globalSellerId);

    if (!globalSeller) {
      return errorResponse('Global Seller not found', 404, 'NOT_FOUND');
    }

    if (globalSeller.user_id !== user.id) {
      return errorResponse('Access denied', 403, 'FORBIDDEN');
    }

    // Find the item in database
    const item = await itemRepo.findByMlItemId(globalSellerId, cbtId);

    if (!item) {
      return errorResponse('Item not found in database', 404, 'ITEM_NOT_FOUND');
    }

    // Get all marketplace items for this CBT
    const marketplaceItems = await marketplaceItemRepo.findByItemId(item.id);

    if (marketplaceItems.length === 0) {
      return successResponse({
        cbt_id: cbtId,
        performance: [],
        message: 'No marketplace items found for this CBT'
      });
    }

    // Check if we should refresh performance data (query parameter ?refresh=true)
    const refresh = url.searchParams.get('refresh') === 'true';

    const performanceResults: Array<{
      ml_item_id: string;
      site_id: string;
      score: number | null;
      level: string | null;
      level_wording: string | null;
      calculated_at: string | null;
      has_data: boolean;
      buckets?: Array<{
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
      error?: string;
    }> = [];

    // Process each marketplace item
    for (const mi of marketplaceItems) {
      // If not refreshing and we have cached data, use it
      if (!refresh && mi.performance_score !== null && mi.performance_score !== undefined) {
        // Parse performance_data if available
        let buckets = undefined;
        if (mi.performance_data) {
          try {
            const performanceData = JSON.parse(mi.performance_data);
            buckets = performanceData.buckets;
          } catch (e) {
            logger.warn(`Error parsing performance_data for ${mi.ml_item_id}:`, e);
          }
        }
        
        performanceResults.push({
          ml_item_id: mi.ml_item_id,
          site_id: mi.site_id,
          score: mi.performance_score,
          level: mi.performance_level || null,
          level_wording: mi.performance_level_wording || null,
          calculated_at: mi.performance_calculated_at || null,
          has_data: true,
          buckets: buckets,
        });
        continue;
      }

      // Fetch fresh performance data from ML API
      try {
        const success = await syncMarketplaceItemPerformance(
          mi.ml_item_id,
          globalSeller.ml_access_token,
          marketplaceItemRepo,
          itemsService
        );
        
        if (success) {
          // Reload from database to get fresh data
          const updatedMi = await marketplaceItemRepo.findByMlItemId(mi.ml_item_id);
          if (updatedMi) {
            let buckets = undefined;
            if (updatedMi.performance_data) {
              try {
                const performanceData = JSON.parse(updatedMi.performance_data);
                buckets = performanceData.buckets;
              } catch (e) {
                logger.warn(`Error parsing performance_data for ${mi.ml_item_id}:`, e);
              }
            }
            
            performanceResults.push({
              ml_item_id: updatedMi.ml_item_id,
              site_id: updatedMi.site_id,
              score: updatedMi.performance_score ?? null,
              level: updatedMi.performance_level || null,
              level_wording: updatedMi.performance_level_wording || null,
              calculated_at: updatedMi.performance_calculated_at || null,
              has_data: true,
              buckets: buckets,
            });
          }
        } else {
          throw new Error('Failed to sync performance');
        }
      } catch (error) {
        logger.error(`Error getting performance for ${mi.ml_item_id}:`, error);
        
        // If we have cached data, use it even if refresh failed
        if (mi.performance_score !== null && mi.performance_score !== undefined) {
          // Parse performance_data if available
          let buckets = undefined;
          if (mi.performance_data) {
            try {
              const performanceData = JSON.parse(mi.performance_data);
              buckets = performanceData.buckets;
            } catch (e) {
              logger.warn(`Error parsing performance_data for ${mi.ml_item_id}:`, e);
            }
          }
          
          performanceResults.push({
            ml_item_id: mi.ml_item_id,
            site_id: mi.site_id,
            score: mi.performance_score,
            level: mi.performance_level || null,
            level_wording: mi.performance_level_wording || null,
            calculated_at: mi.performance_calculated_at || null,
            has_data: true,
            buckets: buckets,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        } else {
          performanceResults.push({
            ml_item_id: mi.ml_item_id,
            site_id: mi.site_id,
            score: null,
            level: null,
            level_wording: null,
            calculated_at: null,
            has_data: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    return successResponse({
      cbt_id: cbtId,
      performance: performanceResults,
      total_marketplace_items: marketplaceItems.length,
      refreshed: refresh,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return handleError(error);
  }
}

/**
 * POST /api/global-sellers/:id/performance/sync
 * Sync performance data for all marketplace items of a Global Seller
 * Processes in batches with rate limiting
 */
export async function syncAllPerformanceHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const globalSellerRepo = new GlobalSellerRepository(env.DB);
    const mlAPIService = new MercadoLibreAPIService();
    const globalSellerService = new GlobalSellerService(globalSellerRepo, mlAPIService);
    const itemsService = new MercadoLibreItemsService();
    const marketplaceItemRepo = new MarketplaceItemRepository(env.DB);

    const user = await requireAuth(request, env, authService);

    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const globalSellerId = pathParts[3]; // /api/global-sellers/:id/performance/sync

    if (!globalSellerId) {
      return errorResponse('Global Seller ID is required', 400, 'MISSING_PARAMS');
    }

    const globalSeller = await globalSellerService.getById(globalSellerId);

    if (!globalSeller) {
      return errorResponse('Global Seller not found', 404, 'NOT_FOUND');
    }

    if (globalSeller.user_id !== user.id) {
      return errorResponse('Access denied', 403, 'FORBIDDEN');
    }

    // Get query parameters
    const forceRefresh = url.searchParams.get('force') === 'true'; // Force refresh even if data exists
    const batchSize = parseInt(url.searchParams.get('batch_size') || '5', 10); // Items per batch
    const delayMs = parseInt(url.searchParams.get('delay_ms') || '500', 10); // Delay between items

    // Get all marketplace items for this global seller
    const allMarketplaceItems = await marketplaceItemRepo.findByGlobalSellerId(globalSellerId);

    // Filter items that need syncing
    const itemsToSync = forceRefresh
      ? allMarketplaceItems
      : allMarketplaceItems.filter(mi => !mi.performance_score && !mi.performance_data);

    if (itemsToSync.length === 0) {
      return successResponse({
        message: 'No items need performance sync',
        total_items: allMarketplaceItems.length,
        items_with_performance: allMarketplaceItems.filter(mi => mi.performance_score).length,
        synced: 0,
        failed: 0,
      });
    }

    // Start sync in background
    (async () => {
      let synced = 0;
      let failed = 0;

      // Process in batches
      for (let i = 0; i < itemsToSync.length; i += batchSize) {
        const batch = itemsToSync.slice(i, i + batchSize);

        // Process batch sequentially (not in parallel) to respect rate limits
        for (const mi of batch) {
          const success = await syncMarketplaceItemPerformance(
            mi.ml_item_id,
            globalSeller.ml_access_token,
            marketplaceItemRepo,
            itemsService
          );

          if (success) {
            synced++;
          } else {
            failed++;
          }

          // Delay between items
          if (i + batch.indexOf(mi) < itemsToSync.length - 1) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
        }

        // Delay between batches
        if (i + batchSize < itemsToSync.length) {
          await new Promise(resolve => setTimeout(resolve, delayMs * 2));
        }
      }

      logger.info(`Performance sync completed for Global Seller ${globalSellerId}: ${synced} synced, ${failed} failed`);
    })().catch(err => {
      logger.error('Background performance sync error:', err);
    });

    return successResponse({
      message: 'Performance sync started in background',
      total_items: allMarketplaceItems.length,
      items_to_sync: itemsToSync.length,
      batch_size: batchSize,
      estimated_time_seconds: Math.ceil((itemsToSync.length * delayMs) / 1000),
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return handleError(error);
  }
}

/**
 * POST /api/global-sellers/:id/cbts/sync
 * Sync all CBTs (Cross Border Trade items) for a Global Seller
 * Uses scan mode to find all CBTs and saves them to database
 */
export async function syncCBTsHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const globalSellerRepo = new GlobalSellerRepository(env.DB);
    const mlAPIService = new MercadoLibreAPIService();
    const globalSellerService = new GlobalSellerService(globalSellerRepo, mlAPIService);
    const itemsService = new MercadoLibreItemsService();
    const itemRepo = new ItemRepository(env.DB);

    const user = await requireAuth(request, env, authService);

    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const globalSellerId = pathParts[3]; // /api/global-sellers/:id/cbts/sync

    if (!globalSellerId) {
      logger.error(`[SYNC CBTS HANDLER] Missing globalSellerId`);
      return errorResponse('Global Seller ID is required', 400, 'MISSING_ID');
    }

    const globalSeller = await globalSellerService.getById(globalSellerId);

    if (!globalSeller) {
      logger.error(`[SYNC CBTS HANDLER] Global seller not found`);
      return errorResponse('Global Seller not found', 404, 'NOT_FOUND');
    }

    if (globalSeller.user_id !== user.id) {
      logger.error(`[SYNC CBTS HANDLER] Access denied: user ${user.id} != seller.user_id ${globalSeller.user_id}`);
      return errorResponse('Access denied', 403, 'FORBIDDEN');
    }

    if (!globalSeller.ml_user_id || !globalSeller.ml_access_token || 
        globalSeller.ml_user_id.trim() === '' || globalSeller.ml_access_token.trim() === '') {
      logger.error(`[SYNC CBTS HANDLER] ML credentials missing or empty`);
      return errorResponse('Mercado Libre credentials not configured. Please update the Global Seller with valid ML credentials.', 400, 'ML_CREDENTIALS_MISSING');
    }

    // Get query parameters
    const maxItemsParam = url.searchParams.get('maxItems');
    const maxItems = maxItemsParam && !isNaN(parseInt(maxItemsParam, 10))
      ? parseInt(maxItemsParam, 10)
      : undefined;

    logger.info(`[SYNC CBTS] Starting CBT sync for Global Seller ${globalSellerId}${maxItems ? `, maxItems: ${maxItems}` : ''}`);

    // Process multiple pages synchronously before returning response
    // This ensures the process completes even if Cloudflare Workers terminates the context
    let totalSaved = 0;
    const startTime = Date.now();
    let scrollId: string | null | undefined = null;
    let scrollIdStartTime: number | null = null;
    let pageCount = 0;
    let hasMore = true;
          let fetchErrorCount = 0;
          const MAX_ERRORS = 3;
          const SYNC_PAGES_BEFORE_RESPONSE = 5; // Process 5 pages (500 CBTs) before returning
          let consecutiveDuplicatePages = 0; // Track pages with all duplicates
          const MAX_CONSECUTIVE_DUPLICATES = 50; // Warn if 50 pages (5000 items) are all duplicates
          const MAX_CONSECUTIVE_DUPLICATES_TO_STOP = 200; // Stop if 200 pages (20000 items) are all duplicates - likely reached end

    while (hasMore && pageCount < SYNC_PAGES_BEFORE_RESPONSE) {
      try {
        // Check if scroll_id expired (5 minutes)
        // IMPORTANT: We continue using the last scroll_id even if 5 minutes passed
        // Only when ML returns error 400, we'll make a new initial request
        // This allows us to continue from where we left off
        const now = Date.now();
        const SCROLL_ID_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
        if (scrollId && scrollIdStartTime) {
          const elapsed = now - scrollIdStartTime;
          if (elapsed >= SCROLL_ID_EXPIRY_MS) {
            logger.warn(`[SYNC CBTS] Scroll ID expired (${(elapsed / 1000).toFixed(0)}s) - continuing with last scroll_id`);
            // Don't reset scrollId here - continue using it until ML rejects it with error 400
          }
        }

        const searchResult = await itemsService.searchItemsWithScan(
          globalSeller.ml_user_id,
          globalSeller.ml_access_token,
          {
            limit: 100,
            scroll_id: scrollId || undefined, // If scrollId is null, this will be undefined = new initial request
          }
        );

        // Update scroll_id with the one from response
        if (searchResult.scroll_id && !scrollId) {
          scrollIdStartTime = Date.now();
          logger.info(`[SYNC CBTS] New scroll_id obtained - expires in 5 minutes`);
        }
        scrollId = searchResult.scroll_id || null;

        // Reset error count on success
        fetchErrorCount = 0;

        if (!searchResult.results || searchResult.results.length === 0) {
          hasMore = false;
          break;
        }

        // Filter CBT IDs
        const cbtIds = searchResult.results.filter(id => id && id.startsWith('CBT'));

        if (cbtIds.length > 0) {
          const now = Math.floor(Date.now() / 1000);
          const itemsToSave = cbtIds.map(cbtId => ({
            id: '',
            global_seller_id: globalSeller.id,
            ml_item_id: cbtId,
            site_id: null,
            title: null,
            price: null,
            currency_id: null,
            available_quantity: 0,
            sold_quantity: 0,
            status: 'active' as const,
            listing_type_id: null,
            condition: null,
            permalink: null,
            thumbnail: null,
            category_id: null,
            start_time: null,
            stop_time: null,
            end_time: null,
            synced_at: now,
            metadata: { id: cbtId } as any,
          }));

          await itemRepo.bulkUpsert(itemsToSave as any);
          totalSaved += itemsToSave.length;

          // Verify actual count in database after save
          const countBefore = await itemRepo.getCBTsCount(globalSeller.id);
          const actualCount = await itemRepo.getCBTsCount(globalSeller.id);
          const newItems = actualCount - countBefore;

            // Track consecutive duplicate pages
            if (newItems === 0) {
              consecutiveDuplicatePages++;
              
              // Stop if we've processed too many consecutive duplicate pages
              if (consecutiveDuplicatePages >= MAX_CONSECUTIVE_DUPLICATES_TO_STOP) {
                try {
                  const finalCount = await itemRepo.getCBTsCount(globalSeller.id);
                  if (finalCount < totalSaved) {
                    logger.warn(`[SYNC CBTS] Database count (${finalCount}) may be less than processed count (${totalSaved}) due to duplicates`);
                  }
                } catch (verifyError) {
                  logger.error(`[SYNC CBTS] Error in final verification:`, verifyError);
                }
                
                logger.info(`[SYNC CBTS] Stopping sync after ${consecutiveDuplicatePages} consecutive duplicate pages - likely reached end of new items`);
                hasMore = false;
                break;
              } else if (consecutiveDuplicatePages >= MAX_CONSECUTIVE_DUPLICATES) {
                logger.warn(`[SYNC CBTS] ${consecutiveDuplicatePages} consecutive pages with all duplicates - sync continues but no new items found`);
              }
            } else {
              consecutiveDuplicatePages = 0; // Reset counter when we find new items
            }

          // Check if we've reached the maxItems limit
          if (maxItems && totalSaved >= maxItems) {
            hasMore = false;
            break;
          }
        }

        // Check if we should continue
        if (searchResult.scroll_id === null || searchResult.scroll_id === undefined) {
          hasMore = false;
        } else {
          hasMore = true;
        }

        pageCount++;

        // Small delay between pages
        if (hasMore && pageCount < SYNC_PAGES_BEFORE_RESPONSE) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }

      } catch (error) {
        fetchErrorCount++;
        console.error(`[SYNC CBTS] ❌ Error on page ${pageCount + 1}:`, error);
        console.error(`[SYNC CBTS] ❌ Error details:`, error instanceof Error ? error.message : String(error));
        
        // Check if it's a token expiration error (401)
        // ML API returns: { "code": "unauthorized", "message": "invalid access token" } with status 401
        const errorMsg = error instanceof Error ? error.message : String(error);
        const isTokenError = errorMsg.includes('401') || 
                             errorMsg.includes('Unauthorized') || 
                             errorMsg.includes('unauthorized') ||
                             errorMsg.includes('invalid access token') ||
                             errorMsg.includes('expired');
        
        // Check if it's a scroll_id expiration error (400 with scroll_id message)
        // This is different from token expiration (401)
        const isScrollIdError = !isTokenError && 
                                errorMsg.includes('400') && 
                                (errorMsg.includes('scroll_id') || 
                                 errorMsg.includes('scroll') ||
                                 (errorMsg.includes('invalid') && errorMsg.includes('id')));
        
        if (isScrollIdError) {
          logger.warn(`[SYNC CBTS] Scroll ID expired (error 400) - making new initial request to get fresh scroll_id (page ${pageCount + 1})`);
          // Reset scroll_id to null - next call will be WITHOUT scroll_id (new initial request)
          // This will get us a fresh scroll_id from Mercado Libre
          // The database will filter duplicates, so we continue from where we left off
          scrollId = null;
          scrollIdStartTime = null;
          // Reset error count since this is expected behavior (scroll_id expires every 5 minutes)
          fetchErrorCount = 0;
          // Small delay before retrying with new initial request
          await new Promise(resolve => setTimeout(resolve, 1000));
          // Continue to next iteration (will make NEW INITIAL REQUEST without scroll_id)
          // Database will handle duplicates, so we effectively continue from where we left off
          continue;
        }
        
        // If token error or too many errors, ensure all processed CBTs are saved
        if (isTokenError || fetchErrorCount >= MAX_ERRORS) {
          if (isTokenError) {
            logger.error(`[SYNC CBTS] Token expired - pausing sync (page ${pageCount + 1}, total saved: ${totalSaved})`);
          }
          // IMPORTANT: Ensure all processed CBTs are saved before stopping
          try {
            const finalCount = await itemRepo.getCBTsCount(globalSeller.id);
            if (finalCount < totalSaved) {
              logger.warn(`[SYNC CBTS] Database count (${finalCount}) is less than processed count (${totalSaved})`);
            }
          } catch (verifyError) {
            logger.error(`[SYNC CBTS] Error verifying final count:`, verifyError);
            // Continue anyway - the CBTs should already be saved from previous pages
          }
        }
        
        // Stop after too many errors
        if (fetchErrorCount >= MAX_ERRORS) {
          logger.error(`[SYNC CBTS] Stopped after ${MAX_ERRORS} consecutive errors`);
          hasMore = false;
          break;
        }
        
        // Small delay before retry
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Continue in background if there are more pages
    let backgroundSyncPromise: Promise<void> | null = null;
    if (hasMore) {
      logger.info(`[SYNC CBTS] Continuing sync in background (pageCount: ${pageCount}, totalSaved: ${totalSaved})`);
      backgroundSyncPromise = (async () => {
        try {
          
          let consecutiveDuplicatePages = 0; // Track pages with all duplicates in background
          const MAX_CONSECUTIVE_DUPLICATES = 50; // Warn if 50 pages (5000 items) are all duplicates
          const MAX_CONSECUTIVE_DUPLICATES_TO_STOP = 200; // Stop if 200 pages (20000 items) are all duplicates - likely reached end
          
          while (hasMore) {
          // Check if scroll_id expired (5 minutes = 300,000 ms)
          // IMPORTANT: We continue using the last scroll_id even if 5 minutes passed
          // Only when ML returns error 400, we'll make a new initial request
          // This allows us to continue from where we left off
          const now = Date.now();
          const SCROLL_ID_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
          if (scrollId && scrollIdStartTime) {
            const elapsed = now - scrollIdStartTime;
            const remaining = SCROLL_ID_EXPIRY_MS - elapsed;
            
            if (elapsed >= SCROLL_ID_EXPIRY_MS) {
              logger.warn(`[SYNC CBTS] Scroll ID expired (${(elapsed / 1000).toFixed(0)}s elapsed, limit: 300s)`);
              // Don't reset scrollId here - continue using it until ML rejects it with error 400
            }
          }

          try {
            // Get next page using scan mode
// console.log(`[SYNC CBTS] 🔍 Fetching page ${pageCount + 1}...`);
            if (scrollId) {
// console.log(`[SYNC CBTS] 🔑 Using scroll_id: ${scrollId.substring(0, 20)}... (continuing pagination)`);
            } else {
// console.log(`[SYNC CBTS] 🔑 Making NEW INITIAL REQUEST (no scroll_id) - will get fresh scroll_id from ML`);
            }
// console.log(`[SYNC CBTS] 🔑 Using token: ${globalSeller.ml_access_token ? globalSeller.ml_access_token.substring(0, 20) + '... (length: ' + globalSeller.ml_access_token.length + ')' : 'MISSING'}`);
// console.log(`[SYNC CBTS] 📊 Progress check: totalSaved=${totalSaved}, maxItems=${maxItems ? maxItems : 'NONE'}, remaining=${maxItems ? (maxItems - totalSaved) : 'N/A'}`);
            const searchResult = await itemsService.searchItemsWithScan(
              globalSeller.ml_user_id,
              globalSeller.ml_access_token,
              {
                limit: 100,
                scroll_id: scrollId || undefined, // If scrollId is null, this will be undefined = new initial request
              }
            );
// console.log(`[SYNC CBTS] ✅ API call completed for page ${pageCount + 1}`);
// console.log(`[SYNC CBTS] 📊 After API call - totalSaved: ${totalSaved}, maxItems: ${maxItems}, hasMore: ${hasMore}`);

// console.log(`[SYNC CBTS] ✅ Received ${searchResult.results?.length || 0} item IDs from page ${pageCount + 1}`);
// console.log(`[SYNC CBTS] 📋 Response scroll_id: ${searchResult.scroll_id ? searchResult.scroll_id.substring(0, 20) + '...' : 'NULL'}`);
// console.log(`[SYNC CBTS] 📋 Current stored scroll_id: ${scrollId ? scrollId.substring(0, 20) + '...' : 'NULL'}`);

            // Update scroll_id with the one from response (same as frontend implementation that worked)
            // Frontend code: scrollId = data.scroll_id || null;
            // IMPORTANT: When we make a new initial request (scrollId was null), we get a fresh scroll_id
            if (searchResult.scroll_id && !scrollId) {
              scrollIdStartTime = Date.now();
// console.log(`[SYNC CBTS] 🔑✅ NEW scroll_id obtained from ML (fresh initial request)`);
              logger.info(`[SYNC CBTS] New scroll_id obtained - expires in 5 minutes`);
            } else if (searchResult.scroll_id && scrollId) {
// console.log(`[SYNC CBTS] 🔄 Updated scroll_id: ${searchResult.scroll_id.substring(0, 20)}... (continuing pagination)`);
            }
            scrollId = searchResult.scroll_id || null;
            
            if (scrollId) {
              const SCROLL_ID_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
              const timeRemaining = scrollIdStartTime ? Math.max(0, SCROLL_ID_EXPIRY_MS - (Date.now() - scrollIdStartTime)) : 0;
// console.log(`[SYNC CBTS] 🔑 Current scroll_id: ${scrollId.substring(0, 20)}... (expires in ${(timeRemaining / 1000).toFixed(0)}s)`);
            } else {
// console.log(`[SYNC CBTS] ⚠️ No scroll_id in response (may have reached end of results)`);
            }
            
            // Reset error count on success
            fetchErrorCount = 0;

            if (!searchResult.results || searchResult.results.length === 0) {
              hasMore = false;
              break;
            }

            // All results are CBT IDs (they start with "CBT")
            const cbtIds = searchResult.results.filter(id => id && id.startsWith('CBT'));
            
            // Log first and last CBT IDs to verify we're getting different items
            if (cbtIds.length > 0) {
// console.log(`[SYNC CBTS] 🔍 Sample CBT IDs from page ${pageCount + 1}: first=${cbtIds[0]}, last=${cbtIds[cbtIds.length - 1]}`);
            }
            
            if (cbtIds.length === 0) {
// console.log(`[SYNC CBTS] ⚠️ No CBT IDs found in this page`);
              hasMore = false;
              break;
            }

// console.log(`[SYNC CBTS] 💾 Saving ${cbtIds.length} CBTs to database...`);

            // Get count before save
            const countBefore = await itemRepo.getCBTsCount(globalSeller.id);
// console.log(`[SYNC CBTS] 📊 CBTs in database before save: ${countBefore.toLocaleString()}`);

            // Save CBTs directly (just the ID for now)
            const now = Math.floor(Date.now() / 1000);
            const itemsToSave = cbtIds.map(cbtId => ({
              id: '', // Will be generated by bulkUpsert
              global_seller_id: globalSeller.id,
              ml_item_id: cbtId,
              site_id: null,
              title: null,
              price: null,
              currency_id: null,
              available_quantity: 0,
              sold_quantity: 0,
              status: 'active' as const,
              listing_type_id: null,
              condition: null,
              permalink: null,
              thumbnail: null,
              category_id: null,
              start_time: null,
              stop_time: null,
              end_time: null,
              synced_at: now,
              metadata: { id: cbtId } as any, // Will be stringified by bulkUpsert
            }));

// console.log(`[SYNC CBTS] 💾 About to save ${itemsToSave.length} CBTs to database...`);
            await itemRepo.bulkUpsert(itemsToSave as any);
            totalSaved += itemsToSave.length;

          // Verify actual count in database after save
          const actualCount = await itemRepo.getCBTsCount(globalSeller.id);
          const newItems = actualCount - countBefore;
// console.log(`[SYNC CBTS] ✅ Saved ${itemsToSave.length} CBTs (total saved in this sync: ${totalSaved.toLocaleString()}${maxItems ? ` / ${maxItems.toLocaleString()}` : ''})`);
// console.log(`[SYNC CBTS] 📊 Actual CBTs in database now: ${actualCount.toLocaleString()} (${newItems > 0 ? `+${newItems} new` : 'no new items - all were duplicates/updates'})`);

            // Track consecutive duplicate pages
            if (newItems === 0) {
              consecutiveDuplicatePages++;
              if (consecutiveDuplicatePages >= MAX_CONSECUTIVE_DUPLICATES) {
// console.log(`[SYNC CBTS] ⚠️⚠️⚠️ ${consecutiveDuplicatePages} consecutive pages with all duplicates - likely reached end of new items`);
// console.log(`[SYNC CBTS] 📊 Continuing to check for new items, but this may indicate we've processed all available CBTs`);
// console.log(`[SYNC CBTS] ✅ Backend is still running and processing pages correctly - all items are duplicates`);
                logger.warn(`[SYNC CBTS] ${consecutiveDuplicatePages} consecutive pages with all duplicates - sync continues but no new items found`);
                // Don't stop - continue to see if we find new items later
              } else if (consecutiveDuplicatePages % 10 === 0) {
// console.log(`[SYNC CBTS] ⚠️ ${consecutiveDuplicatePages} consecutive pages with all duplicates (still processing...)`);
// console.log(`[SYNC CBTS] ✅ Backend is still running - continuing to check for new items`);
              }
            } else {
              if (consecutiveDuplicatePages > 0) {
// console.log(`[SYNC CBTS] ✅ Found ${newItems} new items after ${consecutiveDuplicatePages} duplicate pages - continuing sync`);
              }
              consecutiveDuplicatePages = 0; // Reset counter when we find new items
            }

          // Check if we've reached the maxItems limit
          if (maxItems && totalSaved >= maxItems) {
// console.log(`[SYNC CBTS] ⏹️ Reached maxItems limit: ${totalSaved} >= ${maxItems}`);
            hasMore = false;
            break;
          }

            // Log progress every 100 pages or every 10,000 CBTs
            if (pageCount % 100 === 0 || totalSaved % 10000 === 0) {
              logger.info(`[SYNC CBTS] Progress: ${totalSaved.toLocaleString()} CBTs saved from ${pageCount} pages`);
// console.log(`[SYNC CBTS] 📊 Progress: ${totalSaved.toLocaleString()} CBTs saved from ${pageCount} pages`);
            }

            // Check if we should continue
            // According to ML API docs: use the SAME scroll_id for all calls until you get null
            // Continue if we have results (even if scroll_id in response is null, we keep using our stored one)
            if (!searchResult.results || searchResult.results.length === 0) {
              hasMore = false;
// console.log(`[SYNC CBTS] 📄 Reached end of results (no more items returned)`);
            } else if (!scrollId) {
              // This shouldn't happen if we got results, but just in case
              hasMore = false;
// console.log(`[SYNC CBTS] 📄 Reached end of results (no scroll_id available)`);
            } else {
              hasMore = true;
// console.log(`[SYNC CBTS] ➡️ Continuing to next page (using same scroll_id: ${scrollId.substring(0, 20)}...)`);
            }

            pageCount++;

            // Stop if we've saved enough
            if (maxItems && totalSaved >= maxItems) {
// console.log(`[SYNC CBTS] ⏹️ Reached maxItems limit: ${totalSaved}`);
              hasMore = false;
              break;
            }

            // Small delay between pages to avoid overwhelming the API
// console.log(`[SYNC CBTS] ⏳ Waiting 500ms before next page... (current: ${totalSaved}/${maxItems ? maxItems : 'N/A'})`);
            await new Promise(resolve => setTimeout(resolve, 500));
// console.log(`[SYNC CBTS] ➡️ Continuing to next iteration of while loop...`);

          } catch (error) {
            fetchErrorCount++;
            logger.error(`[SYNC CBTS] ✗ Error on page ${pageCount + 1}:`, error);
            console.error(`[SYNC CBTS] ❌ Error on page ${pageCount + 1}:`, error);
            console.error(`[SYNC CBTS] ❌ Error details:`, error instanceof Error ? error.message : String(error));
            console.error(`[SYNC CBTS] ❌ Error stack:`, error instanceof Error ? error.stack : 'No stack');
            
            // Check if it's a scroll_id expiration error (400 with scroll_id message)
            // ML API returns 400 with message about scroll_id when it expires
            const errorMsg = error instanceof Error ? error.message : String(error);
            const isScrollIdError = errorMsg.includes('400') && 
                                   (errorMsg.includes('scroll_id') || 
                                    errorMsg.includes('scroll') ||
                                    (errorMsg.includes('invalid') && errorMsg.includes('id')));
            
            // Check if it's a token expiration error (401)
            // ML API returns: { "code": "unauthorized", "message": "invalid access token" } with status 401
            const isTokenError = !isScrollIdError && (
                                 errorMsg.includes('401') || 
                                 errorMsg.includes('Unauthorized') || 
                                 errorMsg.includes('unauthorized') ||
                                 errorMsg.includes('invalid access token'));
            
            // Handle scroll_id expiration: renew and continue
            // IMPORTANT: When ML returns error 400 for scroll_id, we must make a NEW INITIAL REQUEST (without scroll_id)
            // However, we'll filter duplicates using the database to continue from where we left off
            if (isScrollIdError) {
              console.warn(`[SYNC CBTS] ⏱️⏱️⏱️ SCROLL_ID EXPIRED (NOT TOKEN ERROR) ⏱️⏱️⏱️`);
              console.warn(`[SYNC CBTS] 📋 Error: ${errorMsg}`);
              console.warn(`[SYNC CBTS] 🔄 ML rejected scroll_id - making NEW INITIAL REQUEST to get fresh scroll_id...`);
              console.warn(`[SYNC CBTS] ⚠️ Note: New request will start from beginning, but duplicates will be filtered by database`);
              logger.warn(`[SYNC CBTS] Scroll ID expired (error 400) - making new initial request to get fresh scroll_id (page ${pageCount + 1})`);
              
              // Reset scroll_id to null - next call will be WITHOUT scroll_id (new initial request)
              // This will get us a fresh scroll_id from Mercado Libre
              // The database will filter duplicates, so we continue from where we left off
              scrollId = null;
              scrollIdStartTime = null;
              
              // Reset error count since this is expected behavior (scroll_id expires every 5 minutes)
              fetchErrorCount = 0;
              
              // Small delay before retrying with new initial request
              await new Promise(resolve => setTimeout(resolve, 1000));
              
              // Continue to next iteration (will make NEW INITIAL REQUEST without scroll_id)
              // Database will handle duplicates, so we effectively continue from where we left off
// console.log(`[SYNC CBTS] ➡️ Continuing sync - next call will be NEW INITIAL REQUEST (duplicates will be filtered)...`);
              continue;
            }
            
            // Handle token expiration: pause and notify user
            if (isTokenError) {
              console.error(`[SYNC CBTS] 🔑🔑🔑 TOKEN EXPIRED OR INVALID (NOT SCROLL_ID) 🔑🔑🔑`);
              console.error(`[SYNC CBTS] 📋 Error: ${errorMsg}`);
              console.error(`[SYNC CBTS] ⏸️ Pausing sync - token needs to be refreshed by user`);
              logger.error(`[SYNC CBTS] Token expired - pausing sync (page ${pageCount + 1}, total saved: ${totalSaved})`);
              
              // IMPORTANT: Ensure all processed CBTs are saved before pausing
              try {
// console.log(`[SYNC CBTS] 💾 Verifying all processed CBTs are saved before pausing...`);
                const finalCount = await itemRepo.getCBTsCount(globalSeller.id);
// console.log(`[SYNC CBTS] ✅ Final verification: ${finalCount.toLocaleString()} CBTs saved in database`);
// console.log(`[SYNC CBTS] 📊 Total processed in this sync: ${totalSaved.toLocaleString()} CBTs`);
                
                if (finalCount < totalSaved) {
                  console.warn(`[SYNC CBTS] ⚠️ Warning: Database count (${finalCount}) is less than processed count (${totalSaved})`);
                  console.warn(`[SYNC CBTS] ⚠️ This might indicate some CBTs weren't saved. However, duplicates are handled by ON CONFLICT.`);
                } else {
// console.log(`[SYNC CBTS] ✅ All processed CBTs are safely saved in database`);
                }
              } catch (verifyError) {
                console.error(`[SYNC CBTS] ❌ Error verifying final count:`, verifyError);
                // Continue anyway - the CBTs should already be saved from previous pages
              }
              
              // Save sync state to database for resumption
              try {
                const syncState = {
                  paused: true,
                  reason: 'token_expired',
                  pageCount,
                  totalSaved,
                  finalDbCount: await itemRepo.getCBTsCount(globalSeller.id),
                  scrollId: scrollId || null,
                  scrollIdStartTime: scrollIdStartTime || null,
                  pausedAt: Date.now(),
                };
                
                // Store sync state in a metadata field or create a sync_state column
                // For now, we'll use a simple approach: store in a JSON field if available
                // Or we can create a separate sync_state table
                // For simplicity, let's log it and return an error response that the frontend can handle
// console.log(`[SYNC CBTS] 💾 Sync state to resume:`, JSON.stringify(syncState));
// console.log(`[SYNC CBTS] 💾 Final database count before pause: ${syncState.finalDbCount.toLocaleString()} CBTs`);
                
                // Update global seller with sync state (we'll need to add a field for this)
                // For now, we'll throw a special error that the frontend can catch
                throw new Error('TOKEN_EXPIRED:SYNC_PAUSED:' + JSON.stringify(syncState));
              } catch (stateError) {
                console.error(`[SYNC CBTS] ❌ Error saving sync state:`, stateError);
              }
              
              hasMore = false;
              break;
            }
            
            // Stop after too many errors
            if (fetchErrorCount >= MAX_ERRORS) {
              console.error(`[SYNC CBTS] ❌ Stopped after ${MAX_ERRORS} consecutive errors`);
              
              // IMPORTANT: Ensure all processed CBTs are saved before stopping
              try {
// console.log(`[SYNC CBTS] 💾 Verifying all processed CBTs are saved before stopping...`);
                const finalCount = await itemRepo.getCBTsCount(globalSeller.id);
// console.log(`[SYNC CBTS] ✅ Final verification: ${finalCount.toLocaleString()} CBTs saved in database`);
// console.log(`[SYNC CBTS] 📊 Total processed in this sync: ${totalSaved.toLocaleString()} CBTs`);
                
                if (finalCount < totalSaved) {
                  console.warn(`[SYNC CBTS] ⚠️ Warning: Database count (${finalCount}) is less than processed count (${totalSaved})`);
                  console.warn(`[SYNC CBTS] ⚠️ This might indicate some CBTs weren't saved. However, duplicates are handled by ON CONFLICT.`);
                } else {
// console.log(`[SYNC CBTS] ✅ All processed CBTs are safely saved in database`);
                }
              } catch (verifyError) {
                console.error(`[SYNC CBTS] ❌ Error verifying final count:`, verifyError);
                // Continue anyway - the CBTs should already be saved from previous pages
              }
              
              hasMore = false;
              break;
            }
            
            // Small delay before retry
// console.log(`[SYNC CBTS] ⏳ Waiting 2s before retry...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }

          const duration = ((Date.now() - startTime) / 1000).toFixed(2);
          
          // Final verification that everything is saved
          try {
            const finalCount = await itemRepo.getCBTsCount(globalSeller.id);
// console.log(`[SYNC CBTS] 💾 Final verification: ${finalCount.toLocaleString()} CBTs saved in database`);
// console.log(`[SYNC CBTS] 📊 Total processed in this sync: ${totalSaved.toLocaleString()} CBTs`);
            
            logger.info(`[SYNC CBTS] Sync complete: ${totalSaved} CBTs processed, ${finalCount.toLocaleString()} CBTs in database, ${duration}s`);
// console.log(`[SYNC CBTS] ✅✅✅ SYNC COMPLETE ✅✅✅`);
// console.log(`[SYNC CBTS] 📊 Final stats:`);
// console.log(`[SYNC CBTS]    - Pages processed: ${pageCount}`);
// console.log(`[SYNC CBTS]    - CBTs processed: ${totalSaved.toLocaleString()}`);
// console.log(`[SYNC CBTS]    - CBTs in database: ${finalCount.toLocaleString()}`);
// console.log(`[SYNC CBTS]    - Duration: ${duration}s`);
            
            if (finalCount < totalSaved) {
// console.log(`[SYNC CBTS] ℹ️ Note: Database count may be less than processed count due to duplicates (normal behavior)`);
            }
          } catch (verifyError) {
            console.error(`[SYNC CBTS] ❌ Error in final verification:`, verifyError);
            logger.info(`[SYNC CBTS] Sync complete: ${totalSaved} CBTs saved in ${duration}s`);
// console.log(`[SYNC CBTS] ✅✅✅ SYNC COMPLETE: ${totalSaved} CBTs saved in ${duration}s ✅✅✅`);
// console.log(`[SYNC CBTS] 📊 Final stats: ${pageCount} pages processed, ${totalSaved} CBTs saved${maxItems ? ` (limit: ${maxItems})` : ''}`);
          }
        } catch (error) {
          logger.error('[SYNC CBTS] Error in background sync:', error);
          console.error('[SYNC CBTS] ❌❌❌ ERROR IN BACKGROUND SYNC:', error);
          console.error('[SYNC CBTS] ❌ Error message:', error instanceof Error ? error.message : String(error));
          console.error('[SYNC CBTS] ❌ Error stack:', error instanceof Error ? error.stack : 'No stack');
          console.error('[SYNC CBTS] ❌ Error occurred at page:', pageCount + 1, 'totalSaved:', totalSaved);
          
          // IMPORTANT: Final verification that all processed CBTs are saved
          try {
// console.log(`[SYNC CBTS] 💾 Final verification: Ensuring all processed CBTs are saved...`);
            const finalCount = await itemRepo.getCBTsCount(globalSeller.id);
// console.log(`[SYNC CBTS] ✅ Final database count: ${finalCount.toLocaleString()} CBTs`);
// console.log(`[SYNC CBTS] 📊 Total processed in this sync: ${totalSaved.toLocaleString()} CBTs`);
            
            if (finalCount < totalSaved) {
              console.warn(`[SYNC CBTS] ⚠️ Warning: Database count (${finalCount}) is less than processed count (${totalSaved})`);
              console.warn(`[SYNC CBTS] ⚠️ This might indicate some CBTs weren't saved. However, duplicates are handled by ON CONFLICT.`);
            } else {
// console.log(`[SYNC CBTS] ✅ All processed CBTs are safely saved in database before error`);
            }
          } catch (verifyError) {
            console.error(`[SYNC CBTS] ❌ Error in final verification:`, verifyError);
            // Continue anyway - the CBTs should already be saved from previous pages
          }
          
          // Check if it's a token expiration error
          const errorMsg = error instanceof Error ? error.message : String(error);
          if (errorMsg.startsWith('TOKEN_EXPIRED:SYNC_PAUSED:')) {
            // Extract sync state from error message
            const syncStateJson = errorMsg.replace('TOKEN_EXPIRED:SYNC_PAUSED:', '');
            try {
              const syncState = JSON.parse(syncStateJson);
              console.error(`[SYNC CBTS] 🔑 Token expired - sync paused at page ${syncState.pageCount}, total saved: ${syncState.totalSaved}`);
              console.error(`[SYNC CBTS] 💾 Final database count when paused: ${syncState.finalDbCount?.toLocaleString() || 'unknown'} CBTs`);
              // Store sync state in global seller for resumption
              // We'll need to add a method to store this, but for now we'll log it
              // The frontend will need to poll for sync status and detect token expiration
            } catch (parseError) {
              console.error(`[SYNC CBTS] ❌ Error parsing sync state:`, parseError);
            }
          }
        }
      })();
      
      backgroundSyncPromise.catch(err => {
        console.error(`[SYNC CBTS] ❌❌❌ Background sync promise rejected:`, err);
        logger.error(`[SYNC CBTS] Background sync promise rejected:`, err);
        
        // Check if it's a token expiration error
        const errorMsg = err instanceof Error ? err.message : String(err);
        if (errorMsg.startsWith('TOKEN_EXPIRED:SYNC_PAUSED:')) {
          console.error(`[SYNC CBTS] 🔑 Token expired - sync paused`);
          // The error will be logged but we can't directly communicate with frontend from here
          // The frontend will need to poll for sync status or detect via other means
        }
      });
    } else {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
// console.log(`[SYNC CBTS] ✅ Sync complete: ${totalSaved} CBTs saved in ${duration}s (all pages processed)`);
    }
    
// console.log(`[SYNC CBTS] ✅ Returning response with ${totalSaved} CBTs saved so far...`);

    // Return response with background promise attached for waitUntil
    const response = successResponse({
      message: 'CBT sync started in background',
      status: 'processing',
    });
    
    // Attach background promise to response for waitUntil
    (response as any).backgroundPromise = backgroundSyncPromise;
    
    return response;
  } catch (error) {
    console.error(`[SYNC CBTS HANDLER] ❌❌❌ ERROR CAUGHT:`, error);
    console.error(`[SYNC CBTS HANDLER] ❌ Error message:`, error instanceof Error ? error.message : String(error));
    console.error(`[SYNC CBTS HANDLER] ❌ Error stack:`, error instanceof Error ? error.stack : 'No stack');
    logger.error('[SYNC CBTS] Error:', error);
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return handleError(error);
  }
}

/**
 * GET /api/global-sellers/:id/cbts/debug
 * Debug endpoint to test CBT detection step by step
 */
export async function debugCBTsHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const globalSellerRepo = new GlobalSellerRepository(env.DB);
    const mlAPIService = new MercadoLibreAPIService();
    const globalSellerService = new GlobalSellerService(globalSellerRepo, mlAPIService);
    const itemsService = new MercadoLibreItemsService();

    const user = await requireAuth(request, env, authService);

    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const globalSellerId = pathParts[3]; // /api/global-sellers/:id/cbts/debug

    if (!globalSellerId) {
      return errorResponse('Global Seller ID is required', 400, 'MISSING_ID');
    }

    const globalSeller = await globalSellerService.getById(globalSellerId);

    if (!globalSeller) {
      return errorResponse('Global Seller not found', 404, 'NOT_FOUND');
    }

    if (globalSeller.user_id !== user.id) {
      return errorResponse('Access denied', 403, 'FORBIDDEN');
    }

    // Check if ML credentials are set (not empty)
    if (!globalSeller.ml_user_id || !globalSeller.ml_access_token || 
        globalSeller.ml_user_id.trim() === '' || globalSeller.ml_access_token.trim() === '') {
      return errorResponse('Mercado Libre credentials not configured', 400, 'ML_CREDENTIALS_MISSING');
    }

    const maxItemsParam = url.searchParams.get('maxItems');
    const maxItems = maxItemsParam && !isNaN(parseInt(maxItemsParam, 10))
      ? parseInt(maxItemsParam, 10)
      : 100; // Default to 100 for quick test

    logger.info(`[DEBUG CBTS] Starting debug for Global Seller ${globalSellerId}, maxItems: ${maxItems}`);

    const debugInfo: any = {
      globalSellerId,
      mlUserId: globalSeller.ml_user_id,
      maxItems,
      steps: [],
    };

    try {
      // Step 1: Get first batch of items using scan mode
      logger.info(`[DEBUG CBTS] Step 1: Getting first batch of items...`);
      const step1Result = await itemsService.searchItemsWithScan(
        globalSeller.ml_user_id,
        globalSeller.ml_access_token,
        {
          limit: 100,
        }
      );

      debugInfo.steps.push({
        step: 1,
        name: 'Get first batch with scan mode',
        result: {
          itemsReceived: step1Result.results?.length || 0,
          scrollId: step1Result.scroll_id ? `${step1Result.scroll_id.substring(0, 20)}...` : null,
          totalEstimated: step1Result.paging?.total || null,
        },
      });

      if (!step1Result.results || step1Result.results.length === 0) {
        return successResponse({
          message: 'No items found in first batch',
          debug: debugInfo,
        });
      }

      // Step 2: Get details for first 20 items
      logger.info(`[DEBUG CBTS] Step 2: Getting details for first 20 items...`);
      const first20Items = step1Result.results.slice(0, 20);
      const itemsDetails = await itemsService.getItemsBulk(first20Items, globalSeller.ml_access_token);

      const itemsWithDetails: any[] = [];
      let cbtCount = 0;
      const cbtItems: any[] = [];

      for (const result of itemsDetails) {
        if (result.code === 200 && result.body && 'id' in result.body) {
          const item = result.body as unknown as MLItem;
          const isCBT = item.site_id && item.site_id.startsWith('CBT');
          
          itemsWithDetails.push({
            id: item.id,
            site_id: item.site_id,
            title: item.title?.substring(0, 50),
            isCBT,
          });

          if (isCBT) {
            cbtCount++;
            cbtItems.push({
              id: item.id,
              site_id: item.site_id,
              title: item.title,
            });
          }
        }
      }

      debugInfo.steps.push({
        step: 2,
        name: 'Get details for first 20 items',
        result: {
          itemsProcessed: itemsWithDetails.length,
          cbtCount,
          cbtItems: cbtItems.slice(0, 5), // Show first 5 CBTs
          sampleItems: itemsWithDetails.slice(0, 10), // Show first 10 items
        },
      });

      // Step 3: Process more items up to maxItems
      logger.info(`[DEBUG CBTS] Step 3: Processing up to ${maxItems} items...`);
      let totalProcessed = itemsWithDetails.length;
      let totalCBTs = cbtCount;
      let scrollId: string | undefined = step1Result.scroll_id || undefined;
      let pageCount = 1;

      while (totalProcessed < maxItems && scrollId) {
        pageCount++;
        const nextResult = await itemsService.searchItemsWithScan(
          globalSeller.ml_user_id,
          globalSeller.ml_access_token,
          {
            limit: 100,
            scroll_id: scrollId,
          }
        );

        if (!nextResult.results || nextResult.results.length === 0) {
          break;
        }

        // Process in batches of 20
        for (let i = 0; i < nextResult.results.length && totalProcessed < maxItems; i += 20) {
          const batch = nextResult.results.slice(i, i + 20);
          const batchDetails = await itemsService.getItemsBulk(batch, globalSeller.ml_access_token);

          for (const result of batchDetails) {
            if (result.code === 200 && result.body && 'id' in result.body) {
              const item = result.body as unknown as MLItem;
              totalProcessed++;

              if (item.site_id && item.site_id.startsWith('CBT')) {
                totalCBTs++;
              }
            }
          }
        }

        scrollId = nextResult.scroll_id ? nextResult.scroll_id : undefined;
      }

      debugInfo.steps.push({
        step: 3,
        name: `Process up to ${maxItems} items`,
        result: {
          totalProcessed,
          totalCBTs,
          pagesProcessed: pageCount,
        },
      });

      return successResponse({
        message: 'Debug completed successfully',
        debug: debugInfo,
        summary: {
          totalItemsProcessed: totalProcessed,
          totalCBTsFound: totalCBTs,
          cbtPercentage: totalProcessed > 0 ? ((totalCBTs / totalProcessed) * 100).toFixed(2) : '0',
        },
      });
    } catch (error) {
      logger.error('[DEBUG CBTS] Error:', error);
      debugInfo.error = error instanceof Error ? error.message : String(error);
      return successResponse({
        message: 'Debug completed with errors',
        debug: debugInfo,
      });
    }
  } catch (error) {
    logger.error('[DEBUG CBTS] Error:', error);
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return handleError(error);
  }
}

/**
 * GET /api/global-sellers/:id/cbts
 * Get all CBTs (Cross Border Trade items) for a Global Seller
 * Uses scan mode to efficiently find all CBTs
 */
export async function getCBTsHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const globalSellerRepo = new GlobalSellerRepository(env.DB);
    const mlAPIService = new MercadoLibreAPIService();
    const globalSellerService = new GlobalSellerService(globalSellerRepo, mlAPIService);
    const itemsService = new MercadoLibreItemsService();

    const user = await requireAuth(request, env, authService);

    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const globalSellerId = pathParts[3]; // /api/global-sellers/:id/cbts

    if (!globalSellerId) {
      return errorResponse('Global Seller ID is required', 400, 'MISSING_ID');
    }

    const globalSeller = await globalSellerService.getById(globalSellerId);

    if (!globalSeller) {
      return errorResponse('Global Seller not found', 404, 'NOT_FOUND');
    }

    if (globalSeller.user_id !== user.id) {
      return errorResponse('Access denied', 403, 'FORBIDDEN');
    }

    // Get query parameters
    const statusParam = url.searchParams.get('status');
    const status: ItemStatus = (statusParam && VALID_ITEM_STATUSES.includes(statusParam as ItemStatus))
      ? (statusParam as ItemStatus)
      : 'active';

    const maxCBTsParam = url.searchParams.get('max');
    const maxCBTs = maxCBTsParam && !isNaN(parseInt(maxCBTsParam, 10))
      ? parseInt(maxCBTsParam, 10)
      : undefined;

    logger.info(`[GET CBTS] Fetching CBTs for Global Seller ${globalSellerId}, status: ${status}${maxCBTs ? `, max: ${maxCBTs}` : ''}`);

    // Get all CBTs using the optimized method
    const result = await itemsService.getAllCBTs(
      globalSeller.ml_user_id,
      globalSeller.ml_access_token,
      {
        status,
        maxCBTs,
        onProgress: (processed, found, totalEstimated) => {
// logger.debug(`[GET CBTS] Progress: ${processed} processed, ${found} CBTs found${totalEstimated ? ` / ${totalEstimated} total` : ''}`);
        },
      }
    );

    logger.info(`[GET CBTS] Found ${result.cbts.length} CBTs from ${result.totalProcessed} items processed`);

    return successResponse({
      cbts: result.cbts,
      total: result.cbts.length,
      totalProcessed: result.totalProcessed,
      totalEstimated: result.totalEstimated,
    });
  } catch (error) {
    logger.error('[GET CBTS] Error:', error);
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return handleError(error);
  }
}

/**
 * GET /api/global-sellers/:id/cbts/fetch
 * Fetch CBTs from ML API using scan mode
 */
export async function fetchCBTsHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const globalSellerRepo = new GlobalSellerRepository(env.DB);
    const mlAPIService = new MercadoLibreAPIService();
    const globalSellerService = new GlobalSellerService(globalSellerRepo, mlAPIService);
    const itemsService = new MercadoLibreItemsService();

    const user = await requireAuth(request, env, authService);

    const url = new URL(request.url);
    const id = url.pathname.split('/')[3]; // /api/global-sellers/:id/cbts/fetch
    const scrollId = url.searchParams.get('scroll_id');

    if (!id) {
      return errorResponse('Global Seller ID is required', 400, 'MISSING_ID');
    }

    const globalSeller = await globalSellerService.getById(id);

    if (!globalSeller) {
      return errorResponse('Global Seller not found', 404, 'NOT_FOUND');
    }

    if (globalSeller.user_id !== user.id) {
      return errorResponse('Access denied', 403, 'FORBIDDEN');
    }

    // Check if ML credentials are set
    if (!globalSeller.ml_user_id || !globalSeller.ml_access_token || 
        globalSeller.ml_user_id.trim() === '' || globalSeller.ml_access_token.trim() === '') {
      return errorResponse('Mercado Libre credentials not configured', 400, 'ML_CREDENTIALS_MISSING');
    }

    // Get status parameter
    const statusParam = url.searchParams.get('status');
    const status: ItemStatus = (statusParam && VALID_ITEM_STATUSES.includes(statusParam as ItemStatus))
      ? (statusParam as ItemStatus)
      : 'active';

    logger.info(`[FETCH CBTS] Fetching CBTs from ML API for Global Seller ${id}, scroll_id: ${scrollId || 'none'}`);
// console.log(`[FETCH CBTS] 🔍 Fetching CBTs from ML API...`);

    // Fetch from ML API using scan mode
    const searchResult = await itemsService.searchItemsWithScan(
      globalSeller.ml_user_id,
      globalSeller.ml_access_token,
      {
        limit: 100,
        scroll_id: scrollId || undefined,
      }
    );

// console.log(`[FETCH CBTS] ✅ Received ${searchResult.results?.length || 0} item IDs`);

    // Filter to only CBTs (IDs starting with "CBT")
    const cbtIds = (searchResult.results || []).filter(id => id && id.startsWith('CBT'));

    logger.info(`[FETCH CBTS] Found ${cbtIds.length} CBTs from ${searchResult.results?.length || 0} items`);
// console.log(`[FETCH CBTS] 📦 Found ${cbtIds.length} CBTs`);

    return successResponse({
      cbts: cbtIds,
      scroll_id: searchResult.scroll_id || null,
      paging: searchResult.paging,
      hasMore: searchResult.scroll_id !== null && searchResult.scroll_id !== undefined,
    });
  } catch (error) {
    logger.error('[FETCH CBTS] Error:', error);
    console.error('[FETCH CBTS] ❌ Error:', error);
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return handleError(error);
  }
}

/**
 * POST /api/global-sellers/:id/cbts/save
 * Save CBTs to database
 */
export async function saveCBTsHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const globalSellerRepo = new GlobalSellerRepository(env.DB);
    const mlAPIService = new MercadoLibreAPIService();
    const globalSellerService = new GlobalSellerService(globalSellerRepo, mlAPIService);
    const itemRepo = new ItemRepository(env.DB);

    const user = await requireAuth(request, env, authService);

    const url = new URL(request.url);
    const id = url.pathname.split('/')[3]; // /api/global-sellers/:id/cbts/save

    if (!id) {
      return errorResponse('Global Seller ID is required', 400, 'MISSING_ID');
    }

    const globalSeller = await globalSellerService.getById(id);

    if (!globalSeller) {
      return errorResponse('Global Seller not found', 404, 'NOT_FOUND');
    }

    if (globalSeller.user_id !== user.id) {
      return errorResponse('Access denied', 403, 'FORBIDDEN');
    }

    // Get CBTs from request body
    const body = await request.json() as { cbts: string[] };
    
    if (!body.cbts || !Array.isArray(body.cbts) || body.cbts.length === 0) {
      return errorResponse('CBTs array is required', 400, 'MISSING_CBTS');
    }

    logger.info(`[SAVE CBTS] Saving ${body.cbts.length} CBTs for Global Seller ${id}`);
// console.log(`[SAVE CBTS] 💾 Saving ${body.cbts.length} CBTs...`);

    // Convert CBT IDs to Item format
    const now = Math.floor(Date.now() / 1000);
    const itemsToSave = body.cbts.map(cbtId => ({
      id: '', // Will be generated by bulkUpsert
      global_seller_id: globalSeller.id,
      ml_item_id: cbtId,
      site_id: null,
      title: null,
      price: null,
      currency_id: null,
      available_quantity: 0,
      sold_quantity: 0,
      status: 'active' as const,
      listing_type_id: null,
      condition: null,
      permalink: null,
      thumbnail: null,
      category_id: null,
      start_time: null,
      stop_time: null,
      end_time: null,
      synced_at: now,
      metadata: { id: cbtId } as any,
    }));

    // Save in batches
    const batchSize = 100;
    let totalSaved = 0;

    for (let i = 0; i < itemsToSave.length; i += batchSize) {
      const batch = itemsToSave.slice(i, i + batchSize);
      try {
        await itemRepo.bulkUpsert(batch as any);
        totalSaved += batch.length;
// console.log(`[SAVE CBTS] ✅ Saved batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(itemsToSave.length / batchSize)} (${batch.length} items)`);
      } catch (error) {
        logger.error(`[SAVE CBTS] Error saving batch:`, error);
        console.error(`[SAVE CBTS] ❌ Error saving batch:`, error);
        throw error;
      }
    }

    logger.info(`[SAVE CBTS] Successfully saved ${totalSaved} CBTs`);
// console.log(`[SAVE CBTS] ✅ Successfully saved ${totalSaved} CBTs`);

    return successResponse({
      message: `${totalSaved} CBTs saved successfully`,
      saved: totalSaved,
      total: body.cbts.length,
    });
  } catch (error) {
    logger.error('[SAVE CBTS] Error:', error);
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return handleError(error);
  }
}

/**
 * GET /api/global-sellers/:id/cbts/count
 * Get count of saved CBTs in database
 */
export async function getCBTsCountHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const globalSellerRepo = new GlobalSellerRepository(env.DB);
    const mlAPIService = new MercadoLibreAPIService();
    const globalSellerService = new GlobalSellerService(globalSellerRepo, mlAPIService);
    const itemRepo = new ItemRepository(env.DB);

    const user = await requireAuth(request, env, authService);

    const url = new URL(request.url);
    const id = url.pathname.split('/')[3]; // /api/global-sellers/:id/cbts/count

    if (!id) {
      return errorResponse('Global Seller ID is required', 400, 'MISSING_ID');
    }

    const globalSeller = await globalSellerService.getById(id);

    if (!globalSeller) {
      return errorResponse('Global Seller not found', 404, 'NOT_FOUND');
    }

    if (globalSeller.user_id !== user.id) {
      return errorResponse('Access denied', 403, 'FORBIDDEN');
    }

    const totalCBTs = await itemRepo.getCBTsCount(globalSeller.id);
// console.log(`[GET CBTS COUNT] 📊 Total CBTs in database: ${totalCBTs.toLocaleString()}`);
    logger.info(`[GET CBTS COUNT] Total CBTs for Global Seller ${id}: ${totalCBTs}`);

    return successResponse({
      count: totalCBTs,
      total: totalCBTs,
    });
  } catch (error) {
    logger.error('[GET CBTS COUNT] Error:', error);
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return handleError(error);
  }
}

/**
 * POST /api/global-sellers/:id/cbts/:cbtId/sync
 * Sync individual CBT details from Mercado Libre API
 */
export async function syncIndividualCBTHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const globalSellerRepo = new GlobalSellerRepository(env.DB);
    const mlAPIService = new MercadoLibreAPIService();
    const globalSellerService = new GlobalSellerService(globalSellerRepo, mlAPIService);
    const itemRepo = new ItemRepository(env.DB);
    const itemsService = new MercadoLibreItemsService();

    const user = await requireAuth(request, env, authService);

    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const globalSellerId = pathParts[3]; // /api/global-sellers/:id/cbts/:cbtId/sync
    const cbtId = pathParts[5]; // cbtId from path

    if (!globalSellerId || !cbtId) {
      return errorResponse('Global Seller ID and CBT ID are required', 400, 'MISSING_ID');
    }

    const globalSeller = await globalSellerService.getById(globalSellerId);

    if (!globalSeller) {
      return errorResponse('Global Seller not found', 404, 'NOT_FOUND');
    }

    if (globalSeller.user_id !== user.id) {
      return errorResponse('Access denied', 403, 'FORBIDDEN');
    }

    if (!globalSeller.ml_access_token) {
      return errorResponse('Mercado Libre access token is required', 400, 'MISSING_TOKEN');
    }

    logger.info(`[SYNC INDIVIDUAL CBT] Syncing CBT ${cbtId} for Global Seller ${globalSellerId}`);

    try {
      // Get marketplace item details from ML API
      const mlData = await itemsService.getMarketplaceItemDetails(
        cbtId,
        globalSeller.ml_access_token
      );

      // Extract image from pictures array (first picture)
      const imageUrl = mlData.pictures && mlData.pictures.length > 0
        ? mlData.pictures[0].secure_url
        : null;

      // Update item in database
      const now = Math.floor(Date.now() / 1000);
      // Map ML status to our status type
      const mlStatus = mlData.status || 'active';
      const itemStatus = (mlStatus === 'active' || mlStatus === 'paused' || mlStatus === 'closed') 
        ? mlStatus as 'active' | 'paused' | 'closed'
        : 'active' as const;
      
      // Get existing item to preserve metadata
      const existingItem = await itemRepo.findByMlItemId(globalSeller.id, cbtId);
      let existingMetadata = {};
      if (existingItem?.metadata) {
        try {
          existingMetadata = JSON.parse(existingItem.metadata);
        } catch (e) {
          // If metadata is not valid JSON, start fresh
          existingMetadata = {};
        }
      }
      
      const itemToUpdate = {
        id: '', // Will be found by ml_item_id
        global_seller_id: globalSeller.id,
        ml_item_id: cbtId,
        site_id: null,
        title: mlData.title || null,
        price: mlData.price || null,
        currency_id: null,
        available_quantity: 0,
        sold_quantity: mlData.sold_quantity || 0,
        status: itemStatus,
        listing_type_id: mlData.listing_type_id || null,
        condition: null,
        permalink: null,
        thumbnail: imageUrl,
        category_id: mlData.category_id || null,
        start_time: null,
        stop_time: null,
        end_time: null,
        synced_at: now,
        metadata: {
          ...existingMetadata,
          ...mlData,
          sync_log: 'OK', // Mark as successfully synced
        } as any,
      };

      await itemRepo.upsert(itemToUpdate);

      logger.info(`[SYNC INDIVIDUAL CBT] Successfully synced CBT ${cbtId}`);

      return successResponse({
        cbtId,
        title: mlData.title,
        price: mlData.price,
        category_id: mlData.category_id,
        sold_quantity: mlData.sold_quantity,
        listing_type_id: mlData.listing_type_id,
        status: mlData.status,
        sub_status: mlData.sub_status || [],
        image: imageUrl,
        synced: true,
      });
    } catch (error) {
      logger.error(`[SYNC INDIVIDUAL CBT] Error syncing CBT ${cbtId}:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Save error in metadata
      try {
        const existingItem = await itemRepo.findByMlItemId(globalSeller.id, cbtId);
        let existingMetadata = {};
        if (existingItem?.metadata) {
          try {
            existingMetadata = JSON.parse(existingItem.metadata);
          } catch (e) {
            existingMetadata = {};
          }
        }
        
        const itemToUpdate = {
          id: existingItem?.id || '',
          global_seller_id: globalSeller.id,
          ml_item_id: cbtId,
          site_id: existingItem?.site_id || null,
          title: existingItem?.title || null,
          price: existingItem?.price || null,
          currency_id: existingItem?.currency_id || null,
          available_quantity: existingItem?.available_quantity || 0,
          sold_quantity: existingItem?.sold_quantity || 0,
          status: existingItem?.status || 'active',
          listing_type_id: existingItem?.listing_type_id || null,
          condition: existingItem?.condition || null,
          permalink: existingItem?.permalink || null,
          thumbnail: existingItem?.thumbnail || null,
          category_id: existingItem?.category_id || null,
          start_time: existingItem?.start_time || null,
          stop_time: existingItem?.stop_time || null,
          end_time: existingItem?.end_time || null,
          synced_at: existingItem?.synced_at || null,
          metadata: {
            ...existingMetadata,
            sync_log: errorMessage, // Save error message
          } as any,
        };
        
        await itemRepo.upsert(itemToUpdate);
      } catch (updateError) {
        logger.error(`[SYNC INDIVIDUAL CBT] Failed to update error log for CBT ${cbtId}:`, updateError);
      }
      
      // Check if it's a token error
      if (errorMessage.includes('401') || errorMessage.includes('unauthorized') || errorMessage.includes('invalid access token')) {
        return errorResponse('Mercado Libre access token expired or invalid', 401, 'TOKEN_EXPIRED');
      }
      
      return errorResponse(`Error syncing CBT: ${errorMessage}`, 500, 'SYNC_ERROR');
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return handleError(error);
  }
}

/**
 * POST /api/global-sellers/:id/cbts/sync-all
 * Sync all CBTs individually to get their details from Mercado Libre API
 * Processes one by one with rate limiting and error handling
 */
export async function syncAllCBTsHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const globalSellerRepo = new GlobalSellerRepository(env.DB);
    const mlAPIService = new MercadoLibreAPIService();
    const globalSellerService = new GlobalSellerService(globalSellerRepo, mlAPIService);
    const itemRepo = new ItemRepository(env.DB);
    const itemsService = new MercadoLibreItemsService();

    const user = await requireAuth(request, env, authService);

    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const globalSellerId = pathParts[3]; // /api/global-sellers/:id/cbts/sync-all

    if (!globalSellerId) {
      return errorResponse('Global Seller ID is required', 400, 'MISSING_ID');
    }

    const globalSeller = await globalSellerService.getById(globalSellerId);

    if (!globalSeller) {
      return errorResponse('Global Seller not found', 404, 'NOT_FOUND');
    }

    if (globalSeller.user_id !== user.id) {
      return errorResponse('Access denied', 403, 'FORBIDDEN');
    }

    if (!globalSeller.ml_access_token) {
      return errorResponse('Mercado Libre access token is required', 400, 'MISSING_TOKEN');
    }

    logger.info(`[SYNC ALL CBTS] Starting sync for all CBTs for Global Seller ${globalSellerId}`);

    // Get all CBTs from database
    const allCBTs = await itemRepo.findCBTsByGlobalSellerId(globalSeller.id, {
      limit: 100000, // Get all CBTs
      offset: 0,
      orderBy: 'synced_at',
      orderDir: 'DESC',
    });

    const totalCBTs = allCBTs.items.length;
    logger.info(`[SYNC ALL CBTS] Found ${totalCBTs} CBTs to sync`);

    // Initialize or get existing state
    const existingState = syncAllState.get(globalSeller.id);
    let startBatchIndex = 0;
    if (existingState && !existingState.stopped) {
      // Resume from where we left off
      startBatchIndex = existingState.currentBatchIndex;
      logger.info(`[SYNC ALL CBTS] Resuming from batch ${startBatchIndex + 1}`);
    } else {
      // Start fresh
      syncAllState.set(globalSeller.id, { paused: false, stopped: false, currentBatchIndex: 0 });
    }

    // Start background sync
    const backgroundSyncPromise = (async () => {
      const startTime = Date.now();
      let syncedCount = 0;
      let failedCount = 0;
      let rateLimitCount = 0;
      let tokenExpired = false;
      const errors: Array<{ cbtId: string; error: string }> = [];
      const RATE_LIMIT_DELAY = 200; // 200ms delay between requests to avoid rate limits
      const MAX_RATE_LIMIT_RETRIES = 5; // Max retries for rate limit errors

// console.log(`[SYNC ALL CBTS] 🚀 Starting background sync for ${totalCBTs} CBTs using Multiget (bulk)...`);

      // Process in batches of 20 (ML Multiget limit)
      const BATCH_SIZE = 20;
      const batches: string[][] = [];
      
      for (let i = 0; i < allCBTs.items.length; i += BATCH_SIZE) {
        const batch = allCBTs.items.slice(i, i + BATCH_SIZE).map(item => item.ml_item_id);
        batches.push(batch);
      }

// console.log(`[SYNC ALL CBTS] 📦 Processing ${batches.length} batches of up to ${BATCH_SIZE} CBTs each`);

      for (let batchIndex = startBatchIndex; batchIndex < batches.length; batchIndex++) {
        // Check if paused
        const state = syncAllState.get(globalSeller.id);
        if (state?.paused) {
          logger.info(`[SYNC ALL CBTS] ⏸️ Sync paused at batch ${batchIndex + 1}`);
// console.log(`[SYNC ALL CBTS] ⏸️ Sync paused at batch ${batchIndex + 1}/${batches.length}`);
          // Wait until resumed
          while (state?.paused && !state?.stopped) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // Check every second
            const currentState = syncAllState.get(globalSeller.id);
            if (currentState?.stopped) {
              logger.info(`[SYNC ALL CBTS] 🛑 Sync stopped at batch ${batchIndex + 1}`);
// console.log(`[SYNC ALL CBTS] 🛑 Sync stopped at batch ${batchIndex + 1}/${batches.length}`);
              break;
            }
          }
          if (state?.stopped) {
            break; // Exit loop if stopped
          }
          logger.info(`[SYNC ALL CBTS] ▶️ Sync resumed from batch ${batchIndex + 1}`);
// console.log(`[SYNC ALL CBTS] ▶️ Sync resumed from batch ${batchIndex + 1}/${batches.length}`);
        }
        
        // Check if stopped
        if (state?.stopped) {
          logger.info(`[SYNC ALL CBTS] 🛑 Sync stopped at batch ${batchIndex + 1}`);
// console.log(`[SYNC ALL CBTS] 🛑 Sync stopped at batch ${batchIndex + 1}/${batches.length}`);
          break; // Exit loop
        }
        
        // Update current batch index
        syncAllState.set(globalSeller.id, { paused: false, stopped: false, currentBatchIndex: batchIndex });
        const batch = batches[batchIndex];
        const batchStartIndex = batchIndex * BATCH_SIZE;

        try {
          // Rate limiting: delay between batches
          if (batchIndex > 0) {
            await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
          }

// console.log(`[SYNC ALL CBTS] 🔄 Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} CBTs)...`);

          // Get items in bulk using Multiget
          let bulkResults;
          let retryCount = 0;
          let shouldRetry = true;

          while (shouldRetry && retryCount < MAX_RATE_LIMIT_RETRIES) {
            try {
              bulkResults = await itemsService.getItemsBulk(
                batch,
                globalSeller.ml_access_token
              );
              shouldRetry = false; // Success, no need to retry
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : String(error);
              
              // Check if it's a rate limit error (429)
              if (errorMsg.includes('429') || errorMsg.includes('Rate limit')) {
                rateLimitCount++;
                retryCount++;
                
                if (retryCount >= MAX_RATE_LIMIT_RETRIES) {
                  console.error(`[SYNC ALL CBTS] ❌ Rate limit exceeded for batch ${batchIndex + 1} after ${retryCount} retries`);
                  throw error;
                }
                
                // Wait longer for rate limit (exponential backoff)
                const waitTime = Math.min(1000 * Math.pow(2, retryCount), 30000); // Max 30 seconds
                console.warn(`[SYNC ALL CBTS] ⏳ Rate limit detected, waiting ${waitTime}ms before retry ${retryCount}/${MAX_RATE_LIMIT_RETRIES}...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue; // Retry
              }
              
              // Check if it's a token expiration error (401)
              if (errorMsg.includes('401') || 
                  errorMsg.includes('Unauthorized') || 
                  errorMsg.includes('unauthorized') ||
                  errorMsg.includes('invalid access token')) {
                console.error(`[SYNC ALL CBTS] 🔑🔑🔑 TOKEN EXPIRED 🔑🔑🔑`);
                console.error(`[SYNC ALL CBTS] ⏸️ Pausing sync - token needs to be refreshed`);
                tokenExpired = true;
                throw new Error('TOKEN_EXPIRED:SYNC_PAUSED:' + JSON.stringify({
                  paused: true,
                  reason: 'token_expired',
                  syncedCount,
                  failedCount,
                  currentBatchIndex: batchIndex,
                  totalBatches: batches.length,
                  totalCBTs,
                  pausedAt: Date.now(),
                }));
              }
              
              // For other errors, don't retry
              throw error;
            }
          }

          // Verify bulkResults was successfully obtained
          if (!bulkResults || bulkResults.length === 0) {
            console.warn(`[SYNC ALL CBTS] ⚠️ No results returned for batch ${batchIndex + 1}`);
            failedCount += batch.length;
            continue;
          }

          // Process each item in the batch response
          for (let i = 0; i < bulkResults.length; i++) {
            const result = bulkResults[i];
            const cbtId = batch[i];
            const currentIndex = batchStartIndex + i;

            try {
              // Check if the request was successful (code 200)
              if (result.code === 200 && result.body) {
                const mlData = result.body;

                // Extract image from pictures array (first picture)
                const imageUrl = mlData.pictures && mlData.pictures.length > 0
                  ? mlData.pictures[0].secure_url
                  : null;

                // Map ML status to our status type
                const mlStatus = mlData.status || 'active';
                const itemStatus = (mlStatus === 'active' || mlStatus === 'paused' || mlStatus === 'closed') 
                  ? mlStatus as 'active' | 'paused' | 'closed'
                  : 'active' as const;

                // Update item in database
                const now = Math.floor(Date.now() / 1000);
                // Get existing item to preserve metadata
                const existingItem = await itemRepo.findByMlItemId(globalSeller.id, cbtId);
                let existingMetadata = {};
                if (existingItem?.metadata) {
                  try {
                    existingMetadata = JSON.parse(existingItem.metadata);
                  } catch (e) {
                    // If metadata is not valid JSON, start fresh
                    existingMetadata = {};
                  }
                }
                
                const itemToUpdate = {
                  id: '', // Will be found by ml_item_id
                  global_seller_id: globalSeller.id,
                  ml_item_id: cbtId,
                  site_id: null,
                  title: mlData.title || null,
                  price: mlData.price || null,
                  currency_id: null,
                  available_quantity: 0,
                  sold_quantity: mlData.sold_quantity || 0,
                  status: itemStatus,
                  listing_type_id: mlData.listing_type_id || null,
                  condition: null,
                  permalink: null,
                  thumbnail: imageUrl,
                  category_id: mlData.category_id || null,
                  start_time: null,
                  stop_time: null,
                  end_time: null,
                  synced_at: now,
                  metadata: {
                    ...existingMetadata,
                    ...mlData,
                    sync_log: 'OK', // Mark as successfully synced
                  } as any,
                };

                await itemRepo.upsert(itemToUpdate);
                syncedCount++;
              } else {
                // Request failed for this item (non-200 code)
                failedCount++;
                const errorMsg = result.message || `HTTP ${result.code}`;
                errors.push({ cbtId, error: errorMsg });
                console.warn(`[SYNC ALL CBTS] ⚠️ Failed to sync CBT ${cbtId}: ${errorMsg}`);
                logger.warn(`[SYNC ALL CBTS] Failed to sync CBT ${cbtId} in batch: ${errorMsg}`);
                
                // Save error in metadata
                try {
                  const existingItem = await itemRepo.findByMlItemId(globalSeller.id, cbtId);
                  let existingMetadata = {};
                  if (existingItem?.metadata) {
                    try {
                      existingMetadata = JSON.parse(existingItem.metadata);
                    } catch (e) {
                      existingMetadata = {};
                    }
                  }
                  
                  const itemToUpdate = {
                    id: existingItem?.id || '',
                    global_seller_id: globalSeller.id,
                    ml_item_id: cbtId,
                    site_id: existingItem?.site_id || null,
                    title: existingItem?.title || null,
                    price: existingItem?.price || null,
                    currency_id: existingItem?.currency_id || null,
                    available_quantity: existingItem?.available_quantity || 0,
                    sold_quantity: existingItem?.sold_quantity || 0,
                    status: existingItem?.status || 'active',
                    listing_type_id: existingItem?.listing_type_id || null,
                    condition: existingItem?.condition || null,
                    permalink: existingItem?.permalink || null,
                    thumbnail: existingItem?.thumbnail || null,
                    category_id: existingItem?.category_id || null,
                    start_time: existingItem?.start_time || null,
                    stop_time: existingItem?.stop_time || null,
                    end_time: existingItem?.end_time || null,
                    synced_at: existingItem?.synced_at || null,
                    metadata: {
                      ...existingMetadata,
                      sync_log: errorMsg, // Save error message
                    } as any,
                  };
                  
                  await itemRepo.upsert(itemToUpdate);
                } catch (updateError) {
                  console.error(`[SYNC ALL CBTS] Failed to update error log for CBT ${cbtId}:`, updateError);
                }
              }
            } catch (error) {
              failedCount++;
              const errorMsg = error instanceof Error ? error.message : String(error);
              errors.push({ cbtId, error: errorMsg });
              console.error(`[SYNC ALL CBTS] ❌ Error processing CBT ${cbtId} in batch:`, errorMsg);
              logger.warn(`[SYNC ALL CBTS] Error processing CBT ${cbtId} in batch: ${errorMsg}`);
              
              // Save error in metadata
              try {
                const existingItem = await itemRepo.findByMlItemId(globalSeller.id, cbtId);
                let existingMetadata = {};
                if (existingItem?.metadata) {
                  try {
                    existingMetadata = JSON.parse(existingItem.metadata);
                  } catch (e) {
                    existingMetadata = {};
                  }
                }
                
                const itemToUpdate = {
                  id: existingItem?.id || '',
                  global_seller_id: globalSeller.id,
                  ml_item_id: cbtId,
                  site_id: existingItem?.site_id || null,
                  title: existingItem?.title || null,
                  price: existingItem?.price || null,
                  currency_id: existingItem?.currency_id || null,
                  available_quantity: existingItem?.available_quantity || 0,
                  sold_quantity: existingItem?.sold_quantity || 0,
                  status: existingItem?.status || 'active',
                  listing_type_id: existingItem?.listing_type_id || null,
                  condition: existingItem?.condition || null,
                  permalink: existingItem?.permalink || null,
                  thumbnail: existingItem?.thumbnail || null,
                  category_id: existingItem?.category_id || null,
                  start_time: existingItem?.start_time || null,
                  stop_time: existingItem?.stop_time || null,
                  end_time: existingItem?.end_time || null,
                  synced_at: existingItem?.synced_at || null,
                  metadata: {
                    ...existingMetadata,
                    sync_log: errorMsg, // Save error message
                  } as any,
                };
                
                await itemRepo.upsert(itemToUpdate);
              } catch (updateError) {
                console.error(`[SYNC ALL CBTS] Failed to update error log for CBT ${cbtId}:`, updateError);
              }
            }
          }

          // Log progress after each batch
          const progress = ((batchIndex + 1) / batches.length) * 100;
// console.log(`[SYNC ALL CBTS] 📊 Batch ${batchIndex + 1}/${batches.length} complete. Progress: ${syncedCount}/${totalCBTs} synced (${progress.toFixed(1)}%)`);
          logger.info(`[SYNC ALL CBTS] Batch ${batchIndex + 1}/${batches.length} complete: ${syncedCount}/${totalCBTs} CBTs synced (${progress.toFixed(1)}%)`);

        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          
          // Check if it's a token expiration error
          if (errorMsg.startsWith('TOKEN_EXPIRED:SYNC_PAUSED:')) {
            console.error(`[SYNC ALL CBTS] 🔑 Token expired - stopping sync`);
            logger.error(`[SYNC ALL CBTS] Token expired - sync paused at batch ${batchIndex + 1}/${batches.length} (${syncedCount}/${totalCBTs} CBTs)`);
            // Mark all remaining items in batch as failed
            for (const cbtId of batch) {
              errors.push({ cbtId, error: 'Token expired' });
            }
            failedCount += batch.length;
            break; // Stop processing
          }
          
          // Mark all items in batch as failed
          for (const cbtId of batch) {
            errors.push({ cbtId, error: errorMsg });
            failedCount++;
          }
          console.error(`[SYNC ALL CBTS] ❌ Error processing batch ${batchIndex + 1}:`, errorMsg);
          logger.warn(`[SYNC ALL CBTS] Failed to process batch ${batchIndex + 1}: ${errorMsg}`);
          
          // Continue with next batch even if one fails
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      
      // Check final state
      const finalState = syncAllState.get(globalSeller.id);
      const wasStopped = finalState?.stopped;
      
      if (wasStopped) {
// console.log(`[SYNC ALL CBTS] 🛑 Sync stopped by user`);
// console.log(`[SYNC ALL CBTS] 📊 Progress: ${syncedCount}/${totalCBTs} synced, ${failedCount} failed, ${rateLimitCount} rate limits, ${duration}s`);
        logger.info(`[SYNC ALL CBTS] Stopped: ${syncedCount}/${totalCBTs} CBTs synced, ${failedCount} failed, ${duration}s`);
        // Clear state so it can be restarted fresh
        syncAllState.delete(globalSeller.id);
      } else if (tokenExpired) {
        console.error(`[SYNC ALL CBTS] ⏸️ Sync paused due to token expiration`);
        console.error(`[SYNC ALL CBTS] 📊 Synced: ${syncedCount}/${totalCBTs}, Failed: ${failedCount}, Rate limits: ${rateLimitCount}`);
        logger.error(`[SYNC ALL CBTS] Sync paused: ${syncedCount}/${totalCBTs} CBTs synced, token expired`);
        // Keep state so it can be resumed
      } else {
// console.log(`[SYNC ALL CBTS] ✅✅✅ SYNC ALL COMPLETE ✅✅✅`);
// console.log(`[SYNC ALL CBTS] 📊 Final stats: ${syncedCount} synced, ${failedCount} failed, ${rateLimitCount} rate limits, ${duration}s`);
        logger.info(`[SYNC ALL CBTS] Complete: ${syncedCount}/${totalCBTs} CBTs synced, ${failedCount} failed, ${duration}s`);
        // Clear state on completion
        syncAllState.delete(globalSeller.id);
      }
    })();

    // Return immediately with background promise attached
    const response = successResponse({
      message: 'Sync all CBTs started in background',
      status: 'processing',
      total: totalCBTs,
    });
    
    // Attach background promise to response for waitUntil
    (response as any).backgroundPromise = backgroundSyncPromise;
    
    return response;
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return handleError(error);
  }
}

/**
 * POST /api/global-sellers/:id/cbts/sync-all/pause
 * Pause the sync all process
 */
export async function pauseSyncAllCBTsHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const globalSellerRepo = new GlobalSellerRepository(env.DB);
    const mlAPIService = new MercadoLibreAPIService();
    const globalSellerService = new GlobalSellerService(globalSellerRepo, mlAPIService);

    const user = await requireAuth(request, env, authService);

    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const globalSellerId = pathParts[3];

    if (!globalSellerId) {
      return errorResponse('Global Seller ID is required', 400, 'MISSING_ID');
    }

    const globalSeller = await globalSellerService.getById(globalSellerId);

    if (!globalSeller) {
      return errorResponse('Global Seller not found', 404, 'NOT_FOUND');
    }

    if (globalSeller.user_id !== user.id) {
      return errorResponse('Access denied', 403, 'FORBIDDEN');
    }

    const state = syncAllState.get(globalSeller.id);
    if (state) {
      state.paused = true;
      logger.info(`[SYNC ALL CBTS] Paused sync for Global Seller ${globalSellerId}`);
      return successResponse({ message: 'Sync paused', paused: true });
    }

    return errorResponse('No active sync process found', 404, 'NOT_FOUND');
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return handleError(error);
  }
}

/**
 * POST /api/global-sellers/:id/cbts/sync-all/resume
 * Resume the sync all process
 */
export async function resumeSyncAllCBTsHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const globalSellerRepo = new GlobalSellerRepository(env.DB);
    const mlAPIService = new MercadoLibreAPIService();
    const globalSellerService = new GlobalSellerService(globalSellerRepo, mlAPIService);

    const user = await requireAuth(request, env, authService);

    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const globalSellerId = pathParts[3];

    if (!globalSellerId) {
      return errorResponse('Global Seller ID is required', 400, 'MISSING_ID');
    }

    const globalSeller = await globalSellerService.getById(globalSellerId);

    if (!globalSeller) {
      return errorResponse('Global Seller not found', 404, 'NOT_FOUND');
    }

    if (globalSeller.user_id !== user.id) {
      return errorResponse('Access denied', 403, 'FORBIDDEN');
    }

    const state = syncAllState.get(globalSeller.id);
    if (state) {
      state.paused = false;
      logger.info(`[SYNC ALL CBTS] Resumed sync for Global Seller ${globalSellerId}`);
      return successResponse({ message: 'Sync resumed', paused: false });
    }

    return errorResponse('No paused sync process found', 404, 'NOT_FOUND');
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return handleError(error);
  }
}

/**
 * POST /api/global-sellers/:id/cbts/sync-all/stop
 * Stop the sync all process completely
 */
export async function stopSyncAllCBTsHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const globalSellerRepo = new GlobalSellerRepository(env.DB);
    const mlAPIService = new MercadoLibreAPIService();
    const globalSellerService = new GlobalSellerService(globalSellerRepo, mlAPIService);

    const user = await requireAuth(request, env, authService);

    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const globalSellerId = pathParts[3];

    if (!globalSellerId) {
      return errorResponse('Global Seller ID is required', 400, 'MISSING_ID');
    }

    const globalSeller = await globalSellerService.getById(globalSellerId);

    if (!globalSeller) {
      return errorResponse('Global Seller not found', 404, 'NOT_FOUND');
    }

    if (globalSeller.user_id !== user.id) {
      return errorResponse('Access denied', 403, 'FORBIDDEN');
    }

    const state = syncAllState.get(globalSeller.id);
    if (state) {
      state.stopped = true;
      state.paused = false; // Unpause if paused so it can exit
      logger.info(`[SYNC ALL CBTS] Stopped sync for Global Seller ${globalSellerId}`);
      return successResponse({ message: 'Sync stopped', stopped: true });
    }

    return errorResponse('No active sync process found', 404, 'NOT_FOUND');
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return handleError(error);
  }
}

/**
 * POST /api/global-sellers/:id/cbts/continue-sync
 * Continue syncing only unsynced CBTs from where we left off
 * Processes unsynced CBTs in batches using Multiget
 */
export async function continueSyncCBTsHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const globalSellerRepo = new GlobalSellerRepository(env.DB);
    const mlAPIService = new MercadoLibreAPIService();
    const globalSellerService = new GlobalSellerService(globalSellerRepo, mlAPIService);
    const itemRepo = new ItemRepository(env.DB);
    const itemsService = new MercadoLibreItemsService();

    const user = await requireAuth(request, env, authService);

    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const globalSellerId = pathParts[3]; // /api/global-sellers/:id/cbts/continue-sync

    if (!globalSellerId) {
      return errorResponse('Global Seller ID is required', 400, 'MISSING_ID');
    }

    const globalSeller = await globalSellerService.getById(globalSellerId);

    if (!globalSeller) {
      return errorResponse('Global Seller not found', 404, 'NOT_FOUND');
    }

    if (globalSeller.user_id !== user.id) {
      return errorResponse('Access denied', 403, 'FORBIDDEN');
    }

    if (!globalSeller.ml_access_token) {
      return errorResponse('Mercado Libre access token is required', 400, 'MISSING_TOKEN');
    }

    logger.info(`[CONTINUE SYNC CBTS] Starting continue sync for unsynced CBTs for Global Seller ${globalSellerId}`);

    // Get unsynced CBTs from database
    const unsyncedCBTs = await itemRepo.findUnsyncedCBTs(globalSeller.id, {
      limit: 500000, // Get all unsynced CBTs
      offset: 0,
    });

    const totalUnsynced = unsyncedCBTs.items.length;
    logger.info(`[CONTINUE SYNC CBTS] Found ${totalUnsynced} unsynced CBTs to sync`);

    if (totalUnsynced === 0) {
      return successResponse({
        message: 'No unsynced CBTs found. All CBTs are already synced.',
        status: 'completed',
        total: 0,
      });
    }

    // Initialize or get existing state
    const existingState = continueSyncState.get(globalSeller.id);
    let startBatchIndex = 0;
    if (existingState && !existingState.stopped) {
      // Resume from where we left off
      startBatchIndex = existingState.currentBatchIndex;
      logger.info(`[CONTINUE SYNC CBTS] Resuming from batch ${startBatchIndex + 1}`);
    } else {
      // Start fresh
      continueSyncState.set(globalSeller.id, { paused: false, stopped: false, currentBatchIndex: 0 });
    }

    // Start background sync (same logic as syncAllCBTsHandler but only for unsynced)
    const backgroundSyncPromise = (async () => {
      const startTime = Date.now();
      let syncedCount = 0;
      let failedCount = 0;
      let rateLimitCount = 0;
      let tokenExpired = false;
      const errors: Array<{ cbtId: string; error: string }> = [];
      const RATE_LIMIT_DELAY = 200; // 200ms delay between requests to avoid rate limits
      const MAX_RATE_LIMIT_RETRIES = 5; // Max retries for rate limit errors

// console.log(`[CONTINUE SYNC CBTS] 🚀 Starting background sync for ${totalUnsynced} unsynced CBTs using Multiget (bulk)...`);

      // Process in batches of 20 (ML Multiget limit)
      const BATCH_SIZE = 20;
      const batches: string[][] = [];
      
      for (let i = 0; i < unsyncedCBTs.items.length; i += BATCH_SIZE) {
        const batch = unsyncedCBTs.items.slice(i, i + BATCH_SIZE).map(item => item.ml_item_id);
        batches.push(batch);
      }

// console.log(`[CONTINUE SYNC CBTS] 📦 Processing ${batches.length} batches of up to ${BATCH_SIZE} CBTs each`);

      for (let batchIndex = startBatchIndex; batchIndex < batches.length; batchIndex++) {
        // Check if paused
        const state = continueSyncState.get(globalSeller.id);
        if (state?.paused) {
          logger.info(`[CONTINUE SYNC CBTS] ⏸️ Sync paused at batch ${batchIndex + 1}`);
// console.log(`[CONTINUE SYNC CBTS] ⏸️ Sync paused at batch ${batchIndex + 1}/${batches.length}`);
          // Wait until resumed
          while (state?.paused && !state?.stopped) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // Check every second
            const currentState = continueSyncState.get(globalSeller.id);
            if (currentState?.stopped) {
              logger.info(`[CONTINUE SYNC CBTS] 🛑 Sync stopped at batch ${batchIndex + 1}`);
// console.log(`[CONTINUE SYNC CBTS] 🛑 Sync stopped at batch ${batchIndex + 1}/${batches.length}`);
              break;
            }
          }
          if (state?.stopped) {
            break; // Exit loop if stopped
          }
          logger.info(`[CONTINUE SYNC CBTS] ▶️ Sync resumed from batch ${batchIndex + 1}`);
// console.log(`[CONTINUE SYNC CBTS] ▶️ Sync resumed from batch ${batchIndex + 1}/${batches.length}`);
        }
        
        // Check if stopped
        if (state?.stopped) {
          logger.info(`[CONTINUE SYNC CBTS] 🛑 Sync stopped at batch ${batchIndex + 1}`);
// console.log(`[CONTINUE SYNC CBTS] 🛑 Sync stopped at batch ${batchIndex + 1}/${batches.length}`);
          break; // Exit loop
        }
        
        // Update current batch index
        continueSyncState.set(globalSeller.id, { paused: false, stopped: false, currentBatchIndex: batchIndex });
        const batch = batches[batchIndex];
        
        // Declare bulkResults outside try block so it's available in catch block
        let bulkResults: any[] | undefined = undefined;

        try {
          // Rate limiting: delay between batches
          if (batchIndex > 0) {
            await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
          }

// console.log(`[CONTINUE SYNC CBTS] 🔄 Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} CBTs)...`);

          // Get items in bulk using Multiget
          let retryCount = 0;
          let shouldRetry = true;

          while (shouldRetry && retryCount < MAX_RATE_LIMIT_RETRIES) {
            try {
              bulkResults = await itemsService.getItemsBulk(
                batch,
                globalSeller.ml_access_token
              );
              shouldRetry = false; // Success, no need to retry
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : String(error);
              const isRetryable = (error as any)?.retryable === true;
              
              // Check if it's a network error that's retryable
              if (isRetryable || 
                  errorMsg.includes('Network connection lost') ||
                  errorMsg.includes('Network connection error') ||
                  errorMsg.includes('Failed to fetch') ||
                  errorMsg.includes('timeout') ||
                  errorMsg.includes('NetworkError')) {
                retryCount++;
                if (retryCount < MAX_RATE_LIMIT_RETRIES) {
                  const delay = Math.min(1000 * Math.pow(2, retryCount), 10000); // Exponential backoff, max 10s
// console.log(`[CONTINUE SYNC CBTS] ⚠️ Network error (${retryCount}/${MAX_RATE_LIMIT_RETRIES}), waiting ${delay}ms before retry...`);
                  await new Promise(resolve => setTimeout(resolve, delay));
                  continue; // Retry
                } else {
// console.log(`[CONTINUE SYNC CBTS] ⚠️ Max retries reached for network error, will retry batch in outer catch`);
                  shouldRetry = false;
                  throw error; // Let outer catch handle batch retry
                }
              }
              
              // Check if it's a rate limit error (429)
              if (errorMsg.includes('429') || errorMsg.includes('Rate limit')) {
                rateLimitCount++;
                retryCount++;
                const delay = Math.min(1000 * Math.pow(2, retryCount), 10000); // Exponential backoff, max 10s
// console.log(`[CONTINUE SYNC CBTS] ⚠️ Rate limit hit (${retryCount}/${MAX_RATE_LIMIT_RETRIES}), waiting ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue; // Retry
              }
              
              // Check if it's a token expiration error (401)
              if (errorMsg.includes('401') || errorMsg.includes('invalid access token') || errorMsg.includes('unauthorized')) {
                tokenExpired = true;
                logger.error(`[CONTINUE SYNC CBTS] ❌ Token expired at batch ${batchIndex + 1}`);
// console.log(`[CONTINUE SYNC CBTS] ❌ Token expired. Pausing sync. Please update token and resume.`);
                continueSyncState.set(globalSeller.id, { paused: true, stopped: false, currentBatchIndex: batchIndex });
                throw new Error('TOKEN_EXPIRED:SYNC_PAUSED:');
              }
              
              // Other errors - don't retry
              shouldRetry = false;
              throw error;
            }
          }

          // Process results (same logic as syncAllCBTsHandler)
          // Note: bulkResults might be undefined if we're retrying after a network error
          if (!bulkResults) {
            console.error(`[CONTINUE SYNC CBTS] No results to process for batch ${batchIndex + 1}`);
            continue; // Skip to next batch
          }
          
          for (const result of bulkResults) {
            if (result.code === 200 && 'id' in result.body) {
              const item = result.body as MLItem;
              const cbtId = item.id;

              try {
                // Extract image from pictures array (first picture)
                const imageUrl = item.pictures && item.pictures.length > 0
                  ? item.pictures[0].secure_url
                  : null;

                // Map ML status to our status type
                const mlStatus = item.status || 'active';
                const itemStatus = (mlStatus === 'active' || mlStatus === 'paused' || mlStatus === 'closed') 
                  ? mlStatus as 'active' | 'paused' | 'closed'
                  : 'active' as const;

                // Get existing item to preserve metadata
                const existingItem = await itemRepo.findByMlItemId(globalSeller.id, cbtId);
                let existingMetadata = {};
                if (existingItem?.metadata) {
                  try {
                    existingMetadata = JSON.parse(existingItem.metadata);
                  } catch (e) {
                    existingMetadata = {};
                  }
                }

                const now = Math.floor(Date.now() / 1000);
                const itemToUpdate = {
                  id: '', // Will be found by ml_item_id
                  global_seller_id: globalSeller.id,
                  ml_item_id: cbtId,
                  site_id: item.site_id || null,
                  title: item.title || null,
                  price: item.price || null,
                  currency_id: item.currency_id || null,
                  available_quantity: item.available_quantity || 0,
                  sold_quantity: item.sold_quantity || 0,
                  status: itemStatus,
                  listing_type_id: item.listing_type_id || null,
                  condition: item.condition || null,
                  permalink: item.permalink || null,
                  thumbnail: imageUrl,
                  category_id: item.category_id || null,
                  start_time: item.start_time ? Math.floor(new Date(item.start_time).getTime() / 1000) : null,
                  stop_time: item.stop_time ? Math.floor(new Date(item.stop_time).getTime() / 1000) : null,
                  end_time: item.end_time ? Math.floor(new Date(item.end_time).getTime() / 1000) : null,
                  synced_at: now,
                  metadata: {
                    ...existingMetadata,
                    ...item,
                    sync_log: 'OK',
                  } as any,
                };

                await itemRepo.upsert(itemToUpdate);
                syncedCount++;
              } catch (updateError) {
                failedCount++;
                const errorMsg = updateError instanceof Error ? updateError.message : String(updateError);
                errors.push({ cbtId, error: errorMsg });
                
                // Save error to metadata
                try {
                  const existingItem = await itemRepo.findByMlItemId(globalSeller.id, cbtId);
                  if (existingItem) {
                    let existingMetadata = {};
                    if (existingItem.metadata) {
                      try {
                        existingMetadata = JSON.parse(existingItem.metadata);
                      } catch (e) {
                        existingMetadata = {};
                      }
                    }
                    
                    const now = Math.floor(Date.now() / 1000);
                    await itemRepo.upsert({
                      ...existingItem,
                      metadata: {
                        ...existingMetadata,
                        sync_log: errorMsg,
                      },
                      synced_at: now,
                    } as any);
                  }
                } catch (saveError) {
                  logger.error(`[CONTINUE SYNC CBTS] Error saving error to metadata for ${cbtId}:`, saveError);
                }
              }
            } else {
              // Item not found or error
              const cbtId = batch.find(id => id) || 'unknown';
              failedCount++;
              const errorMsg = result.body?.message || `HTTP ${result.code}`;
              errors.push({ cbtId, error: errorMsg });
              
              // Save error to metadata
              try {
                const existingItem = await itemRepo.findByMlItemId(globalSeller.id, cbtId);
                if (existingItem) {
                  let existingMetadata = {};
                  if (existingItem.metadata) {
                    try {
                      existingMetadata = JSON.parse(existingItem.metadata);
                    } catch (e) {
                      existingMetadata = {};
                    }
                  }
                  
                  const now = Math.floor(Date.now() / 1000);
                  await itemRepo.upsert({
                    ...existingItem,
                    metadata: {
                      ...existingMetadata,
                      sync_log: errorMsg,
                    },
                    synced_at: now,
                  } as any);
                }
              } catch (saveError) {
                logger.error(`[CONTINUE SYNC CBTS] Error saving error to metadata for ${cbtId}:`, saveError);
              }
            }
          }

          // Log progress every 10 batches
          if ((batchIndex + 1) % 10 === 0 || batchIndex === batches.length - 1) {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            const rate = syncedCount / elapsed;
            const remaining = batches.length - (batchIndex + 1);
            const estimatedSeconds = remaining / rate;
// console.log(`[CONTINUE SYNC CBTS] 📊 Progress: ${batchIndex + 1}/${batches.length} batches, ${syncedCount} synced, ${failedCount} failed (${rate.toFixed(2)}/s, ~${Math.floor(estimatedSeconds)}s remaining)`);
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          
          // Check if token expired
          if (errorMsg.includes('TOKEN_EXPIRED:SYNC_PAUSED:')) {
            logger.error(`[CONTINUE SYNC CBTS] ❌ Token expired, sync paused`);
// console.log(`[CONTINUE SYNC CBTS] ❌ Token expired. Sync paused. Please update token and resume.`);
            break; // Exit loop
          }
          
          // Check if it's a network error that we should retry the whole batch
          const isRetryable = (error as any)?.retryable === true;
          if (isRetryable || 
              errorMsg.includes('Network connection lost') ||
              errorMsg.includes('Network connection error') ||
              errorMsg.includes('Failed to fetch') ||
              errorMsg.includes('timeout') ||
              errorMsg.includes('NetworkError')) {
            // Retry the batch with exponential backoff
            let batchRetryCount = 0;
            const MAX_BATCH_RETRIES = 3;
            let batchRetrySuccess = false;
            
            while (batchRetryCount < MAX_BATCH_RETRIES && !batchRetrySuccess) {
              batchRetryCount++;
              const delay = Math.min(2000 * Math.pow(2, batchRetryCount - 1), 20000); // Exponential backoff, max 20s
// console.log(`[CONTINUE SYNC CBTS] ⚠️ Network error in batch ${batchIndex + 1}, retrying batch (${batchRetryCount}/${MAX_BATCH_RETRIES}) after ${delay}ms...`);
              await new Promise(resolve => setTimeout(resolve, delay));
              
              try {
                // Retry the batch with rate limiting
                await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
                const retryBulkResults = await itemsService.getItemsBulk(
                  batch,
                  globalSeller.ml_access_token
                );
                bulkResults = retryBulkResults; // Assign to outer scope variable
                batchRetrySuccess = true;
// console.log(`[CONTINUE SYNC CBTS] ✅ Batch ${batchIndex + 1} retry successful`);
                // Break out of retry loop and continue processing the results
                break;
              } catch (retryError) {
                const retryErrorMsg = retryError instanceof Error ? retryError.message : String(retryError);
                console.error(`[CONTINUE SYNC CBTS] ❌ Batch ${batchIndex + 1} retry ${batchRetryCount} failed:`, retryErrorMsg);
                if (batchRetryCount >= MAX_BATCH_RETRIES) {
                  // Max retries reached, mark all items as failed
                  logger.error(`[CONTINUE SYNC CBTS] Max batch retries reached for batch ${batchIndex + 1}`);
                  for (const cbtId of batch) {
                    failedCount++;
                    errors.push({ cbtId, error: retryErrorMsg });
                  }
                  batchRetrySuccess = false;
                  break; // Exit retry loop
                }
              }
            }
            
            if (!batchRetrySuccess) {
              continue; // Skip to next batch if all retries failed
            }
            
            // If retry was successful, process bulkResults
            if (bulkResults) {
              // Process results (same logic as syncAllCBTsHandler)
              for (const result of bulkResults) {
                if (result.code === 200 && 'id' in result.body) {
                  const item = result.body as MLItem;
                  const cbtId = item.id;

                  try {
                    // Extract image from pictures array (first picture)
                    const imageUrl = item.pictures && item.pictures.length > 0
                      ? item.pictures[0].secure_url
                      : null;

                    // Map ML status to our status type
                    const mlStatus = item.status || 'active';
                    const itemStatus = (mlStatus === 'active' || mlStatus === 'paused' || mlStatus === 'closed') 
                      ? mlStatus as 'active' | 'paused' | 'closed'
                      : 'active' as const;

                    // Get existing item to preserve metadata
                    const existingItem = await itemRepo.findByMlItemId(globalSeller.id, cbtId);
                    let existingMetadata = {};
                    if (existingItem?.metadata) {
                      try {
                        existingMetadata = JSON.parse(existingItem.metadata);
                      } catch (e) {
                        existingMetadata = {};
                      }
                    }

                    const now = Math.floor(Date.now() / 1000);
                    const itemToUpdate = {
                      id: '', // Will be found by ml_item_id
                      global_seller_id: globalSeller.id,
                      ml_item_id: cbtId,
                      site_id: item.site_id || null,
                      title: item.title || null,
                      price: item.price || null,
                      currency_id: item.currency_id || null,
                      available_quantity: item.available_quantity || 0,
                      sold_quantity: item.sold_quantity || 0,
                      status: itemStatus,
                      listing_type_id: item.listing_type_id || null,
                      condition: item.condition || null,
                      permalink: item.permalink || null,
                      thumbnail: imageUrl,
                      category_id: item.category_id || null,
                      start_time: item.start_time ? Math.floor(new Date(item.start_time).getTime() / 1000) : null,
                      stop_time: item.stop_time ? Math.floor(new Date(item.stop_time).getTime() / 1000) : null,
                      end_time: item.end_time ? Math.floor(new Date(item.end_time).getTime() / 1000) : null,
                      synced_at: now,
                      metadata: {
                        ...existingMetadata,
                        ...item,
                        sync_log: 'OK',
                      } as any,
                    };

                    await itemRepo.upsert(itemToUpdate);
                    syncedCount++;
                  } catch (updateError) {
                    failedCount++;
                    const errorMsg = updateError instanceof Error ? updateError.message : String(updateError);
                    errors.push({ cbtId, error: errorMsg });
                    
                    // Save error to metadata
                    try {
                      const existingItem = await itemRepo.findByMlItemId(globalSeller.id, cbtId);
                      if (existingItem) {
                        let existingMetadata = {};
                        if (existingItem.metadata) {
                          try {
                            existingMetadata = JSON.parse(existingItem.metadata);
                          } catch (e) {
                            existingMetadata = {};
                          }
                        }
                        
                        const now = Math.floor(Date.now() / 1000);
                        await itemRepo.upsert({
                          ...existingItem,
                          metadata: {
                            ...existingMetadata,
                            sync_log: errorMsg,
                          },
                          synced_at: now,
                        } as any);
                      }
                    } catch (saveError) {
                      logger.error(`[CONTINUE SYNC CBTS] Error saving error to metadata for ${cbtId}:`, saveError);
                    }
                  }
                } else {
                  // Item not found or error
                  const cbtId = batch.find(id => id) || 'unknown';
                  failedCount++;
                  const errorMsg = result.body?.message || `HTTP ${result.code}`;
                  errors.push({ cbtId, error: errorMsg });
                  
                  // Save error to metadata
                  try {
                    const existingItem = await itemRepo.findByMlItemId(globalSeller.id, cbtId);
                    if (existingItem) {
                      let existingMetadata = {};
                      if (existingItem.metadata) {
                        try {
                          existingMetadata = JSON.parse(existingItem.metadata);
                        } catch (e) {
                          existingMetadata = {};
                        }
                      }
                      
                      const now = Math.floor(Date.now() / 1000);
                      await itemRepo.upsert({
                        ...existingItem,
                        metadata: {
                          ...existingMetadata,
                          sync_log: errorMsg,
                        },
                        synced_at: now,
                      } as any);
                    }
                  } catch (saveError) {
                    logger.error(`[CONTINUE SYNC CBTS] Error saving error to metadata for ${cbtId}:`, saveError);
                  }
                }
              }
            }
          } else {
            // Log error but continue with next batch
            logger.error(`[CONTINUE SYNC CBTS] Error processing batch ${batchIndex + 1}:`, error);
            console.error(`[CONTINUE SYNC CBTS] ❌ Error processing batch ${batchIndex + 1}:`, errorMsg);
            
            // Mark all items in batch as failed
            for (const cbtId of batch) {
              failedCount++;
              errors.push({ cbtId, error: errorMsg });
            }
            continue; // Skip to next batch
          }
        }
      }

      // Final summary
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const finalState = continueSyncState.get(globalSeller.id);
      
      if (tokenExpired) {
        logger.warn(`[CONTINUE SYNC CBTS] ⚠️ Sync paused due to token expiration. ${syncedCount} synced, ${failedCount} failed in ${elapsed}s`);
// console.log(`[CONTINUE SYNC CBTS] ⚠️ Sync paused due to token expiration. ${syncedCount} synced, ${failedCount} failed`);
      } else if (finalState?.stopped) {
        logger.info(`[CONTINUE SYNC CBTS] 🛑 Sync stopped. ${syncedCount} synced, ${failedCount} failed in ${elapsed}s`);
// console.log(`[CONTINUE SYNC CBTS] 🛑 Sync stopped. ${syncedCount} synced, ${failedCount} failed`);
      } else {
        logger.info(`[CONTINUE SYNC CBTS] ✅ Sync completed. ${syncedCount} synced, ${failedCount} failed in ${elapsed}s`);
// console.log(`[CONTINUE SYNC CBTS] ✅ Sync completed. ${syncedCount} synced, ${failedCount} failed`);
        // Clean up state on completion
        if (finalState) {
          continueSyncState.delete(globalSeller.id);
        }
      }
    })();

    // Return immediately with background promise attached
    const response = successResponse({
      message: 'Continue sync started in background',
      status: 'processing',
      total: totalUnsynced,
    });
    
    // Attach background promise to response for waitUntil
    (response as any).backgroundPromise = backgroundSyncPromise;
    
    return response;
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return handleError(error);
  }
}

/**
 * GET /api/global-sellers/:id/cbts/saved
 * Get saved CBTs from database (only items with ID starting with "CBT")
 */
export async function getSavedCBTsHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const globalSellerRepo = new GlobalSellerRepository(env.DB);
    const mlAPIService = new MercadoLibreAPIService();
    const globalSellerService = new GlobalSellerService(globalSellerRepo, mlAPIService);
    const itemRepo = new ItemRepository(env.DB);

    const user = await requireAuth(request, env, authService);

    const url = new URL(request.url);
    const id = url.pathname.split('/')[3]; // /api/global-sellers/:id/cbts/saved

    if (!id) {
      return errorResponse('Global Seller ID is required', 400, 'MISSING_ID');
    }

    const globalSeller = await globalSellerService.getById(id);

    if (!globalSeller) {
      return errorResponse('Global Seller not found', 404, 'NOT_FOUND');
    }

    if (globalSeller.user_id !== user.id) {
      return errorResponse('Access denied', 403, 'FORBIDDEN');
    }

    // Get query parameters
    let limit = parseInt(url.searchParams.get('limit') || '200', 10);
    let offset = parseInt(url.searchParams.get('offset') || '0', 10);
    
    // OPTIMIZATION 3: Sin ordenamiento - más rápido en grandes datasets
    // Ordenar 396k registros es muy lento, así que lo omitimos por defecto
    // El frontend puede ordenar localmente si es necesario
    const orderBy = undefined; // Sin ordenamiento - mucho más rápido
    const orderDir = undefined;

    // Cap limit to reasonable maximum (200 items per page for pagination)
    limit = Math.max(1, Math.min(limit, 200));
    offset = Math.max(0, offset);

// logger.debug(`[GET SAVED CBTS] Fetching CBTs: limit=${limit}, offset=${offset}`);

    // Get CBTs directly from database using optimized query (includes total count)
    const dbResult = await itemRepo.findCBTsByGlobalSellerId(globalSeller.id, {
      limit,
      offset,
      orderBy,
      orderDir,
    });

    const totalCBTs = dbResult.total;

    // OPTIMIZATION 4: Estimado rápido - conteo basado en la página actual
    // Por defecto, calculamos un estimado rápido basado en la página actual
    // Solo calculamos el conteo exacto si se solicita explícitamente (más lento)
    const includeExactSyncCount = url.searchParams.get('exactSyncCount') === 'true';
    
    let syncedCount = 0;
    let notSyncedCount = totalCBTs;
    
    if (includeExactSyncCount) {
      // Conteo exacto (más lento pero preciso) - solo cuando se solicita
      syncedCount = await itemRepo.getSyncedCBTsCount(globalSeller.id);
      notSyncedCount = totalCBTs - syncedCount;
    } else {
      // Estimado rápido: calcula ratio basado en items de la página actual
      // Esto evita el COUNT(*) costoso sobre 396k registros
      const currentPageSynced = dbResult.items.filter(item => 
        item.title !== null || (item.price !== null && item.price !== 0)
      ).length;
      
      if (dbResult.items.length > 0) {
        const estimatedRatio = currentPageSynced / dbResult.items.length;
        syncedCount = Math.round(totalCBTs * estimatedRatio);
        notSyncedCount = totalCBTs - syncedCount;
      } else {
        // No hay items en la página actual, usar 0 como estimado
        syncedCount = 0;
        notSyncedCount = totalCBTs;
      }
    }

    // OPTIMIZATION 5: Metadata sin parsear - el backend no parsea, solo envía el string
    // El frontend parsea solo cuando lo necesita (lazy parsing)
    // Esto evita parsear JSON innecesariamente para todos los items
    const paginatedCBTs = dbResult.items.map(item => ({
      id: item.ml_item_id,
      title: item.title,
      price: item.price,
      category_id: item.category_id,
      sold_quantity: item.sold_quantity,
      listing_type_id: item.listing_type_id,
      thumbnail: item.thumbnail,
      status: item.status,
      synced_at: item.synced_at,
      sync_log: null, // Frontend parsea desde metadata solo si lo necesita
      metadata: item.metadata, // Incluir metadata completo como string para el frontend
    }));

    logger.info(`[GET SAVED CBTS] Returning ${paginatedCBTs.length} CBTs (offset: ${offset}, limit: ${limit}), total: ${totalCBTs}`);
// console.log(`[GET SAVED CBTS] ✅ Returning ${paginatedCBTs.length} CBTs, total in DB: ${totalCBTs.toLocaleString()}`);
// console.log(`[GET SAVED CBTS] 📊 Sync stats: ${syncedCount} synced, ${notSyncedCount} not synced`);

    return successResponse({
      cbts: paginatedCBTs,
      paging: {
        total: totalCBTs,
        offset,
        limit,
      },
      source: 'database',
      syncStats: {
        synced: syncedCount,
        notSynced: notSyncedCount,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return handleError(error);
  }
}
