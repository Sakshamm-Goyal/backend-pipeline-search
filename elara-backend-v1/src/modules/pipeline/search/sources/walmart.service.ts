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

/**
 * Walmart Search Service
 *
 * Uses Walmart Affiliate API for product search.
 * Walmart has extensive fashion inventory at competitive prices.
 *
 * API Docs: https://developer.walmart.com/
 *
 * Note: Requires Walmart Affiliate/Partner API access
 * Alternative: Can use RapidAPI's Walmart API wrapper
 */
@Injectable()
export class WalmartService extends BaseSearchSource implements ISearchSource {
  readonly name = SearchSource.WALMART;
  readonly priority = 70; // Lower priority (price-focused)
  readonly timeout = 30000; // 30s timeout

  protected readonly logger = new Logger(WalmartService.name);

  private client!: AxiosInstance;
  private limiter!: Bottleneck;
  private apiKey!: string;

  constructor(private config: ConfigService) {
    super();

    this.apiKey = this.config.get<string>('WALMART_API_KEY')!;

    if (!this.apiKey) {
      this.logger.warn('Walmart API key not configured. Service will be disabled.');
      return;
    }

    // Using RapidAPI's Walmart API
    const rapidApiHost = this.config.get<string>('WALMART_RAPIDAPI_HOST') ||
                         'walmart2.p.rapidapi.com';

    this.client = axios.create({
      baseURL: `https://${rapidApiHost}`,
      timeout: this.timeout,
      headers: {
        'X-RapidAPI-Key': this.apiKey,
        'X-RapidAPI-Host': rapidApiHost,
      },
    });

    // Rate limiter: 5 requests per second
    const rateLimit = this.config.get<number>('WALMART_RATE_LIMIT') || 5;
    this.limiter = new Bottleneck({
      reservoir: rateLimit,
      reservoirRefreshAmount: rateLimit,
      reservoirRefreshInterval: 1000,
      maxConcurrent: 3,
    });

    this.logger.log(`Walmart service initialized (rate limit: ${rateLimit} req/s)`);
  }

  get enabled(): boolean {
    return (
      this.config.get<boolean>('ENABLE_WALMART') !== false &&
      !!this.apiKey
    );
  }

  /**
   * Search Walmart for products
   */
  @Retry({
    maxRetries: 3,
    backoff: 'exponential',
    retryOn: [429, 500, 502, 503, 504],
  })
  async search(query: SearchQuery): Promise<Product[]> {
    const startTime = Date.now();

    try {
      const searchQuery = this.buildSearchQuery(query);

      const response = await this.limiter.schedule(() =>
        this.client.get('/searchV2', {
          params: {
            query: searchQuery,
            page: 1,
            sortBy: 'relevance',
          },
        }),
      );

      const products = this.parseResults(response.data, query);

      const latency = Date.now() - startTime;
      this.trackSuccess(latency);

      this.logger.log(`Walmart returned ${products.length} products in ${latency}ms`);

      return products;
    } catch (error) {
      this.trackFailure(error as Error);
      this.logger.error(`Walmart search failed: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Build search query with fashion focus
   */
  private buildSearchQuery(query: SearchQuery): string {
    let searchTerms = query.terms;

    // Filter by category if specified
    if (query.category) {
      const categoryMap: Record<string, string> = {
        top: 'tops shirts',
        bottom: 'pants jeans',
        dress: 'dresses',
        shoes: 'shoes footwear',
        outerwear: 'jackets coats',
        accessories: 'accessories jewelry bags',
      };
      const categoryTerms = categoryMap[query.category] || query.category;
      searchTerms = `${searchTerms} ${categoryTerms}`;
    }

    // Add gender filter
    if (query.gender) {
      searchTerms = `${query.gender}'s ${searchTerms}`;
    }

    return searchTerms;
  }

  /**
   * Parse Walmart API response
   */
  private parseResults(data: any, query: SearchQuery): Product[] {
    const products: Product[] = [];

    // Handle different API response structures
    const items = data.searchResult?.items ||
                  data.items ||
                  data.products ||
                  [];

    for (const item of items) {
      try {
        const product = this.normalizeWalmartProduct(item);

        // Apply price filter
        if (query.minPrice && product.price < query.minPrice) continue;
        if (query.maxPrice && product.price > query.maxPrice) continue;

        products.push(product);

        if (products.length >= (query.limit || 50)) {
          break;
        }
      } catch (error) {
        this.logger.warn(`Failed to parse Walmart item: ${(error as Error).message}`);
      }
    }

    return products;
  }

  /**
   * Normalize Walmart product to our Product interface
   */
  private normalizeWalmartProduct(item: any): Product {
    // Extract pricing
    const price = item.priceInfo?.currentPrice?.price ||
                  item.price ||
                  item.salePrice ||
                  0;

    const originalPrice = item.priceInfo?.wasPrice?.price ||
                          item.msrp ||
                          undefined;

    // Determine if on sale
    const onSale = originalPrice && originalPrice > price;

    // Get image URL
    const imageUrl = item.imageInfo?.thumbnailUrl ||
                     item.image ||
                     item.mediumImage ||
                     item.thumbnailImage ||
                     '';

    // Get product URL
    const productUrl = item.canonicalUrl
      ? `https://www.walmart.com${item.canonicalUrl}`
      : item.productUrl || item.addToCartUrl || '';

    // Extract brand
    const brand = item.brand || this.extractBrandFromTitle(item.name || item.title);

    return normalizeProduct(
      {
        id: item.usItemId || item.itemId || item.id,
        title: item.name || item.title,
        brand,
        retailer: 'Walmart',
        price,
        originalPrice,
        onSale,
        image: imageUrl,
        url: productUrl,
        rating: item.rating?.averageRating || item.customerRating,
        reviewCount: item.rating?.numberOfReviews || item.numReviews,
        inStock: item.availabilityStatus !== 'OUT_OF_STOCK',
        category: this.mapCategory(item.category),
        color: item.color,
        sizes: item.variants?.map((v: any) => v.size).filter(Boolean),
      },
      SearchSource.WALMART,
    );
  }

  /**
   * Extract brand from product title
   */
  private extractBrandFromTitle(title: string): string | undefined {
    if (!title) return undefined;

    // Common patterns: "Brand Name Product Description"
    const words = title.split(/[\s-]+/);
    if (words.length > 0 && words[0].length > 1) {
      return words[0];
    }

    return undefined;
  }

  /**
   * Map Walmart category to our standard categories
   */
  private mapCategory(walmartCategory: string): string | undefined {
    if (!walmartCategory) return undefined;

    const categoryLower = walmartCategory.toLowerCase();

    if (categoryLower.includes('dress')) return 'dress';
    if (categoryLower.includes('top') || categoryLower.includes('shirt') ||
        categoryLower.includes('blouse')) return 'top';
    if (categoryLower.includes('pant') || categoryLower.includes('jean') ||
        categoryLower.includes('skirt') || categoryLower.includes('short')) return 'bottom';
    if (categoryLower.includes('shoe') || categoryLower.includes('boot') ||
        categoryLower.includes('sandal') || categoryLower.includes('sneaker')) return 'shoes';
    if (categoryLower.includes('jacket') || categoryLower.includes('coat') ||
        categoryLower.includes('sweater')) return 'outerwear';
    if (categoryLower.includes('bag') || categoryLower.includes('jewelry') ||
        categoryLower.includes('watch') || categoryLower.includes('belt')) return 'accessories';

    return undefined;
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/searchV2', {
        params: { query: 'dress', page: 1 },
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }
}
