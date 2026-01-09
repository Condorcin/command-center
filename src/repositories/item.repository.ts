import { Item } from '../db/schema';
import { logger } from '../utils/logger';

export class ItemRepository {
  constructor(private db: D1Database) {}

  /**
   * Create or update an item (upsert)
   */
  async upsert(item: Omit<Item, 'created_at' | 'updated_at'> & { metadata?: any }): Promise<Item> {
    const now = Math.floor(Date.now() / 1000);
    
    // Check if item exists
    const existing = await this.db
      .prepare('SELECT id FROM items WHERE global_seller_id = ? AND ml_item_id = ?')
      .bind(item.global_seller_id, item.ml_item_id)
      .first<{ id: string }>();

    if (existing) {
      // Update existing
      const metadataJson = item.metadata ? JSON.stringify(item.metadata) : null;
      await this.db
        .prepare(`
          UPDATE items SET
            site_id = ?,
            title = ?,
            price = ?,
            currency_id = ?,
            available_quantity = ?,
            sold_quantity = ?,
            status = ?,
            listing_type_id = ?,
            condition = ?,
            permalink = ?,
            thumbnail = ?,
            category_id = ?,
            start_time = ?,
            stop_time = ?,
            end_time = ?,
            updated_at = ?,
            synced_at = ?,
            metadata = ?
          WHERE id = ?
        `)
        .bind(
          item.site_id,
          item.title,
          item.price,
          item.currency_id,
          item.available_quantity,
          item.sold_quantity,
          item.status,
          item.listing_type_id,
          item.condition,
          item.permalink,
          item.thumbnail,
          item.category_id,
          item.start_time,
          item.stop_time,
          item.end_time,
          now,
          now,
          metadataJson,
          existing.id
        )
        .run();

      return await this.findById(existing.id) as Item;
    } else {
      // Insert new
      const id = crypto.randomUUID();
      const metadataJson = item.metadata ? JSON.stringify(item.metadata) : null;
      await this.db
        .prepare(`
          INSERT INTO items (
            id, global_seller_id, ml_item_id, site_id, title, price, currency_id,
            available_quantity, sold_quantity, status, listing_type_id, condition,
            permalink, thumbnail, category_id, start_time, stop_time, end_time,
            created_at, updated_at, synced_at, metadata
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          id,
          item.global_seller_id,
          item.ml_item_id,
          item.site_id,
          item.title,
          item.price,
          item.currency_id,
          item.available_quantity,
          item.sold_quantity,
          item.status,
          item.listing_type_id,
          item.condition,
          item.permalink,
          item.thumbnail,
          item.category_id,
          item.start_time,
          item.stop_time,
          item.end_time,
          now,
          now,
          now,
          metadataJson
        )
        .run();

      return await this.findById(id) as Item;
    }
  }

  /**
   * Find item by ID
   */
  async findById(id: string): Promise<Item | null> {
    const result = await this.db
      .prepare('SELECT * FROM items WHERE id = ?')
      .bind(id)
      .first<Item>();

    return result || null;
  }

  /**
   * Find item by ML item ID and global seller ID
   */
  async findByMlItemId(globalSellerId: string, mlItemId: string): Promise<Item | null> {
    const result = await this.db
      .prepare('SELECT * FROM items WHERE global_seller_id = ? AND ml_item_id = ?')
      .bind(globalSellerId, mlItemId)
      .first<Item>();

    return result || null;
  }

  /**
   * Check which ML item IDs already exist in database for a global seller
   * Returns a Set of existing ml_item_ids
   */
  async findExistingMlItemIds(globalSellerId: string, mlItemIds: string[]): Promise<Set<string>> {
    if (mlItemIds.length === 0) {
      return new Set();
    }

    // Query in batches to avoid SQL parameter limits
    const batchSize = 100;
    const existingIds = new Set<string>();

    for (let i = 0; i < mlItemIds.length; i += batchSize) {
      const batch = mlItemIds.slice(i, i + batchSize);
      const placeholders = batch.map(() => '?').join(',');
      
      const query = `SELECT ml_item_id FROM items WHERE global_seller_id = ? AND ml_item_id IN (${placeholders})`;
      const stmt = this.db.prepare(query);
      const bindings = [globalSellerId, ...batch];
      
      const results = await stmt.bind(...bindings).all<{ ml_item_id: string }>();
      
      if (results.results) {
        results.results.forEach(row => {
          existingIds.add(row.ml_item_id);
        });
      }
    }

    return existingIds;
  }

  /**
   * Find all items for a global seller with filters
   */
  async findByGlobalSellerId(
    globalSellerId: string,
    options: {
      status?: 'active' | 'paused' | 'closed';
      search?: string;
      limit?: number;
      offset?: number;
      orderBy?: 'title' | 'price' | 'updated_at' | 'start_time' | 'synced_at';
      orderDir?: 'ASC' | 'DESC';
    } = {}
  ): Promise<{ items: Item[]; total: number }> {
    const {
      status,
      search,
      limit = 50,
      offset = 0,
      orderBy = 'updated_at',
      orderDir = 'DESC',
    } = options;

    let whereClause = 'global_seller_id = ?';
    const bindings: any[] = [globalSellerId];

    if (status) {
      whereClause += ' AND status = ?';
      bindings.push(status);
    }

    if (search) {
      whereClause += ' AND (title LIKE ? OR ml_item_id LIKE ?)';
      const searchTerm = `%${search}%`;
      bindings.push(searchTerm, searchTerm);
    }

    // Get total count
    const countResult = await this.db
      .prepare(`SELECT COUNT(*) as total FROM items WHERE ${whereClause}`)
      .bind(...bindings)
      .first<{ total: number }>();

    const total = countResult?.total || 0;

    // Get items
    const validOrderBy = ['title', 'price', 'updated_at', 'start_time', 'synced_at'].includes(orderBy)
      ? orderBy
      : 'updated_at';
    const validOrderDir = orderDir === 'ASC' ? 'ASC' : 'DESC';

    // Use a very high limit if limit is very large (to get all items)
    const effectiveLimit = limit > 1000 ? 50000 : limit;
    
    const items = await this.db
      .prepare(
        `SELECT * FROM items WHERE ${whereClause} ORDER BY ${validOrderBy} ${validOrderDir} LIMIT ? OFFSET ?`
      )
      .bind(...bindings, effectiveLimit, offset)
      .all<Item>();

    return {
      items: items.results || [],
      total,
    };
  }

  /**
   * Get count by status for a global seller
   */
  async getCountByStatus(globalSellerId: string): Promise<{
    active: number;
    paused: number;
    closed: number;
    total: number;
  }> {
    const result = await this.db
      .prepare(`
        SELECT 
          status,
          COUNT(*) as count
        FROM items
        WHERE global_seller_id = ?
        GROUP BY status
      `)
      .bind(globalSellerId)
      .all<{ status: string; count: number }>();

    const counts = {
      active: 0,
      paused: 0,
      closed: 0,
      total: 0,
    };

    for (const row of result.results || []) {
      const count = row.count || 0;
      counts.total += count;
      
      if (row.status === 'active') counts.active = count;
      else if (row.status === 'paused') counts.paused = count;
      else if (row.status === 'closed') counts.closed = count;
    }

    return counts;
  }

  /**
   * Delete items for a global seller
   */
  async deleteByGlobalSellerId(globalSellerId: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM items WHERE global_seller_id = ?')
      .bind(globalSellerId)
      .run();
  }

  /**
   * Delete items that are no longer in ML (cleanup)
   */
  async deleteNotInList(globalSellerId: string, mlItemIds: string[]): Promise<void> {
    if (mlItemIds.length === 0) return;

    // Create placeholders for IN clause
    const placeholders = mlItemIds.map(() => '?').join(',');
    
    await this.db
      .prepare(`DELETE FROM items WHERE global_seller_id = ? AND ml_item_id NOT IN (${placeholders})`)
      .bind(globalSellerId, ...mlItemIds)
      .run();
  }

  /**
   * Bulk upsert items
   */
  async bulkUpsert(items: (Omit<Item, 'created_at' | 'updated_at'> & { metadata?: any })[]): Promise<void> {
    if (items.length === 0) return;

    const now = Math.floor(Date.now() / 1000);

    // Use batch for better performance
    // Note: SQLite ON CONFLICT can use the index name or column names
    const stmt = this.db.prepare(`
      INSERT INTO items (
        id, global_seller_id, ml_item_id, site_id, title, price, currency_id,
        available_quantity, sold_quantity, status, listing_type_id, condition,
        permalink, thumbnail, category_id, start_time, stop_time, end_time,
        created_at, updated_at, synced_at, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(global_seller_id, ml_item_id) DO UPDATE SET
        site_id = excluded.site_id,
        title = excluded.title,
        price = excluded.price,
        currency_id = excluded.currency_id,
        available_quantity = excluded.available_quantity,
        sold_quantity = excluded.sold_quantity,
        status = excluded.status,
        listing_type_id = excluded.listing_type_id,
        condition = excluded.condition,
        permalink = excluded.permalink,
        thumbnail = excluded.thumbnail,
        category_id = excluded.category_id,
        start_time = excluded.start_time,
        stop_time = excluded.stop_time,
        end_time = excluded.end_time,
        updated_at = excluded.updated_at,
        synced_at = excluded.synced_at,
        metadata = excluded.metadata
    `);

    const batch = items.map(item => {
      const id = crypto.randomUUID();
      const metadataJson = item.metadata ? JSON.stringify(item.metadata) : null;
      return stmt.bind(
        id,
        item.global_seller_id,
        item.ml_item_id,
        item.site_id,
        item.title,
        item.price,
        item.currency_id,
        item.available_quantity,
        item.sold_quantity,
        item.status,
        item.listing_type_id,
        item.condition,
        item.permalink,
        item.thumbnail,
        item.category_id,
        item.start_time,
        item.stop_time,
        item.end_time,
        now,
        now,
        now,
        metadataJson
      );
    });

    try {
      await this.db.batch(batch);
      logger.debug(`Successfully saved ${items.length} items to database`);
    } catch (error) {
      logger.error(`Error in bulkUpsert for ${items.length} items:`, error);
      // Re-throw to let caller handle it
      throw error;
    }
  }
}

