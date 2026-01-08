import { Session } from '../db/schema';

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  exec(query: string): Promise<D1ExecResult>;
}

export class SessionRepository {
  constructor(private db: D1Database) {}

  /**
   * Find session by ID
   */
  async findById(sessionId: string): Promise<Session | null> {
    const result = await this.db
      .prepare('SELECT * FROM sessions WHERE id = ? AND expires_at > ?')
      .bind(sessionId, Math.floor(Date.now() / 1000))
      .first<Session>();

    return result || null;
  }

  /**
   * Create a new session
   */
  async create(
    sessionId: string,
    userId: string,
    expiresAt: number
  ): Promise<Session> {
    const now = Math.floor(Date.now() / 1000);

    await this.db
      .prepare(
        'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'
      )
      .bind(sessionId, userId, expiresAt, now)
      .run();

    const session = await this.findById(sessionId);
    if (!session) {
      throw new Error('Failed to create session');
    }

    return session;
  }

  /**
   * Delete a session
   */
  async delete(sessionId: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM sessions WHERE id = ?')
      .bind(sessionId)
      .run();
  }

  /**
   * Delete all sessions for a user
   */
  async deleteByUserId(userId: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM sessions WHERE user_id = ?')
      .bind(userId)
      .run();
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpired(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await this.db
      .prepare('DELETE FROM sessions WHERE expires_at <= ?')
      .bind(now)
      .run();
  }
}

