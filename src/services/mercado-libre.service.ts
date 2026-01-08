import { UserRepository } from '../repositories/user.repository';

export class MercadoLibreService {
  constructor(private userRepo: UserRepository) {}

  /**
   * Save Mercado Libre credentials for a user
   */
  async saveCredentials(
    userId: string,
    mlUserId: string,
    mlAccessToken: string
  ): Promise<void> {
    // Validate that mlUserId is not empty
    if (!mlUserId || !mlUserId.trim()) {
      throw new Error('Mercado Libre User ID is required');
    }

    // Validate that access token is not empty
    if (!mlAccessToken || !mlAccessToken.trim()) {
      throw new Error('Mercado Libre Access Token is required');
    }

    await this.userRepo.updateMercadoLibreCredentials(
      userId,
      mlUserId.trim(),
      mlAccessToken.trim()
    );
  }

  /**
   * Clear Mercado Libre credentials for a user
   */
  async clearCredentials(userId: string): Promise<void> {
    await this.userRepo.clearMercadoLibreCredentials(userId);
  }

  /**
   * Get user with ML credentials
   */
  async getUserWithCredentials(userId: string) {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    return user;
  }
}

