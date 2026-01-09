export interface MLUserInfo {
  id: number;
  nickname: string;
  email: string;
  first_name: string;
  last_name: string;
  country_id: string;
  site_id: string;
  registration_date: string;
  phone?: {
    area_code: string;
    number: string;
  };
  address?: {
    address: string;
    city: string;
    state: string;
    zip_code: string;
  };
  identification?: {
    number: string;
    type: string;
  };
  company?: {
    corporate_name: string;
    brand_name: string;
    identification: string;
  };
  seller_experience?: string;
}

export interface MLUserInfoParsed {
  nickname: string;
  email: string;
  first_name: string;
  last_name: string;
  country_id: string;
  site_id: string;
  registration_date: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  tax_id: string | null;
  corporate_name: string | null;
  brand_name: string | null;
  seller_experience: string | null;
  full_name: string;
}

export class MercadoLibreAPIService {
  private readonly BASE_URL = 'https://api.mercadolibre.com';

  /**
   * Get user information from Mercado Libre API
   */
  async getUserInfo(accessToken: string): Promise<MLUserInfoParsed> {
    const response = await fetch(`${this.BASE_URL}/users/me`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(`Failed to fetch user info: ${error.message || response.statusText}`);
    }

    const data: MLUserInfo = await response.json();

    // Parse and format the data
    return {
      nickname: data.nickname || '',
      email: data.email || '',
      first_name: data.first_name || '',
      last_name: data.last_name || '',
      country_id: data.country_id || '',
      site_id: data.site_id || '',
      registration_date: data.registration_date || '',
      phone: data.phone
        ? `${data.phone.area_code || ''}${data.phone.number || ''}`.trim()
        : null,
      address: data.address?.address || null,
      city: data.address?.city || null,
      state: data.address?.state || null,
      zip_code: data.address?.zip_code || null,
      tax_id: data.identification?.number || data.company?.identification || null,
      corporate_name: data.company?.corporate_name || null,
      brand_name: data.company?.brand_name || null,
      seller_experience: data.seller_experience || null,
      full_name: `${data.first_name || ''} ${data.last_name || ''}`.trim(),
    };
  }
}

