import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  MongooseHealthIndicator,
  MemoryHealthIndicator,
  DiskHealthIndicator,
} from '@nestjs/terminus';
import { Public } from '../../modules/auth/application/decorators/public.decorator';
import { SearchHealthIndicator } from './indicators/search.health';
import { LLMHealthIndicator } from './indicators/llm.health';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: MongooseHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly disk: DiskHealthIndicator,
    private readonly search: SearchHealthIndicator,
    private readonly llm: LLMHealthIndicator,
  ) {}

  @Get()
  @Public()
  @HealthCheck()
  check() {
    return this.health.check([
      // Database health
      () => this.db.pingCheck('database'),

      // Memory health - heap should not exceed 300MB
      () => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024),

      // Memory health - RSS should not exceed 500MB
      () => this.memory.checkRSS('memory_rss', 500 * 1024 * 1024),

      // Disk health - disk usage should not exceed 90%
      () =>
        this.disk.checkStorage('storage', {
          path: '/',
          thresholdPercent: 0.9,
        }),
    ]);
  }

  @Get('liveness')
  @Public()
  liveness() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('readiness')
  @Public()
  @HealthCheck()
  readiness() {
    return this.health.check([() => this.db.pingCheck('database')]);
  }

  /**
   * Deep health check including all services
   * Use for monitoring dashboards, not for load balancer probes
   */
  @Get('deep')
  @Public()
  @HealthCheck()
  deepCheck() {
    return this.health.check([
      // Core infrastructure
      () => this.db.pingCheck('database'),
      () => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024),
      () => this.memory.checkRSS('memory_rss', 500 * 1024 * 1024),
      () =>
        this.disk.checkStorage('storage', {
          path: '/',
          thresholdPercent: 0.9,
        }),

      // AI Pipeline services
      () => this.search.isHealthy('search_sources'),
      () => this.llm.isHealthy('llm_providers'),
    ]);
  }

  /**
   * Get search source statistics
   */
  @Get('search')
  @Public()
  async searchHealth() {
    return this.search.getStats();
  }

  /**
   * Get LLM provider status
   */
  @Get('llm')
  @Public()
  llmHealth() {
    return this.llm.getLLMStatus();
  }
}
