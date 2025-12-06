import { Product, SearchSource } from '../dto/product.dto';
import { SearchQuery } from '../dto/search-query.dto';

/**
 * Search Source Interface
 *
 * All search sources (APIs, scrapers) must implement this interface.
 * This allows the orchestrator to treat all sources uniformly.
 */
export interface ISearchSource {
  /**
   * Unique identifier for this source
   */
  readonly name: SearchSource;

  /**
   * Is this source currently enabled?
   */
  readonly enabled: boolean;

  /**
   * Priority level (higher = tried first)
   * Useful for fallback chains
   */
  readonly priority: number;

  /**
   * Individual timeout for this source in milliseconds
   * Different sources have different response times:
   * - DB/Cache: 4000ms (fast)
   * - ASOS Scraper: 15000ms (medium)
   * - Oxylabs: 60000ms (slow, external API)
   * - SearchAPI: 30000ms (medium-slow)
   * Default: 30000ms if not specified
   */
  readonly timeout?: number;

  /**
   * Execute a search and return normalized products
   *
   * @param query - Normalized search query
   * @returns Promise<Product[]>
   * @throws Error if search fails (caught by circuit breaker)
   */
  search(query: SearchQuery): Promise<Product[]>;

  /**
   * Check if this source is healthy and ready to serve requests
   * Called periodically by orchestrator
   *
   * @returns Promise<boolean>
   */
  healthCheck(): Promise<boolean>;

  /**
   * Get current statistics about this source
   * Used for monitoring and debugging
   */
  getStats(): SourceStats;
}

export interface SourceStats {
  name: string;
  enabled: boolean;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatency: number; // in ms
  lastSuccess?: Date;
  lastFailure?: Date;
  lastError?: string;
}

/**
 * Base implementation with common functionality
 */
export abstract class BaseSearchSource implements ISearchSource {
  abstract readonly name: SearchSource;
  abstract readonly enabled: boolean;
  abstract readonly priority: number;
  readonly timeout?: number; // Optional, uses default if not set

  // Statistics tracking
  protected stats!: SourceStats;

  private latencies: number[] = []; // Last 100 latencies

  abstract search(query: SearchQuery): Promise<Product[]>;

  async healthCheck(): Promise<boolean> {
    // Default health check: try a simple search
    try {
      const testQuery: SearchQuery = {
        terms: 'test',
        limit: 1,
      };
      await this.search(testQuery);
      return true;
    } catch {
      return false;
    }
  }

  getStats(): SourceStats {
    this.ensureStatsInitialized();
    return { ...this.stats };
  }

  /**
   * Ensure stats is initialized (lazy initialization)
   */
  private ensureStatsInitialized(): void {
    if (!this.stats) {
      this.stats = {
        name: this.name,
        enabled: this.enabled,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageLatency: 0,
      };
    }
  }

  /**
   * Track a successful request
   */
  protected trackSuccess(latency: number): void {
    this.ensureStatsInitialized();
    this.stats.totalRequests++;
    this.stats.successfulRequests++;
    this.stats.lastSuccess = new Date();
    this.updateLatency(latency);
  }

  /**
   * Track a failed request
   */
  protected trackFailure(error: Error): void {
    this.ensureStatsInitialized();
    this.stats.totalRequests++;
    this.stats.failedRequests++;
    this.stats.lastFailure = new Date();
    this.stats.lastError = error.message;
  }

  /**
   * Update average latency (rolling window of last 100 requests)
   */
  private updateLatency(latency: number): void {
    this.latencies.push(latency);
    if (this.latencies.length > 100) {
      this.latencies.shift(); // Keep only last 100
    }

    const sum = this.latencies.reduce((a, b) => a + b, 0);
    this.stats.averageLatency = Math.round(sum / this.latencies.length);
  }
}
