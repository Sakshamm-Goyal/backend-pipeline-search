import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import Bottleneck from 'bottleneck';
import {
  BaseSearchSource,
  ISearchSource,
} from './search-source.interface';
import { Product, SearchSource, normalizeProduct } from '../dto/product.dto';
import type { SearchQuery } from '../dto/search-query.dto';
import { Retry } from '../../infrastructure/resilience/retry.decorator';
import { QueryBuilderService } from '../query-builder.service';

/**
 * ShopStyle Collective API Source
 *
 * ShopStyle Collective provides fashion product search with affiliate links.
 * Benefits:
 * - Free API access
 * - Affiliate commissions (monetization)
 * - Rich product data (reviews, ratings, sizes)
 * - Multiple retailers in one API
 *
 * API Docs: https://www.shopstylecollective.com/api/overview
 */
@Injectable()
export class ShopStyleService extends BaseSearchSource implements ISearchSource {
  readonly name = SearchSource.SHOPSTYLE;
  readonly priority = 90; // High priority (fallback to Oxylabs)
  // Individual timeout: 20s (medium - external API)
  readonly timeout = 20000;
  protected readonly logger = new Logger(ShopStyleService.name);

  private client!: AxiosInstance;
  private limiter!: Bottleneck;
  private apiKey!: string;
  private partnerId!: string; // For affiliate tracking

  constructor(
    private config: ConfigService,
    private queryBuilder: QueryBuilderService,
  ) {
    super();

    // Get API key from config
    this.apiKey = this.config.get<string>('SHOPSTYLE_API_KEY')!;
    this.partnerId = this.config.get<string>('SHOPSTYLE_PARTNER_ID') || 'elara';

    if (!this.apiKey) {
      this.logger.warn(
        'ShopStyle API key not configured. Service will be disabled.',
      );
      (this as any).enabled = false;
      return;
    }

    // Initialize HTTP client
    this.client = axios.create({
      baseURL: 'https://api.shopstylecollective.com/api/v2',
      timeout: 15000, // 15s timeout
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Rate limiter: 5 requests per second (ShopStyle limit)
    const rateLimit = this.config.get<number>('SHOPSTYLE_RATE_LIMIT') || 5;
    this.limiter = new Bottleneck({
      reservoir: rateLimit,
      reservoirRefreshAmount: rateLimit,
      reservoirRefreshInterval: 1000,
      maxConcurrent: 3,
    });

    this.logger.log(
      `ShopStyle service initialized (rate limit: ${rateLimit} req/s)`,
    );
  }

  get enabled(): boolean {
    return (
      this.config.get<boolean>('ENABLE_SHOPSTYLE') !== false && !!this.apiKey
    );
  }

  /**
   * Search ShopStyle Collective API
   * Note: 401 errors are NOT retried - they indicate invalid API key
   */
  @Retry({
    maxRetries: 3,
    backoff: 'exponential',
    retryOn: [429, 500, 502, 503, 504], // 401 is NOT retryable
  })
  async search(query: SearchQuery): Promise<Product[]> {
    const startTime = Date.now();

    try {
      // Build ShopStyle-specific query params
      const params = this.queryBuilder.buildShopStyleQuery(query);

      // Add API key and partner ID
      params.pid = this.apiKey;
      params.site = 'shopstyle.com';

      // Execute with rate limiting
      const response = await this.limiter.schedule(() =>
        this.client.get('/products', { params }),
      );

      // Parse and normalize results
      const products = this.parseResults(response.data, query);

      // Track success
      const latency = Date.now() - startTime;
      this.trackSuccess(latency);

      this.logger.log(
        `ShopStyle returned ${products.length} products in ${latency}ms`,
      );

      return products;
    } catch (error: any) {
      this.trackFailure(error as Error);

      // Special handling for 401 - disable service temporarily
      if (error.response?.status === 401) {
        this.logger.error(
          `ShopStyle API key is invalid or expired (401 Unauthorized). ` +
          `Please check SHOPSTYLE_API_KEY in your environment. ` +
          `Service will continue to fail until key is updated.`
        );
      }

      this.logger.error(
        `ShopStyle search failed: ${(error as Error).message}`,
        (error as Error).stack,
      );

      throw error;
    }
  }

  /**
   * Parse ShopStyle response and normalize to Product[]
   */
  private parseResults(data: any, query: SearchQuery): Product[] {
    if (!data?.products || !Array.isArray(data.products)) {
      this.logger.warn('No products in ShopStyle response');
      return [];
    }

    const products: Product[] = [];

    for (const item of data.products) {
      try {
        const product = this.normalizeShopStyleProduct(item);
        products.push(product);

        // Limit to requested amount
        if (products.length >= (query.limit || 50)) {
          break;
        }
      } catch (error) {
        this.logger.warn(
          `Failed to parse ShopStyle product: ${(error as Error).message}`,
          item,
        );
      }
    }

    return products;
  }

  /**
   * Normalize ShopStyle product to our Product interface
   */
  private normalizeShopStyleProduct(item: any): Product {
    // ShopStyle price is already in the correct currency
    const price = item.price || item.salePrice || 0;
    const originalPrice = item.priceLabel?.includes('Sale')
      ? item.price * 1.3 // Estimate original price
      : undefined;

    // Generate affiliate URL (adds tracking)
    const affiliateUrl = this.generateAffiliateUrl(
      item.clickUrl || item.url,
      item.id,
    );

    const product = normalizeProduct(
      {
        id: item.id,
        title: item.name || item.description,
        description: item.description,
        brand: item.brand?.name || item.brandedName,
        retailer: item.retailer?.name || 'Unknown',
        price,
        originalPrice,
        currency: item.currency || 'USD',
        onSale: !!item.inStock && !!originalPrice,
        image: item.image?.sizes?.Original?.url || item.image?.url,
        images: this.extractImages(item.image),
        productUrl: item.clickUrl || item.url,
        affiliateUrl,
        rating: item.rating,
        reviewCount: item.reviewCount,
        inStock: item.inStock !== false,
        color: item.color?.name,
        colors: item.colors?.map((c: any) => c.name),
        sizes: item.sizes?.map((s: any) => s.name),
      },
      SearchSource.SHOPSTYLE,
    );

    // Add ShopStyle-specific metadata
    if (item.categories) {
      product.tags = item.categories.map((c: any) => c.name);
    }

    return product;
  }

  /**
   * Extract all available image sizes
   */
  private extractImages(imageData: any): string[] {
    if (!imageData?.sizes) return [];

    const images: string[] = [];
    const sizes = imageData.sizes;

    // Priority order: Original, XLarge, Large, Medium
    if (sizes.Original?.url) images.push(sizes.Original.url);
    if (sizes.XLarge?.url) images.push(sizes.XLarge.url);
    if (sizes.Large?.url) images.push(sizes.Large.url);
    if (sizes.Medium?.url) images.push(sizes.Medium.url);

    return images;
  }

  /**
   * Generate affiliate URL with tracking
   */
  private generateAffiliateUrl(originalUrl: string, productId: string): string {
    if (!originalUrl) return '';

    // Add partner ID for tracking
    const url = new URL(originalUrl);
    url.searchParams.set('partner', this.partnerId);
    url.searchParams.set('pid', productId);

    return url.toString();
  }

  /**
   * Get product details by ID (for enrichment)
   */
  async getProductDetails(productId: string): Promise<Product | null> {
    try {
      const response = await this.limiter.schedule(() =>
        this.client.get(`/products/${productId}`, {
          params: { pid: this.apiKey },
        }),
      );

      if (response.data) {
        return this.normalizeShopStyleProduct(response.data);
      }

      return null;
    } catch (error) {
      this.logger.error(
        `Failed to get product details for ${productId}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Search by brand (useful for brand-specific queries)
   */
  async searchByBrand(
    brandName: string,
    query: SearchQuery,
  ): Promise<Product[]> {
    const modifiedQuery = {
      ...query,
      terms: `${query.terms} ${brandName}`,
      brands: [brandName],
    };

    return this.search(modifiedQuery);
  }

  /**
   * Get trending products in a category
   */
  async getTrending(
    category: string,
    limit: number = 20,
  ): Promise<Product[]> {
    try {
      const response = await this.limiter.schedule(() =>
        this.client.get('/products', {
          params: {
            pid: this.apiKey,
            cat: category,
            offset: 0,
            limit,
            sort: 'Popular', // ShopStyle's trending sort
          },
        }),
      );

      return this.parseResults(response.data, { terms: '', limit });
    } catch (error) {
      this.logger.error(
        `Failed to get trending products: ${(error as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Health check: verify ShopStyle API is accessible
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Simple test query
      const response = await this.client.get('/products', {
        params: {
          pid: this.apiKey,
          fts: 'dress',
          limit: 1,
        },
      });

      return !!response.data?.products?.length;
    } catch (error) {
      this.logger.error(`ShopStyle health check failed: ${(error as Error).message}`);
      return false;
    }
  }
}
