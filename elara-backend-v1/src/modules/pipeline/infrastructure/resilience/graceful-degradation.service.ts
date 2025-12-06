import { Injectable, Logger } from '@nestjs/common';

/**
 * Graceful Degradation Service
 *
 * Provides fallback mechanisms and degraded functionality when services are unavailable.
 * Helps maintain partial functionality during outages.
 *
 * Features:
 * - Service availability tracking
 * - Automatic fallback selection
 * - Degradation level management
 * - Recovery detection
 */

export enum DegradationLevel {
  NONE = 'none', // All services healthy
  PARTIAL = 'partial', // Some non-critical services down
  DEGRADED = 'degraded', // Critical services impacted
  CRITICAL = 'critical', // Core functionality impaired
}

export interface ServiceStatus {
  name: string;
  available: boolean;
  lastCheck: Date;
  lastError?: string;
  fallbackAvailable: boolean;
}

export interface FallbackConfig {
  primary: string;
  fallbacks: string[];
  timeout: number;
}

@Injectable()
export class GracefulDegradationService {
  private readonly logger = new Logger(GracefulDegradationService.name);
  private serviceStatuses = new Map<string, ServiceStatus>();
  private degradationLevel: DegradationLevel = DegradationLevel.NONE;

  // Define critical vs non-critical services
  private readonly criticalServices = ['database', 'gemini'];
  private readonly nonCriticalServices = ['search_sources', 'embeddings', 'weather', 'trends'];

  /**
   * Update service status
   */
  updateServiceStatus(
    name: string,
    available: boolean,
    error?: string,
    hasFallback = false,
  ): void {
    const status: ServiceStatus = {
      name,
      available,
      lastCheck: new Date(),
      lastError: error,
      fallbackAvailable: hasFallback,
    };

    const previousStatus = this.serviceStatuses.get(name);
    this.serviceStatuses.set(name, status);

    // Log status changes
    if (previousStatus?.available !== available) {
      if (available) {
        this.logger.log(`Service "${name}" recovered`);
      } else {
        this.logger.warn(`Service "${name}" became unavailable: ${error}`);
      }
    }

    // Recalculate degradation level
    this.calculateDegradationLevel();
  }

  /**
   * Check if a service is available
   */
  isServiceAvailable(name: string): boolean {
    const status = this.serviceStatuses.get(name);
    return status?.available ?? true; // Assume available if not tracked
  }

  /**
   * Get current degradation level
   */
  getDegradationLevel(): DegradationLevel {
    return this.degradationLevel;
  }

  /**
   * Get all service statuses
   */
  getAllStatuses(): ServiceStatus[] {
    return Array.from(this.serviceStatuses.values());
  }

  /**
   * Execute with fallback chain
   */
  async executeWithFallback<T>(
    operations: Array<{
      name: string;
      execute: () => Promise<T>;
    }>,
    defaultValue?: T,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (const op of operations) {
      // Skip if service is known to be unavailable
      if (!this.isServiceAvailable(op.name)) {
        this.logger.debug(`Skipping unavailable service: ${op.name}`);
        continue;
      }

      try {
        const result = await op.execute();
        this.updateServiceStatus(op.name, true);
        return result;
      } catch (error) {
        lastError = error as Error;
        this.updateServiceStatus(op.name, false, lastError.message, true);
        this.logger.warn(`Fallback from ${op.name}: ${lastError.message}`);
      }
    }

    // All operations failed
    if (defaultValue !== undefined) {
      this.logger.warn('All operations failed, returning default value');
      return defaultValue;
    }

    throw lastError || new Error('All fallback operations failed');
  }

  /**
   * Get degraded response for search
   */
  getDegradedSearchResponse(): {
    products: never[];
    totalFound: number;
    sources: string[];
    degraded: boolean;
    message: string;
  } {
    return {
      products: [],
      totalFound: 0,
      sources: [],
      degraded: true,
      message: 'Search is currently unavailable. Please try again later.',
    };
  }

  /**
   * Get degraded response for outfit generation
   */
  getDegradedOutfitResponse(): {
    outfits: never[];
    degraded: boolean;
    message: string;
  } {
    return {
      outfits: [],
      degraded: true,
      message: 'Outfit generation is temporarily unavailable. Please try again later.',
    };
  }

  /**
   * Get degraded response for context
   */
  getDegradedContextResponse(): {
    weather: null;
    trends: never[];
    constraints: { preferredMaterials: string[]; avoidMaterials: string[]; temperatureRange: string };
    degraded: boolean;
    message: string;
  } {
    return {
      weather: null,
      trends: [],
      constraints: {
        preferredMaterials: [],
        avoidMaterials: [],
        temperatureRange: 'mild',
      },
      degraded: true,
      message: 'Context services are temporarily unavailable.',
    };
  }

  /**
   * Calculate overall degradation level based on service statuses
   */
  private calculateDegradationLevel(): void {
    const criticalDown = this.criticalServices.filter(
      (s) => !this.isServiceAvailable(s),
    );
    const nonCriticalDown = this.nonCriticalServices.filter(
      (s) => !this.isServiceAvailable(s),
    );

    let newLevel: DegradationLevel;

    if (criticalDown.length > 1) {
      newLevel = DegradationLevel.CRITICAL;
    } else if (criticalDown.length === 1) {
      newLevel = DegradationLevel.DEGRADED;
    } else if (nonCriticalDown.length >= 2) {
      newLevel = DegradationLevel.PARTIAL;
    } else {
      newLevel = DegradationLevel.NONE;
    }

    if (newLevel !== this.degradationLevel) {
      this.degradationLevel = newLevel;
      this.logger.log(`Degradation level changed to: ${newLevel}`);
    }
  }

  /**
   * Get health summary for monitoring
   */
  getHealthSummary(): {
    level: DegradationLevel;
    criticalServicesUp: number;
    criticalServicesDown: number;
    nonCriticalServicesUp: number;
    nonCriticalServicesDown: number;
    services: ServiceStatus[];
  } {
    const criticalUp = this.criticalServices.filter((s) =>
      this.isServiceAvailable(s),
    ).length;
    const criticalDown = this.criticalServices.length - criticalUp;

    const nonCriticalUp = this.nonCriticalServices.filter((s) =>
      this.isServiceAvailable(s),
    ).length;
    const nonCriticalDown = this.nonCriticalServices.length - nonCriticalUp;

    return {
      level: this.degradationLevel,
      criticalServicesUp: criticalUp,
      criticalServicesDown: criticalDown,
      nonCriticalServicesUp: nonCriticalUp,
      nonCriticalServicesDown: nonCriticalDown,
      services: this.getAllStatuses(),
    };
  }
}
