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
 * SearchAPI.io Google Shopping Source
 *
 * SearchAPI.io provides structured Google Shopping results.
 * This is a reliable ShopStyle replacement with broad retailer coverage.
 *
 * Benefits:
 * - Google Shopping data with structured JSON
 * - Broad retailer coverage
 * - Product offers with multiple merchant prices
 * - Location-based targeting
 *
 * Pricing:
 * - Free tier: 100 searches
 * - Developer: $50/month for 5,000 searches
 * - Rate: ~$0.01 per search
 *
 * API Docs: https://www.searchapi.io/docs/google-shopping
 */
@Injectable()
export class SearchApiService extends BaseSearchSource implements ISearchSource {
  readonly name = SearchSource.GOOGLE_SHOPPING; // Using GOOGLE_SHOPPING as source name
  readonly priority = 90; // Same priority as deprecated ShopStyle
  // Individual timeout: 30s (medium-slow - external API)
  readonly timeout = 30000;
  protected readonly logger = new Logger(SearchApiService.name);

  private client!: AxiosInstance;
  private limiter!: Bottleneck;
  private apiKey!: string;

  constructor(
    private config: ConfigService,
    private queryBuilder: QueryBuilderService,
  ) {
    super();

    // Get API key from config
    this.apiKey = this.config.get<string>('SEARCHAPI_API_KEY')!;

    if (!this.apiKey) {
      this.logger.warn(
        'SearchAPI.io API key not configured. Service will be disabled.',
      );
      (this as any).enabled = false;
      return;
    }

    // Initialize HTTP client
    this.client = axios.create({
      baseURL: 'https://www.searchapi.io/api/v1',
      timeout: 25000, // 25s timeout (external API can be slow)
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
      },
    });

    // Rate limiter: Reduced to 1 request per second to avoid 429 errors
    // SearchAPI free tier has aggressive rate limits
    const rateLimit = this.config.get<number>('SEARCHAPI_RATE_LIMIT') || 1;
    this.limiter = new Bottleneck({
      reservoir: rateLimit,
      reservoirRefreshAmount: rateLimit,
      reservoirRefreshInterval: 1000,
      maxConcurrent: 1, // Only 1 concurrent to avoid 429
      minTime: 1000, // Minimum 1 second between requests
    });

    this.logger.log(
      `SearchAPI.io service initialized (rate limit: ${rateLimit} req/s, maxConcurrent: 1)`,
    );
  }

  get enabled(): boolean {
    return (
      this.config.get<boolean>('ENABLE_SEARCHAPI') !== false && !!this.apiKey
    );
  }

  /**
   * Search Google Shopping via SearchAPI.io
   * Note: Uses longer retry delays for 429 rate limit errors
   */
  @Retry({
    maxRetries: 2, // Reduced retries since 429s indicate we need to slow down
    backoff: 'exponential',
    retryOn: [429, 500, 502, 503, 504],
  })
  async search(query: SearchQuery): Promise<Product[]> {
    const startTime = Date.now();

    try {
      // Build search query
      const searchTerms = this.queryBuilder.buildSearchApiQuery
        ? this.queryBuilder.buildSearchApiQuery(query)
        : query.terms;

      // Build request params
      const params: Record<string, any> = {
        engine: 'google_shopping',
        q: searchTerms,
        gl: 'us', // Country: United States
        hl: 'en', // Language: English
        num: Math.min(query.limit || 50, 100), // Max 100 per request
      };

      // Add price filters if specified
      if (query.minPrice || query.maxPrice) {
        const min = query.minPrice || 0;
        const max = query.maxPrice || 10000;
        params.tbs = `mr:1,price:1,ppr_min:${min},ppr_max:${max}`;
      }

      // Execute with rate limiting
      const response = await this.limiter.schedule(() =>
        this.client.get('/search', { params }),
      );

      // Parse and normalize results
      const products = this.parseResults(response.data, query);

      // Track success
      const latency = Date.now() - startTime;
      this.trackSuccess(latency);

      this.logger.log(
        `SearchAPI.io returned ${products.length} products in ${latency}ms`,
      );

      return products;
    } catch (error: any) {
      this.trackFailure(error as Error);

      // Special handling for 429 - rate limit hit
      if (error.response?.status === 429) {
        this.logger.warn(
          `SearchAPI.io rate limit hit (429). Consider upgrading plan or reducing parallel requests. ` +
          `Current rate limit: ${this.config.get<number>('SEARCHAPI_RATE_LIMIT') || 1} req/s. ` +
          `Returning empty results to allow other sources to continue.`
        );
        // Return empty array instead of throwing - allows other sources to work
        return [];
      }

      // For other errors, log but return empty array to allow graceful degradation
      this.logger.error(
        `SearchAPI.io search failed: ${(error as Error).message}`,
      );

      // Don't throw - return empty array to allow other sources to provide results
      // The circuit breaker will handle repeated failures
      return [];
    }
  }

  /**
   * Parse SearchAPI.io response and normalize to Product[]
   */
  private parseResults(data: any, query: SearchQuery): Product[] {
    if (!data?.shopping_results || !Array.isArray(data.shopping_results)) {
      this.logger.warn('No shopping results from SearchAPI.io');
      return [];
    }

    const products: Product[] = [];

    for (const item of data.shopping_results) {
      try {
        // Skip items without required fields
        if (!item.title || (!item.link && !item.product_link && !item.url)) {
          this.logger.debug('Skipping SearchAPI product - missing title or URL');
          continue;
        }

        const product = this.normalizeSearchApiProduct(item);
        
        // Validate product has valid URL before adding
        if (!product.productUrl || !product.productUrl.startsWith('http')) {
          this.logger.warn(`Skipping SearchAPI product - invalid URL: ${product.productUrl}`);
          continue;
        }

        products.push(product);

        // Limit to requested amount
        if (products.length >= (query.limit || 50)) {
          break;
        }
      } catch (error) {
        this.logger.warn(
          `Failed to parse SearchAPI product: ${(error as Error).message}`,
        );
        // Continue processing other products
      }
    }

    return products;
  }

  /**
   * Normalize SearchAPI.io product to our Product interface
   */
  private normalizeSearchApiProduct(item: any): Product {
    // Extract price
    const price = this.extractPrice(item.price || item.extracted_price);
    const originalPrice = item.old_price
      ? this.extractPrice(item.old_price)
      : undefined;

    // Extract product URL - ensure it's a valid URL
    let productUrl = item.link || item.product_link || item.url || '';
    
    // Validate and clean URL
    if (productUrl && !productUrl.startsWith('http')) {
      // If relative URL, make it absolute (though SearchAPI should return absolute)
      productUrl = `https://${productUrl}`;
    }
    
    // If still no valid URL, skip this product
    if (!productUrl || !productUrl.startsWith('http')) {
      throw new Error(`Invalid product URL: ${productUrl}`);
    }

    // Extract image URL
    let imageUrl = item.thumbnail || item.image || '';
    if (imageUrl && !imageUrl.startsWith('http')) {
      imageUrl = `https:${imageUrl}`;
    }

    const product = normalizeProduct(
      {
        id: item.product_id || item.docid || `searchapi-${Date.now()}-${Math.random()}`,
        title: item.title,
        description: item.snippet || item.description,
        brand: this.extractBrand(item.title, item.source),
        retailer: item.source || item.merchant?.name || 'Unknown',
        price,
        originalPrice,
        currency: 'USD',
        onSale: !!originalPrice && originalPrice > price,
        image: imageUrl,
        productUrl: productUrl,
        rating: item.rating,
        reviewCount: item.reviews,
        inStock: true, // Assume in stock if in results
      },
      SearchSource.GOOGLE_SHOPPING,
    );

    // Add delivery info if available
    if (item.delivery) {
      product.tags = product.tags || [];
      product.tags.push(item.delivery);
    }

    // Add store rating if available
    if (item.store_rating) {
      product.tags = product.tags || [];
      product.tags.push(`Store: ${item.store_rating}★`);
    }

    return product;
  }

  /**
   * Extract numeric price from string or number
   */
  private extractPrice(priceStr: string | number): number {
    if (typeof priceStr === 'number') return priceStr;
    if (!priceStr) return 0;

    // Remove currency symbols and extract number
    const cleaned = priceStr.toString().replace(/[^0-9.]/g, '');
    return parseFloat(cleaned) || 0;
  }

  /**
   * Try to extract brand from title or source
   */
  private extractBrand(title: string, source?: string): string | undefined {
    if (!title) return source || undefined;

    // Common brand patterns
    const knownBrands = [
      'Nike', 'Adidas', 'Zara', 'H&M', "Levi's", 'Gap', 'Uniqlo',
      'Ralph Lauren', 'Calvin Klein', 'Tommy Hilfiger', 'Gucci',
      'Prada', 'Louis Vuitton', 'Chanel', 'Burberry', 'Versace',
      'Coach', 'Michael Kors', 'Kate Spade', 'Tory Burch',
      'North Face', 'Patagonia', 'Columbia', 'Under Armour', 'Puma',
      'New Balance', 'Converse', 'Vans', 'Reebok', 'ASOS', 'Mango',
      'Forever 21', 'Urban Outfitters', 'Anthropologie', 'Free People',
      'Amazon Essentials', 'Goodthreads', 'Old Navy', 'Banana Republic',
    ];

    // Check if any known brand is in the title
    for (const brand of knownBrands) {
      if (title.toLowerCase().includes(brand.toLowerCase())) {
        return brand;
      }
    }

    return source || undefined;
  }

  /**
   * Get product offers (multiple merchant prices for same product)
   */
  async getProductOffers(productId: string): Promise<any> {
    try {
      const response = await this.limiter.schedule(() =>
        this.client.get('/search', {
          params: {
            engine: 'google_product',
            product_id: productId,
            gl: 'us',
            hl: 'en',
          },
        }),
      );

      return response.data?.sellers_results || [];
    } catch (error) {
      this.logger.error(`Failed to get product offers: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * Health check: verify SearchAPI.io is accessible
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/search', {
        params: {
          engine: 'google_shopping',
          q: 'dress',
          num: 1,
        },
      });

      return !!response.data?.shopping_results?.length;
    } catch (error) {
      this.logger.error(`SearchAPI.io health check failed: ${(error as Error).message}`);
      return false;
    }
  }
}
