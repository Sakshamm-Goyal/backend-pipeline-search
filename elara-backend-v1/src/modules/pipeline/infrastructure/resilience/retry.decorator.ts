import { Logger } from '@nestjs/common';

export interface RetryOptions {
  maxRetries?: number;
  backoff?: 'linear' | 'exponential';
  retryOn?: number[]; // HTTP status codes to retry
  onRetry?: (attempt: number, error: any) => void;
  timeoutMs?: number;
}

const logger = new Logger('RetryDecorator');

/**
 * Decorator to add retry logic with exponential backoff to methods
 *
 * Usage:
 * ```typescript
 * @Retry({ maxRetries: 3, backoff: 'exponential', retryOn: [429, 500, 502, 503] })
 * async searchProducts(query: string): Promise<Product[]> {
 *   // ...
 * }
 * ```
 */
export function Retry(options: RetryOptions = {}) {
  const maxRetries = options.maxRetries ?? 3;
  const backoffType = options.backoff ?? 'exponential';
  const retryableErrors = options.retryOn ?? [429, 500, 502, 503, 504];

  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      let lastError: any;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          // Execute the original method
          const result = await originalMethod.apply(this, args);
          return result;
        } catch (error) {
          lastError = error;

          // Check if this error should be retried
          if (!isRetryableError(error, retryableErrors)) {
            logger.debug(
              `[${propertyKey}] Error not retryable: ${(error as Error).message}`
            );
            throw error;
          }

          // Don't retry if this was the last attempt
          if (attempt === maxRetries) {
            logger.error(
              `[${propertyKey}] All ${maxRetries} retry attempts exhausted`
            );
            throw error;
          }

          // Calculate backoff delay
          const delay = calculateBackoff(attempt, backoffType);

          logger.warn(
            `[${propertyKey}] Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms (error: ${(error as Error).message})`
          );

          // Call onRetry callback if provided
          if (options.onRetry) {
            options.onRetry(attempt + 1, error);
          }

          // Wait before retrying
          await sleep(delay);
        }
      }

      // This should never be reached, but TypeScript needs it
      throw lastError;
    };

    return descriptor;
  };
}

/**
 * Check if an error should trigger a retry
 */
function isRetryableError(error: any, retryableStatuses: number[]): boolean {
  // Check HTTP status codes (for axios/fetch errors)
  if (error.response?.status) {
    return retryableStatuses.includes(error.response.status);
  }

  // Check error status property (alternative format)
  if (error.status) {
    return retryableStatuses.includes(error.status);
  }

  // Check for network errors
  const networkErrorCodes = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED'];
  if (error.code && networkErrorCodes.includes(error.code)) {
    return true;
  }

  // Check error message for common patterns
  const message = (error as Error).message?.toLowerCase() || '';
  const retryablePatterns = [
    'timeout',
    'timed out',
    'rate limit',
    'too many requests',
    'service unavailable',
    'bad gateway',
    'gateway timeout',
  ];

  return retryablePatterns.some(pattern => message.includes(pattern));
}

/**
 * Calculate backoff delay
 */
function calculateBackoff(
  attempt: number,
  type: 'linear' | 'exponential',
): number {
  if (type === 'linear') {
    // Linear: 1s, 2s, 3s, 4s...
    return 1000 * (attempt + 1);
  }

  // Exponential: 1s, 2s, 4s, 8s, 16s... (capped at 30s)
  const delay = 1000 * Math.pow(2, attempt);
  return Math.min(delay, 30000);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Timeout wrapper for promises
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage?: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(errorMessage || `Operation timed out after ${timeoutMs}ms`)),
        timeoutMs,
      ),
    ),
  ]);
}
