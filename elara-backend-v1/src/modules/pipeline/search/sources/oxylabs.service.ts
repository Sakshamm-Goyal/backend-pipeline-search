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
 * Oxylabs Google Shopping Source
 *
 * FIXED implementation with proper retry logic and rate limiting.
 * Issues fixed from Python version:
 * - max_retries increased from 1 to 3
 * - Added exponential backoff
 * - Added rate limiting (10 req/s)
 * - Proper error handling
 * - Circuit breaker integration (via orchestrator)
 */
@Injectable()
export class OxylabsService extends BaseSearchSource implements ISearchSource {
  readonly name = SearchSource.OXYLABS;
  readonly priority = 100; // Highest priority (try first)
  // Individual timeout: 60s (slow - external API with network latency)
  readonly timeout = 60000;
  protected readonly logger = new Logger(OxylabsService.name);

  private client!: AxiosInstance;
  private limiter!: Bottleneck;
  private username!: string;
  private password!: string;

  constructor(
    private config: ConfigService,
    private queryBuilder: QueryBuilderService,
  ) {
    super();

    // Get credentials from config
    this.username = this.config.get<string>('OXYLABS_USERNAME')!;
    this.password = this.config.get<string>('OXYLABS_PASSWORD')!;

    if (!this.username || !this.password) {
      this.logger.warn(
        'Oxylabs credentials not configured. Service will be disabled.',
      );
      (this as any).enabled = false;
      return;
    }

    // Initialize HTTP client
    // Oxylabs can be slow especially during peak times - use 60s timeout
    const timeout = this.config.get<number>('OXYLABS_TIMEOUT_MS') || 600000;
    this.client = axios.create({
      baseURL: 'https://realtime.oxylabs.io/v1',
      auth: {
        username: this.username,
        password: this.password,
      },
      timeout, // 60s timeout (configurable via OXYLABS_TIMEOUT_MS)
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.logger.log(`Oxylabs HTTP client timeout: ${timeout}ms`);

    // Rate limiter: 10 requests per second
    const rateLimit = this.config.get<number>('OXYLABS_RATE_LIMIT') || 10;
    this.limiter = new Bottleneck({
      reservoir: rateLimit, // Initial tokens
      reservoirRefreshAmount: rateLimit,
      reservoirRefreshInterval: 1000, // Refill every second
      maxConcurrent: 5, // Max 5 concurrent requests
    });

    this.logger.log(
      `Oxylabs service initialized (rate limit: ${rateLimit} req/s)`,
    );
  }

  // Enable/disable check
  get enabled(): boolean {
    return (
      this.config.get<boolean>('ENABLE_OXYLABS') !== false &&
      !!this.username &&
      !!this.password
    );
  }

  /**
   * Search Google Shopping via Oxylabs
   * Uses @Retry decorator for automatic retries with exponential backoff
   *
   * CRITICAL FIX: Snapshots query values before rate limiter to prevent
   * race conditions where query object could be modified between scheduling and execution.
   */
  @Retry({
    maxRetries: 3,
    backoff: 'exponential',
    retryOn: [429, 500, 502, 503, 504],
  })
  async search(query: SearchQuery): Promise<Product[]> {
    const startTime = Date.now();

    // CRITICAL FIX: Snapshot ALL query values IMMEDIATELY before any async operation
    // This prevents race conditions where the query object could be modified
    // between when the limiter schedules the request and when it executes.
    // (Defense-in-depth measure alongside the circuit breaker fix)
    const querySnapshot = {
      terms: String(query.terms || ''),
      itemType: query.itemType ? String(query.itemType) : undefined,
      category: query.category ? String(query.category) : undefined,
      gender: query.gender ? String(query.gender) : undefined,
      color: query.color ? [...query.color] : undefined,
      brands: query.brands ? [...query.brands] : undefined,
      style: query.style ? String(query.style) : undefined,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      limit: query.limit,
      offset: query.offset,
    } as SearchQuery;

    this.logger.debug(`[Oxylabs] RECEIVED - terms="${querySnapshot.terms}", itemType="${querySnapshot.itemType}", category="${querySnapshot.category}"`);

    try {
      // Build Oxylabs-specific query using the snapshot (not the original reference)
      const searchQuery = this.queryBuilder.buildOxylabsQuery(querySnapshot);

      // Execute with rate limiting - use snapshot inside closure
      const response = await this.limiter.schedule(() =>
        this.executeSearch(searchQuery, querySnapshot),
      );

      // Parse and normalize results
      const products = this.parseResults(response.data, querySnapshot);

      // Track success
      const latency = Date.now() - startTime;
      this.trackSuccess(latency);

      this.logger.log(
        `Oxylabs returned ${products.length} products in ${latency}ms`,
      );

      return products;
    } catch (error) {
      // Track failure
      this.trackFailure(error as Error);

      this.logger.error(
        `Oxylabs search failed: ${(error as Error).message}`,
        (error as Error).stack,
      );

      throw error;
    }
  }

  /**
   * Execute the actual HTTP request to Oxylabs
   * ENHANCED: Adds price to query string (Python approach) for better filtering
   */
  private async executeSearch(
    searchQuery: string,
    query: SearchQuery,
  ): Promise<any> {
    // CRITICAL FIX: Add price directly to query string (Python approach)
    // This works better than context parameters for price filtering
    let enhancedQuery = searchQuery;
    if (query.maxPrice && query.maxPrice < 10000) {
      enhancedQuery += ` under $${Math.floor(query.maxPrice)}`;
      this.logger.debug(`[Oxylabs] Added price filter to query: under $${Math.floor(query.maxPrice)}`);
    }

    const payload = {
      source: 'google_shopping_search',
      domain: 'com',
      query: enhancedQuery,
      pages: 1,
      start_page: Math.floor((query.offset || 0) / (query.limit || 50)) + 1,
      parse: true,
      context: [
        {
          key: 'results_language',
          value: 'en',
        },
        {
          key: 'filter',
          value: '1', // Filter by relevance
        },
      ],
    };

    // Also add price range via context (belt-and-suspenders approach)
    if (query.minPrice || query.maxPrice) {
      const min = query.minPrice || 0;
      const max = query.maxPrice || 10000;
      payload.context.push({
        key: 'min_price',
        value: min.toString(),
      });
      payload.context.push({
        key: 'max_price',
        value: max.toString(),
      });
    }

    this.logger.debug(`[Oxylabs] Request payload:`, { query: enhancedQuery, pages: payload.pages });

    const response = await this.client.post('/queries', payload);

    // Check for Oxylabs-specific errors
    if (response.data.error) {
      throw new Error(`Oxylabs API error: ${response.data.error}`);
    }

    return response;
  }

  /**
   * Parse Oxylabs response and normalize to Product[]
   * ENHANCED: Handles multiple response formats (ported from Python pipeline)
   */
  private parseResults(data: any, query: SearchQuery): Product[] {
    let organicResults: any[] = [];
    const content = data?.results?.[0]?.content;

    if (!content) {
      this.logger.warn('[Oxylabs] No content in response');
      return [];
    }

    // Try multiple response paths (Python-style multi-format support)
    // Path 1: content.results.organic (standard Google Shopping format)
    if (content?.results?.organic && Array.isArray(content.results.organic)) {
      organicResults = content.results.organic;
      this.logger.debug(`[Oxylabs] Found ${organicResults.length} results in content.results.organic`);
    }
    // Path 2: content.results.shopping_results (alternative format)
    else if (content?.results?.shopping_results && Array.isArray(content.results.shopping_results)) {
      organicResults = content.results.shopping_results;
      this.logger.debug(`[Oxylabs] Found ${organicResults.length} results in content.results.shopping_results`);
    }
    // Path 3: content.results as array (some API responses)
    else if (Array.isArray(content?.results)) {
      organicResults = content.results;
      this.logger.debug(`[Oxylabs] Found ${organicResults.length} results in content.results (array)`);
    }
    // Path 4: content.organic (direct organic results)
    else if (content?.organic && Array.isArray(content.organic)) {
      organicResults = content.organic;
      this.logger.debug(`[Oxylabs] Found ${organicResults.length} results in content.organic`);
    }
    // Path 5: content.shopping_results (direct shopping results)
    else if (content?.shopping_results && Array.isArray(content.shopping_results)) {
      organicResults = content.shopping_results;
      this.logger.debug(`[Oxylabs] Found ${organicResults.length} results in content.shopping_results`);
    }
    // Path 6: content.paid (paid/sponsored results as fallback)
    else if (content?.results?.paid && Array.isArray(content.results.paid)) {
      organicResults = content.results.paid;
      this.logger.debug(`[Oxylabs] Using ${organicResults.length} paid results as fallback`);
    }

    if (organicResults.length === 0) {
      this.logger.warn('[Oxylabs] No results found in any format');
      this.logger.debug('[Oxylabs] Response content keys:', Object.keys(content || {}));
      if (content?.results) {
        this.logger.debug('[Oxylabs] Results keys:', Object.keys(content.results || {}));
      }
      return [];
    }

    const products: Product[] = [];

    for (const item of organicResults) {
      try {
        const product = this.normalizeOxylabsProduct(item);

        // Validate product has a valid URL before adding
        if (!this.isValidProductUrl(product.productUrl)) {
          this.logger.warn(
            `[Oxylabs] Skipping product with invalid URL: ${product.title?.substring(0, 50)}`,
          );
          continue;
        }

        products.push(product);

        // Limit to requested amount
        if (products.length >= (query.limit || 50)) {
          break;
        }
      } catch (error) {
        this.logger.warn(
          `Failed to parse Oxylabs product: ${(error as Error).message}`,
          item,
        );
      }
    }

    return products;
  }

  /**
   * Normalize Oxylabs product to our Product interface
   */
  private normalizeOxylabsProduct(item: any): Product {
    // Extract price from various possible formats
    const price = this.extractPrice(item.price || item.price_str);

    // Extract original price (if on sale)
    const originalPrice = item.original_price
      ? this.extractPrice(item.original_price)
      : undefined;

    // CRITICAL FIX: Extract actual product URL (not Google Shopping redirect)
    const productUrl = this.extractActualProductUrl(item);

    const product = normalizeProduct(
      {
        id: item.product_id || item.pos,
        title: item.title,
        brand: this.extractBrand(item.title),
        retailer: item.merchant?.name || item.seller || 'Unknown',
        price,
        originalPrice,
        currency: item.currency || 'USD',
        onSale: !!originalPrice && originalPrice > price,
        image: item.thumbnail || item.image,
        productUrl,
        rating: item.rating,
        reviewCount: item.reviews_count || item.reviews,
        inStock: true, // Assume in stock if shown in results
      },
      SearchSource.OXYLABS,
    );

    return product;
  }

  /**
   * Extract actual product URL from Oxylabs response
   * CRITICAL: Prioritizes merchant.url (actual retailer page) over item.url (Google Shopping redirect)
   * Ported from Python pipeline: oxylabs_client.py lines 1177-1262
   */
  private extractActualProductUrl(item: any): string {
    // PRIORITY 1: merchant.url = ACTUAL retailer product page (google_shopping_search format)
    const merchant = item.merchant;
    if (merchant && typeof merchant === 'object') {
      const merchantUrl =
        merchant.url || merchant.link || merchant.href || merchant.website;
      if (merchantUrl && typeof merchantUrl === 'string') {
        const cleanUrl = merchantUrl.trim();
        if (cleanUrl && !this.isGoogleShoppingUrl(cleanUrl)) {
          this.logger.debug(
            `[Oxylabs] Using merchant URL: ${cleanUrl.substring(0, 80)}`,
          );
          return cleanUrl;
        }
      }
    }

    // PRIORITY 2: Try direct product link fields (skip Google Shopping redirects)
    const directUrl =
      item.product_link || item.buy_link || item.purchase_url || '';
    if (directUrl && !this.isGoogleShoppingUrl(directUrl)) {
      return directUrl;
    }

    // PRIORITY 3: item.url - but check if it's NOT a Google Shopping redirect
    const itemUrl = item.url || item.link || item.href || '';
    if (itemUrl && !this.isGoogleShoppingUrl(itemUrl)) {
      return itemUrl;
    }

    // PRIORITY 4: Handle relative Amazon URLs (e.g., /dp/B0...)
    if (itemUrl && itemUrl.startsWith('/dp/')) {
      return `https://www.amazon.com${itemUrl}`;
    }

    // Check merchant name for Amazon relative URLs
    const merchantName = merchant?.name || item.seller || '';
    if (
      itemUrl &&
      itemUrl.startsWith('/') &&
      merchantName.toLowerCase().includes('amazon')
    ) {
      return `https://www.amazon.com${itemUrl}`;
    }

    // FALLBACK: Return Google Shopping URL if nothing else available
    // (Not ideal, but better than empty - at least user can navigate)
    if (itemUrl) {
      this.logger.warn(
        `[Oxylabs] Using Google Shopping redirect as fallback: ${itemUrl.substring(0, 80)}`,
      );
      return itemUrl;
    }

    this.logger.warn(
      `[Oxylabs] No valid URL found for product: ${item.title?.substring(0, 50)}`,
    );
    return '';
  }

  /**
   * Check if URL is a Google Shopping redirect (not an actual retailer URL)
   */
  private isGoogleShoppingUrl(url: string): boolean {
    if (!url) return false;
    const lowerUrl = url.toLowerCase();
    return (
      lowerUrl.includes('google.com/shopping') ||
      lowerUrl.includes('google.com/url') ||
      lowerUrl.includes('google.com/aclk')
    );
  }

  /**
   * Validate that a product URL is usable (not empty, starts with http, not a redirect)
   */
  private isValidProductUrl(url: string): boolean {
    if (!url) return false;
    if (url.length < 10) return false;
    if (!url.startsWith('http')) return false;
    // Google Shopping redirects are valid but not ideal - we allow them as fallback
    return true;
  }

  /**
   * Extract numeric price from string
   */
  private extractPrice(priceStr: string | number): number {
    if (typeof priceStr === 'number') return priceStr;
    if (!priceStr) return 0;

    // Remove currency symbols and extract number
    const cleaned = priceStr.toString().replace(/[^0-9.]/g, '');
    return parseFloat(cleaned) || 0;
  }

  /**
   * Try to extract brand from title
   */
  private extractBrand(title: string): string | undefined {
    if (!title) return undefined;

    // Common patterns: "Brand Name - Product" or "Brand Name Product"
    const words = title.split(/[\s-]+/);
    if (words.length > 0) {
      // First word is often the brand
      const firstWord = words[0];
      if (firstWord && firstWord.length > 1) {
        return firstWord;
      }
    }

    return undefined;
  }

  /**
   * Health check: verify Oxylabs API is accessible
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Simple test query
      const testQuery: SearchQuery = {
        terms: 'dress',
        limit: 1,
      };

      const results = await this.search(testQuery);
      return results.length > 0;
    } catch (error) {
      this.logger.error(`Oxylabs health check failed: ${(error as Error).message}`);
      return false;
    }
  }
}
