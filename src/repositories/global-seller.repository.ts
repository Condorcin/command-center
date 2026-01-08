import { GlobalSeller } from '../db/schema';

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  exec(query: string): Promise<D1ExecResult>;
}

export class GlobalSellerRepository {
  constructor(private db: D1Database) {}

  /**
   * Find all global sellers for a user
   */
  async findByUserId(userId: string): Promise<GlobalSeller[]> {
    const result = await this.db
      .prepare('SELECT * FROM global_sellers WHERE user_id = ? ORDER BY created_at DESC')
      .bind(userId)
      .all<GlobalSeller>();

    return result.results || [];
  }

  /**
   * Find global seller by ID
   */
  async findById(id: string): Promise<GlobalSeller | null> {
    const result = await this.db
      .prepare('SELECT * FROM global_sellers WHERE id = ?')
      .bind(id)
      .first<GlobalSeller>();

    return result || null;
  }

  /**
   * Find global seller by ML User ID and User ID
   */
  async findByMLUserId(userId: string, mlUserId: string): Promise<GlobalSeller | null> {
    const result = await this.db
      .prepare('SELECT * FROM global_sellers WHERE user_id = ? AND ml_user_id = ?')
      .bind(userId, mlUserId)
      .first<GlobalSeller>();

    return result || null;
  }

  /**
   * Create a new global seller
   */
  async create(
    id: string,
    userId: string,
    mlUserId: string,
    mlAccessToken: string,
    name?: string
  ): Promise<GlobalSeller> {
    const now = Math.floor(Date.now() / 1000);

    await this.db
      .prepare(
        'INSERT INTO global_sellers (id, user_id, ml_user_id, ml_access_token, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(id, userId, mlUserId, mlAccessToken, name || null, now, now)
      .run();

    const globalSeller = await this.findById(id);
    if (!globalSeller) {
      throw new Error('Failed to create global seller');
    }

    return globalSeller;
  }

  /**
   * Update a global seller
   */
  async update(
    id: string,
    mlUserId: string,
    mlAccessToken: string,
    name?: string
  ): Promise<GlobalSeller> {
    const now = Math.floor(Date.now() / 1000);

    await this.db
      .prepare(
        'UPDATE global_sellers SET ml_user_id = ?, ml_access_token = ?, name = ?, updated_at = ? WHERE id = ?'
      )
      .bind(mlUserId, mlAccessToken, name || null, now, id)
      .run();

    const globalSeller = await this.findById(id);
    if (!globalSeller) {
      throw new Error('Failed to update global seller');
    }

    return globalSeller;
  }

  /**
   * Delete a global seller
   */
  async delete(id: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM global_sellers WHERE id = ?')
      .bind(id)
      .run();
  }

  /**
   * Check if user owns the global seller
   */
  async userOwnsGlobalSeller(userId: string, globalSellerId: string): Promise<boolean> {
    const result = await this.db
      .prepare('SELECT 1 FROM global_sellers WHERE id = ? AND user_id = ? LIMIT 1')
      .bind(globalSellerId, userId)
      .first();

    return result !== null;
  }
}

