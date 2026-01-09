import { GlobalSellerRepository } from '../repositories/global-seller.repository';
import { MercadoLibreAPIService } from './mercado-libre-api.service';
import { GlobalSeller } from '../db/schema';

export class GlobalSellerService {
  constructor(
    private globalSellerRepo: GlobalSellerRepository,
    private mlAPIService: MercadoLibreAPIService
  ) {}

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
    mlAccessToken: string
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

    // Fetch information from Mercado Libre API
    let mlInfo = null;
    let name = null;
    try {
      const userInfo = await this.mlAPIService.getUserInfo(mlAccessToken.trim());
      
      // Build name from first_name and last_name
      name = userInfo.full_name || `${userInfo.first_name} ${userInfo.last_name}`.trim() || userInfo.nickname;
      
      mlInfo = {
        nickname: userInfo.nickname,
        email: userInfo.email,
        first_name: userInfo.first_name,
        last_name: userInfo.last_name,
        country_id: userInfo.country_id,
        site_id: userInfo.site_id,
        registration_date: userInfo.registration_date,
        phone: userInfo.phone,
        address: userInfo.address,
        city: userInfo.city,
        state: userInfo.state,
        zip_code: userInfo.zip_code,
        tax_id: userInfo.tax_id,
        corporate_name: userInfo.corporate_name,
        brand_name: userInfo.brand_name,
        seller_experience: userInfo.seller_experience,
      };
    } catch (error) {
      // If API call fails, still create the global seller but without ML info
      console.error('Failed to fetch ML user info:', error);
      throw new Error(`Failed to fetch user information from Mercado Libre: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Generate ID
    const id = crypto.randomUUID();

    // Create global seller with ML information
    return await this.globalSellerRepo.create(
      id,
      userId,
      mlUserId.trim(),
      mlAccessToken.trim(),
      name,
      mlInfo
    );
  }

  /**
   * Update a global seller
   */
  async update(
    id: string,
    userId: string,
    mlUserId: string,
    mlAccessToken: string
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

    // Fetch updated information from Mercado Libre API
    let mlInfo = null;
    let name = null;
    try {
      const userInfo = await this.mlAPIService.getUserInfo(mlAccessToken.trim());
      
      // Build name from first_name and last_name
      name = userInfo.full_name || `${userInfo.first_name} ${userInfo.last_name}`.trim() || userInfo.nickname;
      
      mlInfo = {
        nickname: userInfo.nickname,
        email: userInfo.email,
        first_name: userInfo.first_name,
        last_name: userInfo.last_name,
        country_id: userInfo.country_id,
        site_id: userInfo.site_id,
        registration_date: userInfo.registration_date,
        phone: userInfo.phone,
        address: userInfo.address,
        city: userInfo.city,
        state: userInfo.state,
        zip_code: userInfo.zip_code,
        tax_id: userInfo.tax_id,
        corporate_name: userInfo.corporate_name,
        brand_name: userInfo.brand_name,
        seller_experience: userInfo.seller_experience,
      };
    } catch (error) {
      // If API call fails, still update the global seller but without ML info
      console.error('Failed to fetch ML user info:', error);
      throw new Error(`Failed to fetch user information from Mercado Libre: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Update global seller with ML information
    return await this.globalSellerRepo.update(id, mlUserId.trim(), mlAccessToken.trim(), name, mlInfo);
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




