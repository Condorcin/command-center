import { User } from '../db/schema';

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  exec(query: string): Promise<D1ExecResult>;
}

export class UserRepository {
  constructor(private db: D1Database) {}

  /**
   * Find user by email
   */
  async findByEmail(email: string): Promise<User | null> {
    const result = await this.db
      .prepare('SELECT * FROM users WHERE email = ?')
      .bind(email)
      .first<User>();

    return result || null;
  }

  /**
   * Find user by ID
   */
  async findById(id: string): Promise<User | null> {
    const result = await this.db
      .prepare('SELECT * FROM users WHERE id = ?')
      .bind(id)
      .first<User>();

    return result || null;
  }

  /**
   * Create a new user
   */
  async create(
    id: string,
    email: string,
    passwordHash: string,
    role: string = 'operator'
  ): Promise<User> {
    const now = Math.floor(Date.now() / 1000);

    await this.db
      .prepare(
        'INSERT INTO users (id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .bind(id, email, passwordHash, role, now)
      .run();

    const user = await this.findById(id);
    if (!user) {
      throw new Error('Failed to create user');
    }

    return user;
  }

  /**
   * Check if email exists
   */
  async emailExists(email: string): Promise<boolean> {
    const result = await this.db
      .prepare('SELECT 1 FROM users WHERE email = ? LIMIT 1')
      .bind(email)
      .first();

    return result !== null;
  }

  /**
   * Update user password
   */
  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.db
      .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .bind(passwordHash, userId)
      .run();
  }

  /**
   * Update Mercado Libre credentials
   */
  async updateMercadoLibreCredentials(
    userId: string,
    mlUserId: string,
    mlAccessToken: string
  ): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await this.db
      .prepare(
        'UPDATE users SET ml_user_id = ?, ml_access_token = ?, ml_updated_at = ? WHERE id = ?'
      )
      .bind(mlUserId, mlAccessToken, now, userId)
      .run();
  }

  /**
   * Clear Mercado Libre credentials
   */
  async clearMercadoLibreCredentials(userId: string): Promise<void> {
    await this.db
      .prepare(
        'UPDATE users SET ml_user_id = NULL, ml_access_token = NULL, ml_updated_at = NULL WHERE id = ?'
      )
      .bind(userId)
      .run();
  }
}

