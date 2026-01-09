import { requireAuth } from '../middlewares/auth';
import { GlobalSellerService } from '../services/global-seller.service';
import { GlobalSellerRepository } from '../repositories/global-seller.repository';
import { MercadoLibreAPIService } from '../services/mercado-libre-api.service';
import { UserRepository } from '../repositories/user.repository';
import { SessionRepository } from '../repositories/session.repository';
import { AuthService } from '../services/auth.service';
import { validateMercadoLibreCredentials } from '../utils/validation';
import { successResponse, errorResponse, handleError } from '../utils/response';

export interface Env {
  DB: D1Database;
}

/**
 * GET /api/global-sellers
 * Get all global sellers for the authenticated user
 */
export async function getGlobalSellersHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const globalSellerRepo = new GlobalSellerRepository(env.DB);
    const mlAPIService = new MercadoLibreAPIService();
    const globalSellerService = new GlobalSellerService(globalSellerRepo, mlAPIService);

    const user = await requireAuth(request, env, authService);

    const globalSellers = await globalSellerService.getByUserId(user.id);

    // Remove access tokens from response
    const safeGlobalSellers = globalSellers.map(({ ml_access_token, ...rest }) => rest);

    return successResponse({ globalSellers: safeGlobalSellers });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return handleError(error);
  }
}

/**
 * GET /api/global-sellers/:id
 * Get a global seller by ID
 */
export async function getGlobalSellerByIdHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const globalSellerRepo = new GlobalSellerRepository(env.DB);
    const mlAPIService = new MercadoLibreAPIService();
    const globalSellerService = new GlobalSellerService(globalSellerRepo, mlAPIService);

    const user = await requireAuth(request, env, authService);

    const url = new URL(request.url);
    const id = url.pathname.split('/').pop();

    if (!id) {
      return errorResponse('Global Seller ID is required', 400, 'MISSING_ID');
    }

    const globalSeller = await globalSellerService.getById(id);

    if (!globalSeller) {
      return errorResponse('Global Seller not found', 404, 'NOT_FOUND');
    }

    // Verify ownership
    if (globalSeller.user_id !== user.id) {
      return errorResponse('Access denied', 403, 'FORBIDDEN');
    }

    // Remove access token from response
    const { ml_access_token, ...safeGlobalSeller } = globalSeller;

    return successResponse({ globalSeller: safeGlobalSeller });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return handleError(error);
  }
}

/**
 * POST /api/global-sellers
 * Create a new global seller
 */
export async function createGlobalSellerHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const globalSellerRepo = new GlobalSellerRepository(env.DB);
    const mlAPIService = new MercadoLibreAPIService();
    const globalSellerService = new GlobalSellerService(globalSellerRepo, mlAPIService);

    const user = await requireAuth(request, env, authService);

    const body = await request.json();
    const { mlUserId, mlAccessToken } = validateMercadoLibreCredentials(body);

    const globalSeller = await globalSellerService.create(
      user.id,
      mlUserId,
      mlAccessToken
    );

    // Remove access token from response
    const { ml_access_token, ...safeGlobalSeller } = globalSeller;

    return successResponse({ globalSeller: safeGlobalSeller });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return handleError(error);
  }
}

/**
 * PUT /api/global-sellers/:id
 * Update a global seller
 */
export async function updateGlobalSellerHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const globalSellerRepo = new GlobalSellerRepository(env.DB);
    const mlAPIService = new MercadoLibreAPIService();
    const globalSellerService = new GlobalSellerService(globalSellerRepo, mlAPIService);

    const user = await requireAuth(request, env, authService);

    const url = new URL(request.url);
    const id = url.pathname.split('/').pop();

    if (!id) {
      return errorResponse('Global Seller ID is required', 400, 'MISSING_ID');
    }

    const body = await request.json();
    const { mlUserId, mlAccessToken } = validateMercadoLibreCredentials(body);

    const globalSeller = await globalSellerService.update(
      id,
      user.id,
      mlUserId,
      mlAccessToken
    );

    // Remove access token from response
    const { ml_access_token, ...safeGlobalSeller } = globalSeller;

    return successResponse({ globalSeller: safeGlobalSeller });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return handleError(error);
  }
}

/**
 * DELETE /api/global-sellers/:id
 * Delete a global seller
 */
export async function deleteGlobalSellerHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const globalSellerRepo = new GlobalSellerRepository(env.DB);
    const mlAPIService = new MercadoLibreAPIService();
    const globalSellerService = new GlobalSellerService(globalSellerRepo, mlAPIService);

    const user = await requireAuth(request, env, authService);

    const url = new URL(request.url);
    const id = url.pathname.split('/').pop();

    if (!id) {
      return errorResponse('Global Seller ID is required', 400, 'MISSING_ID');
    }

    await globalSellerService.delete(id, user.id);

    return successResponse({ message: 'Global Seller deleted successfully' });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return handleError(error);
  }
}




