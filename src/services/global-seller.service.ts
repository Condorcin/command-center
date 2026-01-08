import { GlobalSellerRepository } from '../repositories/global-seller.repository';
import { GlobalSeller } from '../db/schema';

export class GlobalSellerService {
  constructor(private globalSellerRepo: GlobalSellerRepository) {}

  /**
   * Get all global sellers for a user
   */
  async getByUserId(userId: string): Promise<GlobalSeller[]> {
    return await this.globalSellerRepo.findByUserId(userId);
  }

  /**
   * Get a global seller by ID
   */
  async getById(id: string): Promise<GlobalSeller | null> {
    return await this.globalSellerRepo.findById(id);
  }

  /**
   * Create a new global seller
   */
  async create(
    userId: string,
    mlUserId: string,
    mlAccessToken: string,
    name?: string
  ): Promise<GlobalSeller> {
    // Validate inputs
    if (!mlUserId || !mlUserId.trim()) {
      throw new Error('Mercado Libre User ID is required');
    }

    if (!mlAccessToken || !mlAccessToken.trim()) {
      throw new Error('Mercado Libre Access Token is required');
    }

    // Check if ML User ID already exists for this user
    const existing = await this.globalSellerRepo.findByMLUserId(userId, mlUserId.trim());
    if (existing) {
      throw new Error('A Global Seller with this Mercado Libre User ID already exists');
    }

    // Generate ID
    const id = crypto.randomUUID();

    // Create global seller
    return await this.globalSellerRepo.create(
      id,
      userId,
      mlUserId.trim(),
      mlAccessToken.trim(),
      name?.trim() || null
    );
  }

  /**
   * Update a global seller
   */
  async update(
    id: string,
    userId: string,
    mlUserId: string,
    mlAccessToken: string,
    name?: string
  ): Promise<GlobalSeller> {
    // Verify ownership
    const owns = await this.globalSellerRepo.userOwnsGlobalSeller(userId, id);
    if (!owns) {
      throw new Error('Global Seller not found or access denied');
    }

    // Validate inputs
    if (!mlUserId || !mlUserId.trim()) {
      throw new Error('Mercado Libre User ID is required');
    }

    if (!mlAccessToken || !mlAccessToken.trim()) {
      throw new Error('Mercado Libre Access Token is required');
    }

    // Check if ML User ID already exists for another global seller of this user
    const existing = await this.globalSellerRepo.findByMLUserId(userId, mlUserId.trim());
    if (existing && existing.id !== id) {
      throw new Error('A Global Seller with this Mercado Libre User ID already exists');
    }

    // Update global seller
    return await this.globalSellerRepo.update(id, mlUserId.trim(), mlAccessToken.trim(), name?.trim() || null);
  }

  /**
   * Delete a global seller
   */
  async delete(id: string, userId: string): Promise<void> {
    // Verify ownership
    const owns = await this.globalSellerRepo.userOwnsGlobalSeller(userId, id);
    if (!owns) {
      throw new Error('Global Seller not found or access denied');
    }

    await this.globalSellerRepo.delete(id);
  }
}

