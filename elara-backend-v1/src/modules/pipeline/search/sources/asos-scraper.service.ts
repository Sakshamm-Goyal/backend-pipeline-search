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
 * ASOS Scraper Service
 *
 * ASOS is a major fashion retailer with an internal API we can use.
 * This provides FREE fashion-specific product search with rich data.
 *
 * Benefits:
 * - FREE (no API key required, uses public endpoints)
 * - Fashion-focused (clothing, shoes, accessories only)
 * - Rich product data (sizes, colors, ratings, reviews)
 * - Multiple price points (budget to mid-range)
 * - Fast response times
 *
 * Note: Uses ASOS's internal API. For production, consider:
 * - ASOS affiliate program for proper attribution
 * - Rate limiting to be respectful
 *
 * FIXED: Now uses direct search endpoint (matching Python Elara-Joining version)
 * instead of category-based search which wasn't returning results.
 */
@Injectable()
export class AsosScraperService extends BaseSearchSource implements ISearchSource {
  readonly name = SearchSource.ASOS_SCRAPER;
  // Priority 95: High priority since ASOS is FREE and reliable
  // While paid APIs (SearchAPI, ShopStyle) often hit rate limits or auth errors
  readonly priority = 95;
  // Individual timeout: 15s (medium - scraper with rate limiting)
  readonly timeout = 15000;
  protected readonly logger = new Logger(AsosScraperService.name);

  private client!: AxiosInstance;
  private limiter!: Bottleneck;

  // Track consecutive 403 errors for backoff
  private consecutive403Errors = 0;
  private readonly max403Errors = 3;

  constructor(private config: ConfigService) {
    super();

    // Initialize HTTP client with browser-like headers
    // Use base search endpoint (NOT category-based) - matches Python version
    this.client = axios.create({
      baseURL: 'https://www.asos.com/api/product/search/v2/',
      timeout: 15000, // 15s timeout
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    // Rate limiter: 1 request per 2 seconds (be respectful)
    const rateLimit = this.config.get<number>('ASOS_RATE_LIMIT') || 0.5;
    this.limiter = new Bottleneck({
      reservoir: 1,
      reservoirRefreshAmount: 1,
      reservoirRefreshInterval: Math.round(1000 / rateLimit), // Convert to ms interval
      maxConcurrent: 1, // Single concurrent request
      minTime: 2000, // Minimum 2 seconds between requests
    });

    this.logger.log(
      `ASOS Scraper service initialized (rate limit: ${rateLimit} req/s)`,
    );
  }

  get enabled(): boolean {
    return this.config.get<boolean>('ENABLE_ASOS_SCRAPER') !== false;
  }

  /**
   * Search ASOS products using direct search endpoint (not category-based)
   * Matches the working Python Elara-Joining implementation
   */
  @Retry({
    maxRetries: 2,
    backoff: 'exponential',
    retryOn: [500, 502, 503, 504], // Don't retry 400/403 (rate limited or bad request)
  })
  async search(query: SearchQuery): Promise<Product[]> {
    const startTime = Date.now();

    // Check if we've hit too many 403 errors - back off gracefully
    if (this.consecutive403Errors >= this.max403Errors) {
      this.logger.warn(
        `ASOS: Skipping request - too many consecutive 403 errors (${this.consecutive403Errors})`,
      );
      return [];
    }

    try {
      // CRITICAL FIX: Deep clone query properties into local variables BEFORE any async operation
      // The issue is that when multiple searches are queued, the rate limiter defers execution
      // but closures capture the REFERENCE to `query`, not the VALUES at capture time.
      // To fix this, we snapshot all needed values into local constants IMMEDIATELY.
      const queryTerms = String(query.terms);
      const queryGender = query.gender ? String(query.gender) : undefined;
      const queryMinPrice = query.minPrice;
      const queryMaxPrice = query.maxPrice;
      const queryLimit = query.limit;
      const queryOffset = query.offset;

      this.logger.log(`[ASOS] Search called with terms: "${queryTerms}"`);

      // Execute with rate limiting - ALL param building happens INSIDE the schedule callback
      // to ensure we use the snapshotted values at execution time
      const response = await this.limiter.schedule(async () => {
        // Build params inside the callback using our snapshotted local variables
        const params: Record<string, any> = {
          q: queryTerms,  // Use snapshot, not query.terms
          store: 'US',
          currency: 'USD',
          sizeSchema: 'US',
          limit: Math.min(queryLimit || 50, 72),
          offset: queryOffset || 0,
          country: 'US',
          lang: 'en-US',
        };

        // Add gender/category filter
        // CRITICAL: department:1001 = "Women's Clothing", department:10584 = "Men's Clothing"
        // These are CLOTHING-ONLY departments. For shoes, bags, accessories, jewelry - we should NOT
        // apply these filters or ASOS will return only clothing items!
        const searchTermsLower = queryTerms.toLowerCase();
        const isAccessorySearch =
          searchTermsLower.includes('shoes') ||
          searchTermsLower.includes('heels') ||
          searchTermsLower.includes('sandals') ||
          searchTermsLower.includes('boots') ||
          searchTermsLower.includes('sneakers') ||
          searchTermsLower.includes('bag') ||
          searchTermsLower.includes('clutch') ||
          searchTermsLower.includes('purse') ||
          searchTermsLower.includes('jewelry') ||
          searchTermsLower.includes('earrings') ||
          searchTermsLower.includes('necklace') ||
          searchTermsLower.includes('bracelet') ||
          searchTermsLower.includes('watch') ||
          searchTermsLower.includes('sunglasses') ||
          searchTermsLower.includes('belt') ||
          searchTermsLower.includes('hat') ||
          searchTermsLower.includes('scarf');

        if (queryGender && !isAccessorySearch) {
          // Only apply clothing department filter for actual clothing searches
          const genderMap: Record<string, string> = {
            men: '10584',
            women: '1001',
            male: '10584',
            female: '1001',
          };
          const deptId = genderMap[queryGender.toLowerCase()];
          if (deptId) {
            params.base_filter = `department:${deptId}`;
            this.logger.debug(`[ASOS] Applying clothing department filter: ${deptId}`);
          }
        } else if (isAccessorySearch) {
          // For accessories, do NOT apply department filter - let ASOS search all categories
          this.logger.debug(`[ASOS] Accessory search detected - NOT applying clothing department filter`);
        }

        // Add price filter
        if (queryMinPrice !== undefined || queryMaxPrice !== undefined) {
          const priceFilters: string[] = [];
          if (queryMinPrice !== undefined) {
            priceFilters.push(`min:${Math.floor(queryMinPrice)}`);
          }
          if (queryMaxPrice !== undefined) {
            priceFilters.push(`max:${Math.floor(queryMaxPrice)}`);
          }
          params.price = priceFilters.join(',');
        }

        this.logger.debug(`[ASOS] Executing request with params: ${JSON.stringify(params)}`);

        return this.client.get('', { params });
      });

      // Reset 403 counter on success
      this.consecutive403Errors = 0;

      // Parse and normalize results
      const products = this.parseResults(response.data, query);

      // Track success
      const latency = Date.now() - startTime;
      this.trackSuccess(latency);

      this.logger.log(
        `ASOS returned ${products.length} products in ${latency}ms`,
      );

      return products;
    } catch (error) {
      const err = error as any;

      // Handle 403 (rate limited) gracefully
      if (err.response?.status === 403) {
        this.consecutive403Errors++;
        this.logger.warn(
          `ASOS rate limited (403) - ${this.consecutive403Errors}/${this.max403Errors} errors`,
        );
      }

      // Handle 400 (bad request) - often means invalid parameters
      if (err.response?.status === 400) {
        this.logger.warn(
          `ASOS bad request (400): ${JSON.stringify(err.response?.data)}`,
        );
      }

      this.trackFailure(error as Error);

      this.logger.error(
        `ASOS search failed: ${(error as Error).message}`,
        (error as Error).stack,
      );

      throw error;
    }
  }

  /**
   * Build search parameters for ASOS API
   * Matches Python Elara-Joining version exactly
   */
  private buildSearchParams(query: SearchQuery): Record<string, any> {
    const params: Record<string, any> = {
      q: query.terms,
      store: 'US',
      currency: 'USD',
      sizeSchema: 'US', // Important! Missing in old version
      limit: Math.min(query.limit || 50, 72), // ASOS max is 72
      offset: query.offset || 0,
      country: 'US',
      lang: 'en-US',
    };

    // Add gender filter using base_filter (matches Python)
    if (query.gender) {
      const genderMap: Record<string, string> = {
        men: '10584', // Men's department ID
        women: '1001', // Women's department ID
        male: '10584',
        female: '1001',
      };
      const deptId = genderMap[query.gender.toLowerCase()];
      if (deptId) {
        params.base_filter = `department:${deptId}`;
      }
    }

    // Add price filter (matches Python format: "min:X,max:Y")
    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      const priceFilters: string[] = [];
      if (query.minPrice !== undefined) {
        priceFilters.push(`min:${Math.floor(query.minPrice)}`);
      }
      if (query.maxPrice !== undefined) {
        priceFilters.push(`max:${Math.floor(query.maxPrice)}`);
      }
      params.price = priceFilters.join(',');
    }

    return params;
  }

  /**
   * Parse ASOS response and normalize to Product[]
   */
  private parseResults(data: any, query: SearchQuery): Product[] {
    if (!data?.products || !Array.isArray(data.products)) {
      this.logger.warn('No products in ASOS response');
      return [];
    }

    const products: Product[] = [];

    for (const item of data.products) {
      try {
        const product = this.normalizeAsosProduct(item);
        products.push(product);

        // Limit to requested amount
        if (products.length >= (query.limit || 50)) {
          break;
        }
      } catch (error) {
        this.logger.warn(
          `Failed to parse ASOS product: ${(error as Error).message}`,
        );
      }
    }

    return products;
  }

  /**
   * Normalize ASOS product to our Product interface
   * Matches Python Elara-Joining version
   */
  private normalizeAsosProduct(item: any): Product {
    // Extract pricing
    const currentPrice = item.price?.current?.value || 0;
    const previousPrice = item.price?.previous?.value;
    const onSale = previousPrice && previousPrice > currentPrice;

    // Build product URL (matches Python format)
    const productId = item.id?.toString() || '';
    const productUrl = `https://www.asos.com/us/prd/${productId}`;

    // Build image URL (matches Python version)
    // ASOS uses template URLs with {size} placeholder
    let imageUrl = '';
    if (item.imageUrl) {
      // Python: f"https://{item['imageUrl']}".replace("{size}", "xl")
      imageUrl = `https://${item.imageUrl}`.replace('{size}', 'xl');
    }

    const product = normalizeProduct(
      {
        id: `asos_${productId}`, // Prefix with asos_ like Python version
        title: item.name,
        brand: item.brandName || 'ASOS',
        retailer: 'ASOS',
        price: currentPrice,
        originalPrice: previousPrice,
        currency: 'USD',
        onSale,
        image: imageUrl,
        productUrl,
        inStock: item.isInStock !== false,
        color: item.colour,
      },
      SearchSource.ASOS_SCRAPER,
    );

    // Add ASOS-specific metadata
    if (item.facetGroupings) {
      product.sizes = this.extractSizes(item.facetGroupings);
    }

    if (item.isSale) {
      product.tags = product.tags || [];
      product.tags.push('sale');
    }

    if (item.isSellingFast) {
      product.tags = product.tags || [];
      product.tags.push('selling-fast');
    }

    return product;
  }

  /**
   * Extract available sizes from facet groupings
   */
  private extractSizes(facetGroupings: any[]): string[] {
    if (!Array.isArray(facetGroupings)) return [];

    const sizeFacet = facetGroupings.find(
      (f) => f.type === 'size' || f.facetType === 'size',
    );

    if (!sizeFacet?.options) return [];

    return sizeFacet.options
      .filter((opt: any) => opt.isAvailable !== false)
      .map((opt: any) => opt.name || opt.value)
      .filter(Boolean);
  }

  /**
   * Health check: verify ASOS API is accessible
   * Uses direct search endpoint (matching search method)
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('', {
        params: {
          q: 'dress',
          offset: 0,
          limit: 1,
          store: 'US',
          lang: 'en-US',
          currency: 'USD',
          sizeSchema: 'US',
          country: 'US',
        },
      });

      const hasProducts = !!response.data?.products?.length;
      if (hasProducts) {
        // Reset 403 counter on successful health check
        this.consecutive403Errors = 0;
      }
      return hasProducts;
    } catch (error) {
      this.logger.error(`ASOS health check failed: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Reset the 403 error counter (call after successful request or after waiting)
   */
  resetErrorCounter(): void {
    this.consecutive403Errors = 0;
    this.logger.log('ASOS error counter reset');
  }
}
