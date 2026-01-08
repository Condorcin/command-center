import { getCookie } from '../utils/cookies';
import { AuthService } from '../services/auth.service';
import { User } from '../db/schema';

export interface AuthenticatedRequest extends Request {
  user?: User;
}

export interface Env {
  DB: D1Database;
}

/**
 * Middleware to authenticate requests
 * Adds user to request if session is valid
 */
export async function authMiddleware(
  request: Request,
  env: Env,
  authService: AuthService
): Promise<User | null> {
  const sessionId = getCookie(request, 'session_id');
  
  if (!sessionId) {
    return null;
  }

  const user = await authService.getUserFromSession(sessionId);
  return user;
}

/**
 * Require authentication - throws if user is not authenticated
 */
export async function requireAuth(
  request: Request,
  env: Env,
  authService: AuthService
): Promise<User> {
  const user = await authMiddleware(request, env, authService);
  
  if (!user) {
    throw new Error('Unauthorized');
  }
  
  return user;
}

