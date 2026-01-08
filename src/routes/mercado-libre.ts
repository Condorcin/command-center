import { requireAuth } from '../middlewares/auth';
import { MercadoLibreService } from '../services/mercado-libre.service';
import { UserRepository } from '../repositories/user.repository';
import { validateMercadoLibreCredentials } from '../utils/validation';
import { successResponse, errorResponse, handleError } from '../utils/response';

export interface Env {
  DB: D1Database;
}

/**
 * POST /api/mercado-libre/credentials
 * Save or update Mercado Libre credentials
 */
export async function saveCredentialsHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const mlService = new MercadoLibreService(userRepo);
    const { SessionRepository } = await import('../repositories/session.repository');
    const { AuthService } = await import('../services/auth.service');

    // Require authentication
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const user = await requireAuth(request, env, authService);

    // Validate request body
    const body = await request.json();
    const { mlUserId, mlAccessToken } = validateMercadoLibreCredentials(body);

    // Save credentials
    await mlService.saveCredentials(user.id, mlUserId, mlAccessToken);

    return successResponse({ message: 'Mercado Libre credentials saved successfully' });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return handleError(error);
  }
}

/**
 * DELETE /api/mercado-libre/credentials
 * Clear Mercado Libre credentials
 */
export async function clearCredentialsHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const mlService = new MercadoLibreService(userRepo);
    const { SessionRepository } = await import('../repositories/session.repository');
    const { AuthService } = await import('../services/auth.service');

    // Require authentication
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const user = await requireAuth(request, env, authService);

    // Clear credentials
    await mlService.clearCredentials(user.id);

    return successResponse({ message: 'Mercado Libre credentials cleared successfully' });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return handleError(error);
  }
}

/**
 * GET /api/mercado-libre/credentials
 * Get Mercado Libre credentials status (without exposing the token)
 */
export async function getCredentialsStatusHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const { SessionRepository } = await import('../repositories/session.repository');
    const { AuthService } = await import('../services/auth.service');

    // Require authentication
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const user = await requireAuth(request, env, authService);

    // Return status without exposing the token
    return successResponse({
      hasCredentials: !!(user.ml_user_id && user.ml_access_token),
      mlUserId: user.ml_user_id || null,
      updatedAt: user.ml_updated_at || null,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return handleError(error);
  }
}

