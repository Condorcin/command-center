import { UserRepository } from '../repositories/user.repository';
import { SessionRepository } from '../repositories/session.repository';
import { hashPassword, verifyPassword, generateSessionId } from '../utils/crypto';
import { User } from '../db/schema';

const SESSION_DURATION_SECONDS = 7 * 24 * 60 * 60; // 7 days

export class AuthService {
  constructor(
    private userRepo: UserRepository,
    private sessionRepo: SessionRepository
  ) {}

  /**
   * Sign up a new user
   */
  async signup(email: string, password: string): Promise<{ user: User; sessionId: string }> {
    // Check if email already exists
    const exists = await this.userRepo.emailExists(email);
    if (exists) {
      throw new Error('Email already exists');
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Generate user ID
    const userId = crypto.randomUUID();

    // Create user
    const user = await this.userRepo.create(userId, email, passwordHash, 'operator');

    // Create session
    const sessionId = generateSessionId();
    const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS;
    await this.sessionRepo.create(sessionId, user.id, expiresAt);

    return { user, sessionId };
  }

  /**
   * Login a user
   */
  async login(email: string, password: string): Promise<{ user: User; sessionId: string }> {
    // Find user
    const user = await this.userRepo.findByEmail(email);
    if (!user) {
      throw new Error('Invalid email or password');
    }

    // Verify password
    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      throw new Error('Invalid email or password');
    }

    // Create session
    const sessionId = generateSessionId();
    const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS;
    await this.sessionRepo.create(sessionId, user.id, expiresAt);

    return { user, sessionId };
  }

  /**
   * Logout a user
   */
  async logout(sessionId: string): Promise<void> {
    await this.sessionRepo.delete(sessionId);
  }

  /**
   * Get user from session
   */
  async getUserFromSession(sessionId: string): Promise<User | null> {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session) {
      return null;
    }

    const user = await this.userRepo.findById(session.user_id);
    return user;
  }

  /**
   * Change user password
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    // Get user
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Verify current password
    const isValid = await verifyPassword(currentPassword, user.password_hash);
    if (!isValid) {
      throw new Error('Current password is incorrect');
    }

    // Hash new password
    const newPasswordHash = await hashPassword(newPassword);

    // Update password
    await this.userRepo.updatePassword(userId, newPasswordHash);
  }

  /**
   * Clean up expired sessions (can be called periodically)
   */
  async cleanupExpiredSessions(): Promise<void> {
    await this.sessionRepo.cleanupExpired();
  }
}

