import { Injectable, Logger } from '@nestjs/common';
import { RedisCacheService } from './redis-cache.service';
import * as crypto from 'crypto';

export interface SearchQuery {
  terms: string;
  category?: string;
  itemType?: string; // CRITICAL: Different slots need different cache entries
  gender?: string;
  minPrice?: number;
  maxPrice?: number;
  brands?: string[];
  colors?: string[];
  occasion?: string;
}

export interface CachedSearchResult {
  results: any[];
  cachedAt: Date;
  sources: string[];
}

@Injectable()
export class SearchCacheService {
  private readonly logger = new Logger(SearchCacheService.name);
  private readonly DEFAULT_TTL = 3600; // 1 hour
  private readonly GENERIC_TTL = 14400; // 4 hours for generic queries
  private readonly PREFIX = 'search:';

  constructor(private redis: RedisCacheService) {}

  /**
   * Get cached search results
   * Returns null if cache contains empty/invalid results (auto-invalidates them)
   */
  async getCachedResults(query: SearchQuery): Promise<CachedSearchResult | null> {
    const cacheKey = this.buildCacheKey(query);

    const cached = await this.redis.get<CachedSearchResult>(cacheKey);

    if (cached) {
      // IMPORTANT: Invalidate and skip cache entries with 0 results
      // These are likely from previous API failures
      if (!cached.results || cached.results.length === 0) {
        this.logger.warn(
          `Cache HIT for query: "${query.terms}" but contains 0 results - invalidating stale cache`
        );
        await this.invalidate(query);
        return null;
      }

      this.logger.log(
        `Cache HIT for query: "${query.terms}" (${cached.results.length} results, cached ${this.getTimeSince(cached.cachedAt)})`
      );
      return cached;
    }

    this.logger.log(`Cache MISS for query: "${query.terms}"`);
    return null;
  }

  /**
   * Cache search results
   * IMPORTANT: Does NOT cache empty results to prevent serving stale empty caches
   */
  async cacheResults(
    query: SearchQuery,
    results: any[],
    sources?: string[],
  ): Promise<void> {
    // NEVER cache empty results - this prevents the bug where a temporary
    // API failure causes us to serve empty results for the TTL duration
    if (!results || results.length === 0) {
      this.logger.warn(
        `Skipping cache for query: "${query.terms}" - empty results (sources may have failed)`
      );
      return;
    }

    // Only cache if we have a minimum number of results (at least 3)
    // This prevents caching partial/degraded results
    const MIN_RESULTS_TO_CACHE = 3;
    if (results.length < MIN_RESULTS_TO_CACHE) {
      this.logger.warn(
        `Skipping cache for query: "${query.terms}" - only ${results.length} results (minimum: ${MIN_RESULTS_TO_CACHE})`
      );
      return;
    }

    const cacheKey = this.buildCacheKey(query);
    const ttl = this.getTTL(query);

    const cacheData: CachedSearchResult = {
      results,
      cachedAt: new Date(),
      sources: sources || [],
    };

    await this.redis.set(cacheKey, cacheData, ttl);

    this.logger.log(
      `Cached ${results.length} results for query: "${query.terms}" (TTL: ${ttl}s, sources: ${sources?.join(', ') || 'none'})`
    );
  }

  /**
   * Invalidate cache for a specific query
   */
  async invalidate(query: SearchQuery): Promise<void> {
    const cacheKey = this.buildCacheKey(query);
    await this.redis.del(cacheKey);
    this.logger.log(`Invalidated cache for query: "${query.terms}"`);
  }

  /**
   * Invalidate all search caches
   */
  async invalidateAll(): Promise<number> {
    const count = await this.redis.delPattern(`${this.PREFIX}*`);
    this.logger.log(`Invalidated ${count} search cache entries`);
    return count;
  }

  /**
   * Get similar cached results (for fallback)
   */
  async getSimilarResults(query: SearchQuery): Promise<CachedSearchResult | null> {
    // Try with simplified query (remove filters)
    const simplifiedQuery: SearchQuery = {
      terms: query.terms,
      gender: query.gender,
    };

    return this.getCachedResults(simplifiedQuery);
  }

  /**
   * Build cache key from query
   */
  private buildCacheKey(query: SearchQuery): string {
    // Normalize query for better cache hits
    const normalized = this.normalizeQuery(query);

    // Create hash of normalized query
    const hash = crypto
      .createHash('md5')
      .update(JSON.stringify(normalized))
      .digest('hex');

    // Include gender and itemType in key for easier debugging
    const gender = normalized.gender || 'unisex';
    const itemType = normalized.itemType || 'any';

    return `${this.PREFIX}${gender}:${itemType}:${hash}`;
  }

  /**
   * Normalize query for consistent caching
   */
  private normalizeQuery(query: SearchQuery): any {
    return {
      // Lowercase and sort terms for consistency
      terms: query.terms
        .toLowerCase()
        .trim()
        .split(/\s+/)
        .sort()
        .join(' '),

      category: query.category?.toLowerCase(),
      // CRITICAL: Include itemType so different slots get different cache entries
      itemType: query.itemType?.toLowerCase(),
      gender: query.gender?.toLowerCase(),

      // Round prices to nearest $10 for better cache hits
      minPrice: query.minPrice
        ? Math.floor(query.minPrice / 10) * 10
        : undefined,
      maxPrice: query.maxPrice ? Math.ceil(query.maxPrice / 10) * 10 : undefined,

      // Sort brands alphabetically
      brands: query.brands?.map(b => b.toLowerCase()).sort(),

      // Sort colors
      colors: query.colors?.map(c => c.toLowerCase()).sort(),

      occasion: query.occasion?.toLowerCase(),
    };
  }

  /**
   * Determine TTL based on query characteristics
   */
  private getTTL(query: SearchQuery): number {
    // Generic queries (no brand/price filters) get longer TTL
    const isGeneric =
      !query.brands?.length &&
      !query.minPrice &&
      !query.maxPrice &&
      !query.colors?.length;

    return isGeneric ? this.GENERIC_TTL : this.DEFAULT_TTL;
  }

  /**
   * Get human-readable time since cached
   */
  private getTimeSince(cachedAt: Date): string {
    const seconds = Math.floor((Date.now() - new Date(cachedAt).getTime()) / 1000);

    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    totalKeys: number;
    avgTtl: number;
  }> {
    // This is a simplified version - in production you'd track hits/misses
    const info = await this.redis.getInfo();

    return {
      totalKeys: info.dbSize || 0,
      avgTtl: this.DEFAULT_TTL,
    };
  }
}
