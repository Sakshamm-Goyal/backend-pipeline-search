import { Injectable, Logger, Optional, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Product, SearchResult, SearchSource } from './dto/product.dto';
import { SearchQuery } from './dto/search-query.dto';
import { ISearchSource } from './sources/search-source.interface';
import { ProductRankerService } from './ranking/product-ranker.service';
import { CircuitBreakerService } from '../infrastructure/resilience/circuit-breaker.service';
import { SearchCacheService } from '../infrastructure/cache/search-cache.service';
import { ProductRepository } from '../products/infrastructure/persistence/product.repository';

/**
 * Search Orchestrator Service
 *
 * The heart of the search infrastructure. Coordinates multiple search sources
 * with intelligent fallback chains, parallel execution, and caching.
 *
 * Key Features:
 * - Parallel multi-source search (3-5x faster than sequential)
 * - Circuit breaker per source (prevent cascade failures)
 * - Smart fallback chains (Oxylabs → ShopStyle → Scrapers)
 * - Result aggregation and deduplication
 * - ML-based ranking with optional LLM reranking
 * - Multi-level caching
 * - Graceful degradation (always return something)
 *
 * Performance Targets:
 * - P50 latency: < 3s
 * - P99 latency: < 10s
 * - Success rate: > 95%
 */
@Injectable()
export class SearchOrchestratorService {
  private readonly logger = new Logger(SearchOrchestratorService.name);
  private searchSources: ISearchSource[] = [];

  constructor(
    private config: ConfigService,
    private ranker: ProductRankerService,
    private circuitBreaker: CircuitBreakerService,
    private searchCache: SearchCacheService,
    @Optional() @Inject(forwardRef(() => ProductRepository))
    private productRepository?: ProductRepository,
  ) {}

  /**
   * Register a search source
   */
  registerSource(source: ISearchSource): void {
    if (source.enabled) {
      this.searchSources.push(source);
      this.logger.log(`Registered search source: ${source.name} (priority: ${source.priority})`);
    } else {
      this.logger.warn(`Search source disabled: ${source.name}`);
    }
  }

  /**
   * Execute search across all sources with intelligent orchestration
   */
  async search(
    query: SearchQuery,
    userContext?: any,
  ): Promise<SearchResult> {
    const startTime = Date.now();

    // CRITICAL DEBUG: Log query.terms at entry point (use LOG level for visibility)
    this.logger.log(`[SearchOrchestrator] ENTRY - terms="${query.terms}", itemType="${query.itemType}", category="${query.category}"`);

    try {
      // Step 1: Check cache first
      const cached = await this.searchCache.getCachedResults(query);
      if (cached) {
        this.logger.log(`Cache hit for query: "${query.terms}"`);

        // CRITICAL: Filter out claude_web products from cached results
        // Old cache entries may contain fabricated products that need to be removed
        const cleanedResults = this.filterFabricatedProducts(cached.results);

        // If cache only had fabricated products, skip cache and do fresh search
        if (cleanedResults.length === 0 && cached.results.length > 0) {
          this.logger.warn(`Cache contained only fabricated products for "${query.terms}", skipping cache`);
        } else {
          return {
            products: cleanedResults.slice(0, query.limit || 50),
            totalFound: cleanedResults.length,
            page: 1,
            perPage: query.limit || 50,
            sources: cached.sources.map((s) => s as SearchSource),
            timing: {
              total: Date.now() - startTime,
              bySource: { cache: 0 },
            },
            metadata: {
              query: query.terms,
              filters: query,
              cacheHit: true,
            },
          };
        }
      }

      // Step 2: Execute parallel search across sources
      const rawProducts = await this.parallelSearch(query);

      // CRITICAL: Filter out fabricated claude_web products immediately
      // This ensures they never contaminate rankings, cache, or final results
      const products = this.filterFabricatedProducts(rawProducts);

      if (products.length === 0) {
        this.logger.warn(`No products found for query: "${query.terms}"`);
      }

      // Step 3: Apply all filters in correct order (matches Python pipeline)
      // Order: Gender → Price → URL Type → Quality/Availability → Dedup
      const filtered = this.ranker.applyAllFilters(products, query);

      // Step 4: Rank products
      const ranked = await this.ranker.rankProducts(
        filtered,
        query,
        userContext,
      );

      // Step 5: Apply diversity
      const diversified = this.ranker.diversifyResults(ranked);

      // Step 6: Limit to requested amount
      const limited = diversified.slice(0, query.limit || 50);

      // Step 7: Cache results
      const sourcesUsed = [
        ...new Set(products.map((p) => p.source)),
      ] as string[];
      await this.searchCache.cacheResults(query, limited, sourcesUsed);

      // Step 8: Persist products to database (async, non-blocking)
      this.persistProducts(limited);

      // Build result
      const totalTime = Date.now() - startTime;
      const result: SearchResult = {
        products: limited,
        totalFound: diversified.length,
        page: Math.floor((query.offset || 0) / (query.limit || 50)) + 1,
        perPage: query.limit || 50,
        sources: sourcesUsed as SearchSource[],
        timing: {
          total: totalTime,
          bySource: this.calculateSourceTimings(products),
        },
        metadata: {
          query: query.terms,
          filters: query,
          cacheHit: false,
        },
      };

      this.logger.log(
        `Search completed: ${result.products.length} products in ${totalTime}ms (sources: ${sourcesUsed.join(', ')})`,
      );

      return result;
    } catch (error) {
      this.logger.error(`Search orchestration failed: ${(error as Error).message}`, (error as Error).stack);

      // Return empty result (graceful degradation)
      return {
        products: [],
        totalFound: 0,
        page: 1,
        perPage: query.limit || 50,
        sources: [],
        timing: {
          total: Date.now() - startTime,
          bySource: {},
        },
        metadata: {
          query: query.terms,
          filters: query,
          cacheHit: false,
        },
      };
    }
  }

  /**
   * Execute search across all sources in parallel
   */
  private async parallelSearch(query: SearchQuery): Promise<Product[]> {
    // Sort sources by priority (descending)
    const sortedSources = [...this.searchSources].sort(
      (a, b) => b.priority - a.priority,
    );

    // Strategy: Try high-priority sources in parallel first
    // If they fail or return < 20 products, try fallback sources

    const primarySources = sortedSources.filter((s) => s.priority >= 80);
    const fallbackSources = sortedSources.filter((s) => s.priority < 80);

    this.logger.debug(
      `Primary sources: ${primarySources.map((s) => s.name).join(', ')}`,
    );
    this.logger.debug(
      `Fallback sources: ${fallbackSources.map((s) => s.name).join(', ')}`,
    );

    // Try primary sources first (in parallel)
    const primaryResults = await this.executeSearchSources(primarySources, query);

    // If we have enough results, return
    if (primaryResults.length >= 20) {
      this.logger.debug(`Got ${primaryResults.length} products from primary sources`);
      return primaryResults;
    }

    // Otherwise, try fallback sources too
    this.logger.debug(
      `Only ${primaryResults.length} products from primary, trying fallbacks`,
    );
    const fallbackResults = await this.executeSearchSources(fallbackSources, query);

    // Combine and return
    const allResults = [...primaryResults, ...fallbackResults];
    this.logger.debug(`Total products from all sources: ${allResults.length}`);

    return allResults;
  }

  /**
   * Execute search across multiple sources in parallel
   */
  private async executeSearchSources(
    sources: ISearchSource[],
    query: SearchQuery,
  ): Promise<Product[]> {
    if (sources.length === 0) return [];

    // Execute all sources in parallel
    const promises = sources.map((source) =>
      this.searchWithCircuitBreaker(source, query),
    );

    // Wait for all to complete (don't fail if one fails)
    const results = await Promise.allSettled(promises);

    // Flatten successful results
    const products: Product[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        products.push(...result.value);
      } else {
        this.logger.warn(
          `Source ${sources[i].name} failed: ${result.reason.message}`,
        );
      }
    }

    return products;
  }

  /**
   * Search a single source with circuit breaker protection
   * Uses individual timeouts per source (matches Python pipeline)
   */
  private async searchWithCircuitBreaker(
    source: ISearchSource,
    query: SearchQuery,
  ): Promise<Product[]> {
    // Use source-specific timeout if defined, otherwise fall back to global
    // Individual timeouts (from Python): DB=4s, ASOS=15s, SearchAPI=30s, Oxylabs=60s
    const defaultTimeout = this.config.get<number>('SEARCH_TIMEOUT_MS') || 30000;
    const timeout = source.timeout || defaultTimeout;

    this.logger.debug(`Searching ${source.name} with ${timeout}ms timeout`);

    return this.circuitBreaker.execute(
      `search-${source.name}`,
      async () => {
        // Execute search with individual timeout
        return this.withTimeout(source.search(query), timeout);
      },
      async () => {
        // Fallback: return empty array
        this.logger.warn(`Circuit breaker open for ${source.name}, using fallback`);
        return [];
      },
      {
        timeout,
        errorThresholdPercentage: 50, // Open after 50% failures
        resetTimeout: 30000, // Try again after 30s
      },
    );
  }

  /**
   * Wrap promise with timeout
   */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Timeout after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
  }

  /**
   * Calculate timing breakdown by source
   */
  private calculateSourceTimings(
    products: Product[],
  ): Record<string, number> {
    const timings: Record<string, number> = {};

    // Group products by source
    const bySource = new Map<string, Product[]>();
    for (const product of products) {
      const source = product.source;
      if (!bySource.has(source)) {
        bySource.set(source, []);
      }
      bySource.get(source)!.push(product);
    }

    // Get stats from each source
    for (const source of this.searchSources) {
      const stats = source.getStats();
      timings[source.name] = stats.averageLatency;
    }

    return timings;
  }

  /**
   * Get health status of all search sources
   */
  async getHealthStatus(): Promise<Record<string, boolean>> {
    const status: Record<string, boolean> = {};

    const promises = this.searchSources.map(async (source) => {
      try {
        const healthy = await source.healthCheck();
        status[source.name] = healthy;
      } catch {
        status[source.name] = false;
      }
    });

    await Promise.all(promises);

    return status;
  }

  /**
   * Get statistics for all search sources
   */
  getStatistics() {
    return this.searchSources.map((source) => source.getStats());
  }

  /**
   * Get circuit breaker stats
   */
  getCircuitBreakerStats() {
    return this.searchSources.map((source) => ({
      source: source.name,
      circuitBreaker: this.circuitBreaker.getStats(`search-${source.name}`),
    }));
  }

  /**
   * Persist products to database (non-blocking background operation)
   * Deduplicates automatically based on source + sourceId
   */
  private persistProducts(products: Product[]): void {
    if (!this.productRepository || products.length === 0) {
      return;
    }

    // Fire and forget - don't await to avoid blocking search response
    this.productRepository
      .saveMany(products)
      .then((result) => {
        this.logger.log(
          `Persisted ${result.saved} new, ${result.updated} updated products to database`,
        );
      })
      .catch((error: Error) => {
        // Log but don't fail the search
        this.logger.error(
          `Failed to persist products to database: ${error.message}`,
          error.stack,
        );
      });
  }

  /**
   * Set product repository (for late binding when module loads)
   */
  setProductRepository(repository: ProductRepository): void {
    this.productRepository = repository;
    this.logger.log('ProductRepository connected to SearchOrchestrator');
  }

  /**
   * Filter out fabricated products from claude_web source
   *
   * CRITICAL: claude_web products have fake/fabricated URLs that don't work.
   * These products were cached before the service was disabled, and need to be
   * filtered out to prevent broken links in outfit recommendations.
   *
   * Products are rejected if:
   * - ID starts with "claude_web-" or "claude-web-"
   * - Source is "claude_web" or "claude-web"
   *
   * This filter is applied:
   * 1. When reading from cache (to clean old contaminated cache)
   * 2. When caching new results (to prevent future contamination)
   */
  private filterFabricatedProducts(products: Product[]): Product[] {
    const before = products.length;

    const filtered = products.filter((product) => {
      const productId = (product.id || '').toLowerCase();
      const source = (product.source || '').toLowerCase();

      // Reject claude_web products (fabricated URLs)
      if (
        productId.startsWith('claude_web-') ||
        productId.startsWith('claude-web-') ||
        source === 'claude_web' ||
        source === 'claude-web'
      ) {
        return false;
      }

      return true;
    });

    const removed = before - filtered.length;
    if (removed > 0) {
      this.logger.warn(
        `Filtered ${removed} fabricated claude_web products (${before} → ${filtered.length})`,
      );
    }

    return filtered;
  }
}
