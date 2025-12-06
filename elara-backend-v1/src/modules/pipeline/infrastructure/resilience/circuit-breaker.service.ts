import { Injectable, Logger } from '@nestjs/common';
import CircuitBreaker from 'opossum';

export interface CircuitBreakerOptions {
  timeout?: number;
  errorThresholdPercentage?: number;
  resetTimeout?: number;
  volumeThreshold?: number;
}

export interface CircuitBreakerStats {
  state: 'OPEN' | 'CLOSED' | 'HALF_OPEN';
  failures: number;
  successes: number;
  fallbacks: number;
  rejects: number;
}

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private breakers = new Map<string, CircuitBreaker<unknown[], unknown>>();

  /**
   * Get or create a circuit breaker for a named operation
   */
  getOrCreate<T>(
    name: string,
    operation: (...args: unknown[]) => Promise<T>,
    options?: CircuitBreakerOptions,
  ): CircuitBreaker<unknown[], T> {
    if (!this.breakers.has(name)) {
      const breaker = new CircuitBreaker<unknown[], T>(operation, {
        timeout: options?.timeout || 30000, // 30s default
        errorThresholdPercentage: options?.errorThresholdPercentage || 50,
        resetTimeout: options?.resetTimeout || 60000, // 60s before retry
        volumeThreshold: options?.volumeThreshold || 5, // min requests before tripping
      });

      // Event logging for monitoring
      breaker.on('open', () => {
        this.logger.warn(`Circuit breaker "${name}" OPENED (too many failures)`);
      });

      breaker.on('halfOpen', () => {
        this.logger.log(`Circuit breaker "${name}" HALF-OPEN (testing recovery)`);
      });

      breaker.on('close', () => {
        this.logger.log(`Circuit breaker "${name}" CLOSED (recovered)`);
      });

      breaker.on('failure', (error: Error) => {
        this.logger.debug(`Circuit breaker "${name}" failure:`, error.message);
      });

      breaker.on('fallback', () => {
        this.logger.debug(`Circuit breaker "${name}" fallback executed`);
      });

      this.breakers.set(name, breaker as CircuitBreaker<unknown[], unknown>);
      this.logger.log(`Circuit breaker "${name}" created`);
    }

    return this.breakers.get(name)! as CircuitBreaker<unknown[], T>;
  }

  /**
   * Execute an operation with circuit breaker protection
   *
   * CRITICAL FIX: The operation is passed to fire() each time, NOT cached in the breaker.
   * This ensures each request uses its own query/parameters, not a cached closure.
   *
   * Previous bug: getOrCreate() was caching the first operation closure, causing
   * subsequent requests to use stale query parameters from the first request.
   */
  async execute<T>(
    name: string,
    operation: () => Promise<T>,
    fallback?: () => Promise<T>,
    options?: CircuitBreakerOptions,
  ): Promise<T> {
    // CRITICAL FIX: Create breaker with a dummy operation, then call fire() with the actual operation
    // This ensures each request uses its own closure, not a cached one
    const breaker = this.getOrCreateStateless<T>(name, options);

    try {
      // Pass the operation to fire() so each call uses its own closure
      return await breaker.fire(operation) as T;
    } catch (error) {
      // If we have a fallback, use it
      if (fallback) {
        this.logger.warn(`Circuit breaker "${name}" executing fallback`);
        return fallback();
      }

      // Otherwise, rethrow the error
      throw error;
    }
  }

  /**
   * Get or create a stateless circuit breaker (operation passed to fire() each time)
   *
   * CRITICAL: This version does NOT cache the operation in the breaker.
   * The operation is passed to fire() on each call, ensuring each request
   * uses its own closure with its own query parameters.
   */
  private getOrCreateStateless<T>(
    name: string,
    options?: CircuitBreakerOptions,
  ): CircuitBreaker<[() => Promise<T>], T> {
    if (!this.breakers.has(name)) {
      // Create breaker that accepts an operation function as its argument
      // and executes that operation (not a cached one)
      const breaker = new CircuitBreaker<[() => Promise<T>], T>(
        async (op: () => Promise<T>) => op(),  // Execute the passed operation
        {
          timeout: options?.timeout || 30000,
          errorThresholdPercentage: options?.errorThresholdPercentage || 50,
          resetTimeout: options?.resetTimeout || 60000,
          volumeThreshold: options?.volumeThreshold || 5,
        }
      );

      // Event logging for monitoring
      breaker.on('open', () => {
        this.logger.warn(`Circuit breaker "${name}" OPENED (too many failures)`);
      });

      breaker.on('halfOpen', () => {
        this.logger.log(`Circuit breaker "${name}" HALF-OPEN (testing recovery)`);
      });

      breaker.on('close', () => {
        this.logger.log(`Circuit breaker "${name}" CLOSED (recovered)`);
      });

      breaker.on('failure', (error: Error) => {
        this.logger.debug(`Circuit breaker "${name}" failure:`, error.message);
      });

      breaker.on('fallback', () => {
        this.logger.debug(`Circuit breaker "${name}" fallback executed`);
      });

      this.breakers.set(name, breaker as CircuitBreaker<unknown[], unknown>);
      this.logger.log(`Circuit breaker "${name}" created (stateless mode)`);
    }

    return this.breakers.get(name)! as CircuitBreaker<[() => Promise<T>], T>;
  }

  /**
   * Get statistics for a circuit breaker
   */
  getStats(name: string): CircuitBreakerStats | null {
    const breaker = this.breakers.get(name);
    if (!breaker) {
      this.logger.warn(`Circuit breaker "${name}" not found`);
      return null;
    }

    const stats = breaker.stats;

    return {
      state: breaker.opened ? 'OPEN' : breaker.halfOpen ? 'HALF_OPEN' : 'CLOSED',
      failures: stats.failures,
      successes: stats.successes,
      fallbacks: stats.fallbacks,
      rejects: stats.rejects,
    };
  }

  /**
   * Get stats for all circuit breakers
   */
  getAllStats(): Map<string, CircuitBreakerStats> {
    const allStats = new Map<string, CircuitBreakerStats>();

    this.breakers.forEach((breaker, name) => {
      const stats = this.getStats(name);
      if (stats) {
        allStats.set(name, stats);
      }
    });

    return allStats;
  }

  /**
   * Manually open a circuit breaker (for testing/maintenance)
   */
  open(name: string): void {
    const breaker = this.breakers.get(name);
    if (breaker) {
      breaker.open();
      this.logger.log(`Circuit breaker "${name}" manually opened`);
    }
  }

  /**
   * Manually close a circuit breaker (for testing/maintenance)
   */
  close(name: string): void {
    const breaker = this.breakers.get(name);
    if (breaker) {
      breaker.close();
      this.logger.log(`Circuit breaker "${name}" manually closed`);
    }
  }

  /**
   * Clear all circuit breakers (for testing)
   */
  clearAll(): void {
    this.breakers.clear();
    this.logger.log('All circuit breakers cleared');
  }
}
