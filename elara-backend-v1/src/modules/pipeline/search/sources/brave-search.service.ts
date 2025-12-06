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
 * Brave Search Service
 *
 * Uses Brave Search API for product discovery.
 * Brave provides privacy-focused web search with shopping results.
 *
 * API Docs: https://api.search.brave.com/app/documentation
 *
 * Features:
 * - Shopping-focused search results
 * - Rate limiting (1 req/s free tier, 20 req/s paid)
 * - Automatic retries with exponential backoff
 */
@Injectable()
export class BraveSearchService extends BaseSearchSource implements ISearchSource {
  readonly name = SearchSource.BRAVE_SEARCH;
  readonly priority = 75; // Medium priority (fallback to Oxylabs/SearchAPI)
  readonly timeout = 30000; // 30s timeout

  protected readonly logger = new Logger(BraveSearchService.name);

  private client!: AxiosInstance;
  private limiter!: Bottleneck;
  private apiKey!: string;

  constructor(
    private config: ConfigService,
    private queryBuilder: QueryBuilderService,
  ) {
    super();

    this.apiKey = this.config.get<string>('BRAVE_API_KEY')!;

    if (!this.apiKey) {
      this.logger.warn('Brave API key not configured. Service will be disabled.');
      return;
    }

    // Initialize HTTP client
    this.client = axios.create({
      baseURL: 'https://api.search.brave.com/res/v1',
      timeout: this.timeout,
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': this.apiKey,
      },
    });

    // Rate limiter: 1 request per second (free tier) - can be increased for paid
    const rateLimit = this.config.get<number>('BRAVE_RATE_LIMIT') || 1;
    this.limiter = new Bottleneck({
      reservoir: rateLimit,
      reservoirRefreshAmount: rateLimit,
      reservoirRefreshInterval: 1000,
      maxConcurrent: 1,
    });

    this.logger.log(`Brave Search service initialized (rate limit: ${rateLimit} req/s)`);
  }

  get enabled(): boolean {
    return (
      this.config.get<boolean>('ENABLE_BRAVE_SEARCH') !== false &&
      !!this.apiKey
    );
  }

  /**
   * Search Brave for fashion products
   */
  @Retry({
    maxRetries: 3,
    backoff: 'exponential',
    retryOn: [429, 500, 502, 503, 504],
  })
  async search(query: SearchQuery): Promise<Product[]> {
    const startTime = Date.now();

    try {
      // Build search query with fashion context
      const searchQuery = this.buildFashionQuery(query);

      // Execute with rate limiting
      const response = await this.limiter.schedule(() =>
        this.client.get('/web/search', {
          params: {
            q: searchQuery,
            count: Math.min(query.limit || 20, 20), // Brave max is 20
            search_lang: 'en',
            country: 'us',
            result_filter: 'web', // Focus on web results with products
          },
        }),
      );

      // Parse results
      const products = this.parseResults(response.data, query);

      const latency = Date.now() - startTime;
      this.trackSuccess(latency);

      this.logger.log(`Brave Search returned ${products.length} products in ${latency}ms`);

      return products;
    } catch (error) {
      this.trackFailure(error as Error);
      this.logger.error(`Brave Search failed: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Build fashion-focused search query
   */
  private buildFashionQuery(query: SearchQuery): string {
    let searchTerms = query.terms;

    // Add fashion context if not already present
    const fashionKeywords = ['buy', 'shop', 'fashion', 'clothing', 'wear'];
    const hasFashionContext = fashionKeywords.some(kw =>
      searchTerms.toLowerCase().includes(kw)
    );

    if (!hasFashionContext) {
      searchTerms = `buy ${searchTerms} clothing online`;
    }

    // Add brand filter if specified
    if (query.brands?.length) {
      searchTerms += ` ${query.brands[0]}`;
    }

    // Add price filter context
    if (query.maxPrice) {
      searchTerms += ` under $${query.maxPrice}`;
    }

    return searchTerms;
  }

  /**
   * Parse Brave Search results into Product objects
   */
  private parseResults(data: any, query: SearchQuery): Product[] {
    const products: Product[] = [];

    // Brave returns web results - filter for shopping/product pages
    const webResults = data.web?.results || [];

    for (const result of webResults) {
      try {
        // Only include results that look like product pages
        if (!this.isProductPage(result)) {
          continue;
        }

        const product = this.parseWebResult(result);
        if (product) {
          products.push(product);
        }

        if (products.length >= (query.limit || 20)) {
          break;
        }
      } catch (error) {
        this.logger.warn(`Failed to parse Brave result: ${(error as Error).message}`);
      }
    }

    return products;
  }

  /**
   * Check if a web result is likely a product page
   */
  private isProductPage(result: any): boolean {
    const url = result.url?.toLowerCase() || '';
    const title = result.title?.toLowerCase() || '';
    const description = result.description?.toLowerCase() || '';

    // Product page indicators
    const productIndicators = [
      '/product/',
      '/item/',
      '/p/',
      'buy',
      'shop',
      'price',
      '$',
      'add to cart',
      'add to bag',
    ];

    // Known shopping domains
    const shoppingDomains = [
      'amazon.com',
      'nordstrom.com',
      'macys.com',
      'bloomingdales.com',
      'zappos.com',
      'asos.com',
      'zara.com',
      'hm.com',
      'uniqlo.com',
      'gap.com',
      'forever21.com',
      'urbanoutfitters.com',
      'shopbop.com',
      'revolve.com',
      'ssense.com',
      'farfetch.com',
      'net-a-porter.com',
    ];

    const isShoppingDomain = shoppingDomains.some(domain => url.includes(domain));
    const hasProductIndicators = productIndicators.some(ind =>
      url.includes(ind) || title.includes(ind) || description.includes(ind)
    );

    return isShoppingDomain || hasProductIndicators;
  }

  /**
   * Parse a web result into a Product
   */
  private parseWebResult(result: any): Product | null {
    // Extract price from description if available
    const price = this.extractPrice(result.description || result.title);

    if (!price) {
      return null; // Skip results without price
    }

    // Try to extract brand from title
    const brand = this.extractBrand(result.title);

    // Get thumbnail from page info if available
    const imageUrl = result.thumbnail?.src ||
                     result.deep_results?.images?.[0]?.src ||
                     '';

    return normalizeProduct(
      {
        id: this.generateId(result.url),
        title: result.title,
        brand,
        retailer: this.extractRetailer(result.url),
        price,
        image: imageUrl,
        url: result.url,
        description: result.description,
        inStock: true, // Assume in stock if listed
      },
      SearchSource.BRAVE_SEARCH,
    );
  }

  /**
   * Extract price from text
   */
  private extractPrice(text: string): number | null {
    if (!text) return null;

    // Match various price formats: $99, $99.99, USD 99, etc.
    const priceMatch = text.match(/\$[\d,]+\.?\d*/);
    if (priceMatch) {
      const cleaned = priceMatch[0].replace(/[$,]/g, '');
      const price = parseFloat(cleaned);
      return isNaN(price) ? null : price;
    }

    return null;
  }

  /**
   * Extract brand from title
   */
  private extractBrand(title: string): string | undefined {
    if (!title) return undefined;

    // Common fashion brands to look for
    const brands = [
      'Nike', 'Adidas', 'Zara', 'H&M', 'Uniqlo', 'Gap', 'Levi\'s', 'Calvin Klein',
      'Ralph Lauren', 'Tommy Hilfiger', 'Gucci', 'Prada', 'Chanel', 'Louis Vuitton',
      'Nordstrom', 'ASOS', 'Forever 21', 'Urban Outfitters', 'Mango', 'Topshop',
    ];

    const titleUpper = title;
    for (const brand of brands) {
      if (titleUpper.toLowerCase().includes(brand.toLowerCase())) {
        return brand;
      }
    }

    // Default: first word as brand
    const firstWord = title.split(/[\s-]+/)[0];
    return firstWord?.length > 2 ? firstWord : undefined;
  }

  /**
   * Extract retailer from URL
   */
  private extractRetailer(url: string): string {
    try {
      const hostname = new URL(url).hostname;
      // Remove www. and .com/.co.uk etc
      const name = hostname
        .replace(/^www\./, '')
        .replace(/\.(com|co\.uk|net|org)$/, '');
      // Capitalize first letter
      return name.charAt(0).toUpperCase() + name.slice(1);
    } catch {
      return 'Unknown';
    }
  }

  /**
   * Generate unique ID from URL
   */
  private generateId(url: string): string {
    // Simple hash of URL
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      const char = url.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `brave-${Math.abs(hash)}`;
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/web/search', {
        params: { q: 'test', count: 1 },
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }
}
