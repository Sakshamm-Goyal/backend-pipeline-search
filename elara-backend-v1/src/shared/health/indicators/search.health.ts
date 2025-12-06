import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { SearchOrchestratorService } from '../../../modules/pipeline/search/search-orchestrator.service';

/**
 * Search Health Indicator
 *
 * Checks the health of search sources (scrapers and APIs).
 * Reports which sources are available and their current status.
 */
@Injectable()
export class SearchHealthIndicator extends HealthIndicator {
  private readonly logger = new Logger(SearchHealthIndicator.name);

  constructor(private searchOrchestrator: SearchOrchestratorService) {
    super();
  }

  /**
   * Calculate success rate from stats
   */
  private calculateSuccessRate(stats: {
    totalRequests: number;
    successfulRequests: number;
  }): number {
    if (stats.totalRequests === 0) return 1; // No requests yet = healthy
    return stats.successfulRequests / stats.totalRequests;
  }

  /**
   * Check if search sources are healthy
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const stats = this.searchOrchestrator.getStatistics();

      const enabledSources = stats.filter((s) => s.enabled);
      const healthySources = stats.filter(
        (s) => s.enabled && this.calculateSuccessRate(s) > 0.5,
      );
      const unhealthySources = stats.filter(
        (s) => s.enabled && this.calculateSuccessRate(s) <= 0.5,
      );

      const isHealthy = enabledSources.length > 0 && healthySources.length > 0;

      const details = {
        totalSources: stats.length,
        enabledSources: enabledSources.length,
        healthySources: healthySources.length,
        unhealthySources: unhealthySources.length,
        sources: stats.map((s) => ({
          name: s.name,
          enabled: s.enabled,
          successRate: this.calculateSuccessRate(s),
          avgLatency: s.averageLatency,
        })),
      };

      if (isHealthy) {
        return this.getStatus(key, true, details);
      }

      throw new HealthCheckError(
        'Search sources unhealthy',
        this.getStatus(key, false, details),
      );
    } catch (error) {
      if (error instanceof HealthCheckError) {
        throw error;
      }

      this.logger.error(`Search health check failed: ${(error as Error).message}`);
      throw new HealthCheckError(
        'Search health check failed',
        this.getStatus(key, false, { error: (error as Error).message }),
      );
    }
  }

  /**
   * Get search source statistics summary
   */
  async getStats(): Promise<{
    healthy: boolean;
    enabledCount: number;
    healthyCount: number;
    sources: Array<{
      name: string;
      enabled: boolean;
      successRate: number;
      avgLatency: number;
    }>;
  }> {
    const stats = this.searchOrchestrator.getStatistics();
    const enabledSources = stats.filter((s) => s.enabled);
    const healthySources = stats.filter(
      (s) => s.enabled && this.calculateSuccessRate(s) > 0.5,
    );

    return {
      healthy: enabledSources.length > 0 && healthySources.length > 0,
      enabledCount: enabledSources.length,
      healthyCount: healthySources.length,
      sources: stats.map((s) => ({
        name: s.name,
        enabled: s.enabled,
        successRate: this.calculateSuccessRate(s),
        avgLatency: s.averageLatency,
      })),
    };
  }
}
