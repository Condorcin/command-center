import { AuthService } from '../services/auth.service';
import { UserRepository } from '../repositories/user.repository';
import { SessionRepository } from '../repositories/session.repository';
import { validateSignup, validateLogin, validateChangePassword } from '../utils/validation';
import { successResponse, errorResponse, handleError } from '../utils/response';
import { setCookie, deleteCookie, getCookie } from '../utils/cookies';
import { requireAuth } from '../middlewares/auth';

export interface Env {
  DB: D1Database;
}

/**
 * POST /auth/signup
 */
export async function signupHandler(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json();
    const { email, password } = validateSignup(body);

    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);

    const { user, sessionId } = await authService.signup(email, password);

    // Remove password_hash from response
    const { password_hash, ...userWithoutPassword } = user;

    const response = successResponse({
      user: userWithoutPassword,
    });

    // Set session cookie
    const cookie = setCookie('session_id', sessionId, {
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });
    response.headers.set('Set-Cookie', cookie);

    return response;
  } catch (error) {
    return handleError(error);
  }
}

/**
 * POST /auth/login
 */
export async function loginHandler(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json();
    const { email, password } = validateLogin(body);

    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);

    const { user, sessionId } = await authService.login(email, password);

    // Remove password_hash from response
    const { password_hash, ...userWithoutPassword } = user;

    const response = successResponse({
      user: userWithoutPassword,
    });

    // Set session cookie
    const cookie = setCookie('session_id', sessionId, {
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });
    response.headers.set('Set-Cookie', cookie);

    return response;
  } catch (error) {
    return handleError(error);
  }
}

/**
 * POST /auth/logout
 */
export async function logoutHandler(request: Request, env: Env): Promise<Response> {
  try {
    const sessionId = getCookie(request, 'session_id');

    if (sessionId) {
      const sessionRepo = new SessionRepository(env.DB);
      await sessionRepo.delete(sessionId);
    }

    const response = successResponse({ message: 'Logged out successfully' });

    // Delete session cookie
    const cookie = deleteCookie('session_id');
    response.headers.set('Set-Cookie', cookie);

    return response;
  } catch (error) {
    return handleError(error);
  }
}

/**
 * GET /auth/me
 */
export async function meHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);

    const user = await requireAuth(request, env, authService);

    // Remove password_hash from response
    const { password_hash, ...userWithoutPassword } = user;

    return successResponse({
      user: userWithoutPassword,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return handleError(error);
  }
}

/**
 * POST /auth/change-password
 */
export async function changePasswordHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);

    // Require authentication
    const user = await requireAuth(request, env, authService);

    // Validate request body
    const body = await request.json();
    const { currentPassword, newPassword } = validateChangePassword(body);

    // Change password
    await authService.changePassword(user.id, currentPassword, newPassword);

    return successResponse({ message: 'Password changed successfully' });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    }
    if (error instanceof Error && error.message === 'Current password is incorrect') {
      return errorResponse('Current password is incorrect', 400, 'INVALID_PASSWORD');
    }
    return handleError(error);
  }
}

