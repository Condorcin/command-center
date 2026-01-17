import { MarketplaceItem } from '../db/schema';
import { logger } from '../utils/logger';

export class MarketplaceItemRepository {
  constructor(private db: D1Database) {}

  /**
   * Upsert marketplace items for an item (CBT)
   * Deletes existing marketplace items for the item and inserts new ones
   */
  async upsertMarketplaceItems(
    itemId: string,
    globalSellerId: string,
    cbtId: string,
    marketplaceItems: Array<{
      item_id: string; // The marketplace item ID (e.g., MLC1818643789)
      site_id: string; // The country site (e.g., MLC, MCO, MLB, MLM)
      date_created: string; // ISO date string
    }>
  ): Promise<void> {
    const now = Math.floor(Date.now() / 1000);

    // Delete existing marketplace items for this item
    await this.db
      .prepare('DELETE FROM marketplace_items WHERE item_id = ?')
      .bind(itemId)
      .run();

    if (marketplaceItems.length === 0) {
// logger.debug(`No marketplace items to save for item ${itemId}`);
      return;
    }

    // Insert new marketplace items
    const stmt = this.db.prepare(`
      INSERT INTO marketplace_items (
        id, item_id, global_seller_id, ml_item_id, site_id, date_created,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const batch = marketplaceItems.map(mi => {
      const id = crypto.randomUUID();
      return stmt.bind(
        id,
        itemId,
        globalSellerId,
        mi.item_id,
        mi.site_id,
        mi.date_created,
        now,
        now
      );
    });

    try {
      await this.db.batch(batch);
// logger.debug(`Saved ${marketplaceItems.length} marketplace items for item ${itemId}`);
    } catch (error) {
      logger.error(`Error saving marketplace items for item ${itemId}:`, error);
      throw error;
    }
  }

  /**
   * Get all marketplace items for an item (CBT)
   */
  async findByItemId(itemId: string): Promise<MarketplaceItem[]> {
    const results = await this.db
      .prepare('SELECT * FROM marketplace_items WHERE item_id = ? ORDER BY site_id')
      .bind(itemId)
      .all<MarketplaceItem>();

    return results.results || [];
  }

  /**
   * Get all marketplace items for a global seller
   */
  async findByGlobalSellerId(globalSellerId: string): Promise<MarketplaceItem[]> {
    const results = await this.db
      .prepare('SELECT * FROM marketplace_items WHERE global_seller_id = ? ORDER BY site_id')
      .bind(globalSellerId)
      .all<MarketplaceItem>();

    return results.results || [];
  }

  /**
   * Get marketplace items by CBT ID (ml_item_id)
   */
  async findByCbtId(globalSellerId: string, cbtId: string): Promise<MarketplaceItem[]> {
    // First, find the item by CBT ID
    const item = await this.db
      .prepare('SELECT id FROM items WHERE global_seller_id = ? AND ml_item_id = ?')
      .bind(globalSellerId, cbtId)
      .first<{ id: string }>();

    if (!item) {
      return [];
    }

    return this.findByItemId(item.id);
  }

  /**
   * Delete marketplace items for an item
   */
  async deleteByItemId(itemId: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM marketplace_items WHERE item_id = ?')
      .bind(itemId)
      .run();
  }

  /**
   * Delete all marketplace items for a global seller
   */
  async deleteByGlobalSellerId(globalSellerId: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM marketplace_items WHERE global_seller_id = ?')
      .bind(globalSellerId)
      .run();
  }

  /**
   * Update performance data for a marketplace item by ml_item_id
   */
  async updatePerformance(
    mlItemId: string,
    performance: {
      score: number;
      level: string;
      level_wording: string;
      calculated_at: string;
      data: string; // JSON string
    }
  ): Promise<void> {
    const now = Math.floor(Date.now() / 1000);

    await this.db
      .prepare(`
        UPDATE marketplace_items 
        SET performance_score = ?,
            performance_level = ?,
            performance_level_wording = ?,
            performance_calculated_at = ?,
            performance_data = ?,
            updated_at = ?
        WHERE ml_item_id = ?
      `)
      .bind(
        performance.score,
        performance.level,
        performance.level_wording,
        performance.calculated_at,
        performance.data,
        now,
        mlItemId
      )
      .run();

// logger.debug(`Updated performance for marketplace item ${mlItemId}: score=${performance.score}, level=${performance.level}`);
  }

  /**
   * Get marketplace item by ml_item_id
   */
  async findByMlItemId(mlItemId: string): Promise<MarketplaceItem | null> {
    const result = await this.db
      .prepare('SELECT * FROM marketplace_items WHERE ml_item_id = ?')
      .bind(mlItemId)
      .first<MarketplaceItem>();

    return result || null;
  }
}
