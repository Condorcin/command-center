import { requireAuth } from '../middlewares/auth';
import { GlobalSellerService } from '../services/global-seller.service';
import { GlobalSellerRepository } from '../repositories/global-seller.repository';
import { MercadoLibreAPIService } from '../services/mercado-libre-api.service';
import { MercadoLibreItemsService } from '../services/mercado-libre-items.service';
import { ItemRepository } from '../repositories/item.repository';
import { UserRepository } from '../repositories/user.repository';
import { SessionRepository } from '../repositories/session.repository';
import { AuthService } from '../services/auth.service';
import { successResponse, errorResponse, handleError } from '../utils/response';
import { logger } from '../utils/logger';
import { ML_API_LIMITS, VALID_ITEM_STATUSES, VALID_ORDER_OPTIONS, PAGINATION, type ItemStatus, type OrderOption } from '../config/constants';
import { Item } from '../db/schema';

export interface Env {
  DB: D1Database;
}

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
      return errorResponse('Global Seller ID is required', 400, 'MISSING_ID');
    }

    const globalSeller = await globalSellerService.getById(id);

    if (!globalSeller) {
      return errorResponse('Global Seller not found', 404, 'NOT_FOUND');
    }

    if (globalSeller.user_id !== user.id) {
      return errorResponse('Access denied', 403, 'FORBIDDEN');
    }

    // Try to get count from database first, but always fallback to ML API if database is empty
    try {
      const dbCount = await itemRepo.getCountByStatus(globalSeller.id);
      
      // If database has data, use it. Otherwise, get from ML API
      if (dbCount.total > 0) {
        return successResponse({ count: dbCount, source: 'database' });
      } else {
        // Database is empty, get fresh data from ML API
        const mlCount = await itemsService.getItemsCount(
          globalSeller.ml_user_id,
          globalSeller.ml_access_token
        );
        return successResponse({ count: mlCount, source: 'ml_api' });
      }
    } catch (error) {
      // Fallback to ML API if database query fails
      logger.warn('Failed to get count from database, falling back to ML API:', error);
      const mlCount = await itemsService.getItemsCount(
        globalSeller.ml_user_id,
        globalSeller.ml_access_token
      );
      return successResponse({ count: mlCount, source: 'ml_api' });
    }
  } catch (error) {
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
        logger.debug(`Querying database: status=${queryStatus}, limit=${limit}, offset=${offset}, orderBy=${orderBy}`);
        
        const dbResult = await itemRepo.findByGlobalSellerId(globalSeller.id, {
          status: queryStatus,
          search,
          limit,
          offset,
          orderBy,
          orderDir,
        });
        
        logger.debug(`Database query result: ${dbResult.items.length} items, total: ${dbResult.total}`);

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
        if (result.code === 200 && 'id' in result.body) {
          items.push(result.body as any);
        } else if (result.code !== 200) {
          const errorBody = result.body as { error?: string; message?: string };
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
    let limit = parseInt(url.searchParams.get('limit') || '10000', 10); // Default to high limit to get all items
    let offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const orderBy = url.searchParams.get('orderBy') as 'title' | 'price' | 'updated_at' | 'start_time' | 'synced_at' || 'synced_at';
    const orderDir = url.searchParams.get('orderDir') as 'ASC' | 'DESC' || 'DESC';

    // Increase limit to get all items when no status filter
    if (!status) {
      limit = Math.max(limit, 50000); // Get all items when no status filter (high limit)
    } else {
      limit = Math.max(1, Math.min(limit, 100));
    }
    offset = Math.max(0, offset);

    logger.debug(`[GET SAVED] Fetching items: status=${status || 'ALL (no filter)'}, limit=${limit}, offset=${offset}`);

    // Get items from database - pass undefined for status to get all items
    const dbResult = await itemRepo.findByGlobalSellerId(globalSeller.id, {
      status: status, // undefined means no filter - get all statuses
      limit,
      offset,
      orderBy,
      orderDir,
    });
    
    logger.debug(`[GET SAVED] Found ${dbResult.items.length} items, total: ${dbResult.total}`);
    if (dbResult.items.length > 0) {
      const statusCounts = {
        active: dbResult.items.filter(i => i.status === 'active').length,
        paused: dbResult.items.filter(i => i.status === 'paused').length,
        closed: dbResult.items.filter(i => i.status === 'closed').length,
      };
      logger.debug(`[GET SAVED] Status distribution in response:`, statusCounts);
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
    logger.debug('[SYNC] syncItemsHandler called');
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const globalSellerRepo = new GlobalSellerRepository(env.DB);
    const mlAPIService = new MercadoLibreAPIService();
    const globalSellerService = new GlobalSellerService(globalSellerRepo, mlAPIService);
    const itemsService = new MercadoLibreItemsService();
    const itemRepo = new ItemRepository(env.DB);

    logger.debug('[SYNC] Authenticating user...');
    const user = await requireAuth(request, env, authService);
    logger.debug('[SYNC] User authenticated:', user.id);

    const url = new URL(request.url);
    const id = url.pathname.split('/')[3]; // /api/global-sellers/:id/items/sync

    if (!id) {
      logger.error('[SYNC] Missing Global Seller ID');
      return errorResponse('Global Seller ID is required', 400, 'MISSING_ID');
    }

    logger.debug('[SYNC] Fetching Global Seller:', id);
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

    logger.debug(`[SYNC] Received sync request for Global Seller ${globalSeller.id}, status: ${status}, ml_user_id: ${globalSeller.ml_user_id}`);

    // Start sync in background with batch processing (5 items in parallel)
    // This gets full metadata for each item and saves it to database
    (async () => {
      try {
        logger.debug(`[SYNC] Starting sync for Global Seller ${globalSeller.id}, status: ${status}`);
        let syncedCount = 0;
        let offset = 0;
        const limit = ML_API_LIMITS.MAX_ITEMS_PER_PAGE;
        const batchSize = ML_API_LIMITS.BATCH_SIZE; // Save in batches to DB

        while (true) {
          // Get item IDs from ML
          logger.debug(`Fetching items from ML API: offset=${offset}, limit=${limit}`);
          const searchResult = await itemsService.searchItems(
            globalSeller.ml_user_id,
            globalSeller.ml_access_token,
            { status, offset, limit }
          );
          
          logger.debug(`Got ${searchResult.results?.length || 0} item IDs from ML API`);

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
          
          logger.debug(`Processing ${itemsDetails.length} items from bulk response`);
          
          for (const result of itemsDetails) {
            if (result.code === 200 && 'id' in result.body) {
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
              logger.warn(`Skipping item with code ${result.code}:`, result.body);
            }
          }
          
          logger.debug(`Prepared ${itemsToSave.length} items to save to database`);
          
          // Save items in batches to database for better performance
          if (itemsToSave.length > 0) {
            // Save in batches of 100 for optimal database performance
            for (let i = 0; i < itemsToSave.length; i += batchSize) {
              const batch = itemsToSave.slice(i, i + batchSize);
              try {
                logger.debug(`Attempting to save batch ${i}-${i + batch.length} (${batch.length} items) to database`);
                await itemRepo.bulkUpsert(batch);
                syncedCount += batch.length;
                logger.debug(`✓ Successfully synced ${syncedCount} items (batch of ${batch.length} saved) for Global Seller ${globalSeller.id}`);
              } catch (error) {
                logger.error(`✗ Error saving batch ${i}-${i + batch.length}:`, error);
                logger.error('Error details:', error instanceof Error ? error.message : String(error));
                logger.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
                // Continue with next batch even if one fails
              }
            }
          } else {
            logger.debug(`No items to save for offset ${offset} (got ${itemsDetails.length} results from ML)`);
          }

          // Check if we've reached the limit or end
          if (offset + limit >= ML_API_LIMITS.MAX_OFFSET || searchResult.results.length < limit) {
            break;
          }

          offset += limit;
        }

        logger.debug(`[SYNC] Sync completed: ${syncedCount} items synced with full metadata for Global Seller ${globalSeller.id}`);
      } catch (error) {
        logger.error('[SYNC] Sync error:', error);
        logger.error('[SYNC] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        logger.error('[SYNC] Error details:', error);
      }
    })();
    
    logger.debug(`[SYNC] Background sync task started for Global Seller ${globalSeller.id}`);

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

    logger.debug(`[LOAD] Loading page ${page} (offset ${offset}) for Global Seller ${globalSeller.id}`);
    logger.debug(`[LOAD] Parameters: status=${validStatus}, order=${order}, ml_user_id=${globalSeller.ml_user_id}`);

    try {
      // 1. Get item IDs from ML API for this page
      logger.debug(`[LOAD] Calling searchItems with: ml_user_id=${globalSeller.ml_user_id}, status=${validStatus}, offset=${offset}, limit=${limit}, order=${order}`);
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

      logger.debug(`[LOAD] searchItems returned:`, {
        resultsCount: searchResult.results?.length || 0,
        total: searchResult.paging?.total || 0,
        hasResults: !!searchResult.results && searchResult.results.length > 0
      });

      if (!searchResult.results || searchResult.results.length === 0) {
        // Check if it's a pagination limit issue
        if (searchResult.paginationLimitReached) {
          logger.debug(`[LOAD] ML API pagination limit reached at offset ${offset}`);
          
          // Aggressive strategy: try multiple offsets and orders to get more items
          if (offset >= 1000) {
            logger.debug(`[LOAD] Attempting aggressive strategy to get more items beyond pagination limit`);
            
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
                logger.debug(`[LOAD] Trying strategy: ${strategy.name} (offset=${strategy.offset}, order=${strategy.order})`);
                
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
                  logger.debug(`[LOAD] Strategy ${strategy.name} worked! Got ${alternativeResult.results.length} item IDs`);
                  
                  // Check which items already exist
                  const existingIds = await itemRepo.findExistingMlItemIds(globalSeller.id, alternativeResult.results);
                  const newItemIds = alternativeResult.results.filter(id => !existingIds.has(id));
                  
                  if (newItemIds.length > 0) {
                    logger.debug(`[LOAD] Found ${newItemIds.length} new items via strategy ${strategy.name}`);
                    
                    // Get item details using bulk endpoint (in chunks of 20)
                    const itemsDetails = await itemsService.getItemsBulk(
                      newItemIds,
                      globalSeller.ml_access_token
                    );
                    
                    // Process items
                    for (const result of itemsDetails) {
                      if (result.code === 200 && 'id' in result.body) {
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
                  logger.debug(`[LOAD] Strategy ${strategy.name} also hit pagination limit, skipping`);
                }
              } catch (altError) {
                logger.error(`[LOAD] Strategy ${strategy.name} failed:`, altError);
                // Continue with next strategy
              }
            }
            
            if (allItemsToSave.length > 0) {
              // Save all items in bulk
              await itemRepo.bulkUpsert(allItemsToSave);
              logger.debug(`[LOAD] Saved ${allItemsToSave.length} items via aggressive strategy`);
              
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
        
        logger.debug(`[LOAD] No results found for page ${page}, returning empty response`);
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

      logger.debug(`[LOAD] Got ${searchResult.results.length} item IDs from ML API`);

      // 2. Check which items already exist in database
      logger.debug(`[LOAD] Checking which items already exist in database...`);
      const existingIds = await itemRepo.findExistingMlItemIds(globalSeller.id, searchResult.results);
      logger.debug(`[LOAD] Found ${existingIds.size} items already in database out of ${searchResult.results.length} total`);

      // 3. Filter out items that already exist - only fetch details for new items
      const newItemIds = searchResult.results.filter(id => !existingIds.has(id));
      logger.debug(`[LOAD] Need to fetch details for ${newItemIds.length} new items (skipping ${existingIds.size} existing)`);

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
        logger.debug(`[LOAD] Got ${itemsDetails.length} item details from bulk API`);
      } else {
        logger.debug(`[LOAD] All items already exist in database, skipping API call`);
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
          logger.debug(`[LOAD] Attempting to save ${itemsToSave.length} items to database...`);
          await itemRepo.bulkUpsert(itemsToSave);
          savedCount = itemsToSave.length;
          logger.debug(`[LOAD] ✓ Saved ${savedCount} items to database for page ${page}`);
        } catch (dbError) {
          logger.error(`[LOAD] ✗ Error saving items to database:`, dbError);
          logger.error('[LOAD] DB Error details:', dbError instanceof Error ? dbError.message : String(dbError));
          logger.error('[LOAD] DB Error stack:', dbError instanceof Error ? dbError.stack : 'No stack trace');
          // Continue even if save fails, still return items
        }
      } else {
        logger.debug(`[LOAD] No items to save (itemsToSave.length = 0)`);
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

