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
 * Target Search Service
 *
 * Uses Target's RedSky API (internal API) or RapidAPI wrapper.
 * Target offers mid-range fashion with good selection.
 *
 * Note: Target doesn't have a public API, so we use:
 * 1. RapidAPI's Target API wrapper
 * 2. Or direct RedSky API (may require reverse engineering)
 */
@Injectable()
export class TargetService extends BaseSearchSource implements ISearchSource {
  readonly name = SearchSource.TARGET;
  readonly priority = 70; // Similar to Walmart
  readonly timeout = 30000;

  protected readonly logger = new Logger(TargetService.name);

  private client!: AxiosInstance;
  private limiter!: Bottleneck;
  private apiKey!: string;

  constructor(private config: ConfigService) {
    super();

    this.apiKey = this.config.get<string>('TARGET_API_KEY')!;

    if (!this.apiKey) {
      this.logger.warn('Target API key not configured. Service will be disabled.');
      return;
    }

    // Using RapidAPI's Target API
    const rapidApiHost = this.config.get<string>('TARGET_RAPIDAPI_HOST') ||
                         'target1.p.rapidapi.com';

    this.client = axios.create({
      baseURL: `https://${rapidApiHost}`,
      timeout: this.timeout,
      headers: {
        'X-RapidAPI-Key': this.apiKey,
        'X-RapidAPI-Host': rapidApiHost,
      },
    });

    // Rate limiter: 5 requests per second
    const rateLimit = this.config.get<number>('TARGET_RATE_LIMIT') || 5;
    this.limiter = new Bottleneck({
      reservoir: rateLimit,
      reservoirRefreshAmount: rateLimit,
      reservoirRefreshInterval: 1000,
      maxConcurrent: 3,
    });

    this.logger.log(`Target service initialized (rate limit: ${rateLimit} req/s)`);
  }

  get enabled(): boolean {
    return (
      this.config.get<boolean>('ENABLE_TARGET') !== false &&
      !!this.apiKey
    );
  }

  /**
   * Search Target for products
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
        this.client.get('/products/v2/list', {
          params: {
            store_id: '911', // Default store
            keyword: searchQuery,
            count: Math.min(query.limit || 50, 50),
            offset: query.offset || 0,
            default_purchasability_filter: 'true',
            sort_by: 'relevance',
          },
        }),
      );

      const products = this.parseResults(response.data, query);

      const latency = Date.now() - startTime;
      this.trackSuccess(latency);

      this.logger.log(`Target returned ${products.length} products in ${latency}ms`);

      return products;
    } catch (error) {
      this.trackFailure(error as Error);
      this.logger.error(`Target search failed: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Build search query with fashion focus
   */
  private buildSearchQuery(query: SearchQuery): string {
    let searchTerms = query.terms;

    // Add category filter
    if (query.category) {
      const categoryMap: Record<string, string> = {
        top: 'tops',
        bottom: 'pants bottoms',
        dress: 'dresses',
        shoes: 'shoes',
        outerwear: 'jackets coats',
        accessories: 'accessories',
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
   * Parse Target API response
   */
  private parseResults(data: any, query: SearchQuery): Product[] {
    const products: Product[] = [];

    // Handle different response structures
    const items = data.data?.search?.products ||
                  data.products ||
                  data.items ||
                  [];

    for (const item of items) {
      try {
        const product = this.normalizeTargetProduct(item);

        // Apply price filter
        if (query.minPrice && product.price < query.minPrice) continue;
        if (query.maxPrice && product.price > query.maxPrice) continue;

        products.push(product);

        if (products.length >= (query.limit || 50)) {
          break;
        }
      } catch (error) {
        this.logger.warn(`Failed to parse Target item: ${(error as Error).message}`);
      }
    }

    return products;
  }

  /**
   * Normalize Target product to our Product interface
   */
  private normalizeTargetProduct(item: any): Product {
    // Extract pricing (Target uses nested price structure)
    const priceInfo = item.price || item.current_retail || {};
    const price = priceInfo.current_retail ||
                  priceInfo.regular_retail ||
                  item.priceRange?.minPrice ||
                  0;

    const originalPrice = priceInfo.reg_retail ||
                          priceInfo.compare_at_price ||
                          undefined;

    const onSale = originalPrice && originalPrice > price;

    // Get images
    const images = item.images || [];
    const primaryImage = images[0]?.base_url || item.primary_image_url || '';

    // Get product URL
    const productUrl = item.url
      ? `https://www.target.com${item.url}`
      : `https://www.target.com/p/-/A-${item.tcin || item.dpci}`;

    // Extract brand
    const brand = item.brand?.name ||
                  item.brand ||
                  this.extractBrandFromTitle(item.title || item.description);

    // Get availability
    const inStock = item.availability_status !== 'OUT_OF_STOCK' &&
                    item.fulfillment?.is_out_of_stock_in_all_store_locations !== true;

    return normalizeProduct(
      {
        id: item.tcin || item.dpci || item.product_id,
        title: item.title || item.description,
        description: item.description || item.long_description,
        brand,
        retailer: 'Target',
        price,
        originalPrice,
        onSale,
        image: primaryImage,
        images: images.map((img: any) => img.base_url).filter(Boolean),
        url: productUrl,
        rating: item.ratings_and_reviews?.statistics?.rating?.average,
        reviewCount: item.ratings_and_reviews?.statistics?.rating?.count,
        inStock,
        category: this.mapCategory(item.taxonomy_nodes),
        color: item.variation_attributes?.find((v: any) =>
          v.name?.toLowerCase() === 'color'
        )?.value,
        sizes: item.variation_attributes?.find((v: any) =>
          v.name?.toLowerCase() === 'size'
        )?.values,
      },
      SearchSource.TARGET,
    );
  }

  /**
   * Extract brand from product title
   */
  private extractBrandFromTitle(title: string): string | undefined {
    if (!title) return undefined;

    // Target-specific patterns
    // Many Target products follow: "Brand - Product Name" or "Brand Product Name"
    const dashMatch = title.match(/^([^-]+)\s*-/);
    if (dashMatch && dashMatch[1].trim().length > 1) {
      return dashMatch[1].trim();
    }

    // Fallback: first word
    const firstWord = title.split(/\s+/)[0];
    return firstWord?.length > 2 ? firstWord : undefined;
  }

  /**
   * Map Target taxonomy to our standard categories
   */
  private mapCategory(taxonomyNodes: any[]): string | undefined {
    if (!taxonomyNodes || !Array.isArray(taxonomyNodes)) return undefined;

    const categories = taxonomyNodes.map(n => n.name?.toLowerCase() || '');
    const allCategories = categories.join(' ');

    if (allCategories.includes('dress')) return 'dress';
    if (allCategories.includes('top') || allCategories.includes('shirt') ||
        allCategories.includes('blouse') || allCategories.includes('tee')) return 'top';
    if (allCategories.includes('pant') || allCategories.includes('jean') ||
        allCategories.includes('skirt') || allCategories.includes('short') ||
        allCategories.includes('bottom')) return 'bottom';
    if (allCategories.includes('shoe') || allCategories.includes('boot') ||
        allCategories.includes('sandal') || allCategories.includes('sneaker') ||
        allCategories.includes('footwear')) return 'shoes';
    if (allCategories.includes('jacket') || allCategories.includes('coat') ||
        allCategories.includes('sweater') || allCategories.includes('outerwear')) return 'outerwear';
    if (allCategories.includes('bag') || allCategories.includes('jewelry') ||
        allCategories.includes('watch') || allCategories.includes('accessory') ||
        allCategories.includes('belt') || allCategories.includes('hat')) return 'accessories';

    return undefined;
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/products/v2/list', {
        params: { store_id: '911', keyword: 'dress', count: 1 },
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }
}
