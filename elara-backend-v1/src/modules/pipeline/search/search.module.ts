import { Module, OnModuleInit, Logger, Optional } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LLMModule } from '../infrastructure/llm/llm.module';

// Services
import { QueryBuilderService } from './query-builder.service';
import { SearchOrchestratorService } from './search-orchestrator.service';
import { ProductRankerService } from './ranking/product-ranker.service';
import { SemanticSearchService } from './semantic-search.service';

// Sources (API-based - preferred)
import { OxylabsService } from './sources/oxylabs.service';
import { ShopStyleService } from './sources/shopstyle.service'; // Deprecated - returns 401
import { AsosScraperService as AsosApiService } from './sources/asos-scraper.service'; // ASOS API (FREE)
import { SearchApiService } from './sources/searchapi.service'; // SearchAPI.io - Google Shopping

// New search sources
import { BraveSearchService } from './sources/brave-search.service'; // Brave Search API
import { WalmartService } from './sources/walmart.service'; // Walmart API
import { TargetService } from './sources/target.service'; // Target API
import { ClaudeWebSearchService } from './sources/claude-web-search.service'; // Claude Web Search

// Scrapers (Playwright-based - fallback)
import { AsosScraperService as AsosPlaywrightScraper } from './scrapers/asos-scraper.service';

// Infrastructure (imported from pipeline module)
import { CircuitBreakerService } from '../infrastructure/resilience/circuit-breaker.service';
import { SearchCacheService } from '../infrastructure/cache/search-cache.service';
import { RedisCacheService } from '../infrastructure/cache/redis-cache.service';

// Product persistence
import { ProductsModule } from '../products/products.module';

// Embeddings for semantic search
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { ProductRepository } from '../products/infrastructure/persistence/product.repository';

// Personalization for ranking
import { PersonalizationModule } from '../personalization/personalization.module';

/**
 * Search Module
 *
 * Provides multi-source product search with intelligent orchestration,
 * ranking, caching, and resilience patterns.
 *
 * Search Source Priority (higher = tried first):
 * 1. Oxylabs (100) - Google Shopping scraper, primary source
 * 2. SearchAPI.io (90) - Google Shopping API, ShopStyle replacement
 * 3. ASOS API (85) - Direct ASOS API, FREE fashion-specific
 * 4. Brave Search (75) - Brave Search API
 * 5. Walmart (70) - Walmart API
 * 6. Target (70) - Target API
 * 7. ASOS Playwright (70) - Fallback scraper
 * 8. Claude Web Search (60) - AI-powered search (expensive, fallback only)
 * 9. ShopStyle (DISABLED) - Deprecated, returns 401
 *
 * Exports:
 * - SearchOrchestratorService (main entry point)
 * - QueryBuilderService (for building source-specific queries)
 * - ProductRankerService (for ranking and filtering)
 */
@Module({
  imports: [ConfigModule, LLMModule, ProductsModule, EmbeddingsModule, PersonalizationModule],
  providers: [
    // Core services
    QueryBuilderService,
    SearchOrchestratorService,
    ProductRankerService,
    SemanticSearchService,

    // Infrastructure
    CircuitBreakerService,
    RedisCacheService,
    SearchCacheService,

    // Search sources (API-based, preferred)
    OxylabsService,           // Priority 100 - Google Shopping
    SearchApiService,         // Priority 90 - Google Shopping via SearchAPI.io
    AsosApiService,           // Priority 85 - ASOS API (FREE)
    BraveSearchService,       // Priority 75 - Brave Search API
    WalmartService,           // Priority 70 - Walmart API
    TargetService,            // Priority 70 - Target API
    ClaudeWebSearchService,   // Priority 60 - Claude AI Web Search (fallback)
    ShopStyleService,         // DEPRECATED - disabled by default

    // Scrapers (Playwright-based, fallback)
    AsosPlaywrightScraper,    // Priority 70 - ASOS scraper fallback
  ],
  exports: [
    SearchOrchestratorService,
    QueryBuilderService,
    ProductRankerService,
    SemanticSearchService,
  ],
})
export class SearchModule implements OnModuleInit {
  private readonly logger = new Logger(SearchModule.name);

  constructor(
    private orchestrator: SearchOrchestratorService,
    private config: ConfigService,
    private oxylabs: OxylabsService,
    private searchApi: SearchApiService,
    private asosApi: AsosApiService,
    private asosPlaywright: AsosPlaywrightScraper,
    @Optional() private shopstyle: ShopStyleService, // Optional since deprecated
    @Optional() private braveSearch: BraveSearchService, // Optional - needs API key
    @Optional() private walmart: WalmartService, // Optional - needs API key
    @Optional() private target: TargetService, // Optional - needs API key
    @Optional() private claudeWebSearch: ClaudeWebSearchService, // Optional - uses Anthropic key
    private productRepository: ProductRepository,
  ) {}

  /**
   * Register all search sources with the orchestrator on module initialization
   */
  async onModuleInit() {
    // Register primary sources (always available)
    this.orchestrator.registerSource(this.oxylabs);
    this.orchestrator.registerSource(this.searchApi);
    this.orchestrator.registerSource(this.asosApi);
    this.orchestrator.registerSource(this.asosPlaywright);

    // Register new sources (if configured)
    if (this.braveSearch?.enabled) {
      this.orchestrator.registerSource(this.braveSearch);
      this.logger.log('Brave Search: ENABLED');
    }

    if (this.walmart?.enabled) {
      this.orchestrator.registerSource(this.walmart);
      this.logger.log('Walmart: ENABLED');
    }

    if (this.target?.enabled) {
      this.orchestrator.registerSource(this.target);
      this.logger.log('Target: ENABLED');
    }

    if (this.claudeWebSearch?.enabled) {
      this.orchestrator.registerSource(this.claudeWebSearch);
      this.logger.log('Claude Web Search: ENABLED');
    }

    // ShopStyle is deprecated - only register if explicitly enabled
    const enableShopStyle = this.config.get<boolean>('ENABLE_SHOPSTYLE');
    if (enableShopStyle && this.shopstyle) {
      this.logger.warn('ShopStyle is deprecated and returns 401 errors. Consider removing.');
      this.orchestrator.registerSource(this.shopstyle);
    }

    // Connect product repository for persistence
    this.orchestrator.setProductRepository(this.productRepository);

    // Log registered sources
    const stats = this.orchestrator.getStatistics();
    const enabledSources = stats.filter((s) => s.enabled);

    this.logger.log(`Search Module Initialized`);
    this.logger.log(`Active sources: ${enabledSources.length}`);
    enabledSources.forEach((s) => {
      this.logger.log(`  - ${s.name} (priority: ${this.getSourcePriority(s.name)})`);
    });

    if (!enableShopStyle) {
      this.logger.log(`ShopStyle: DISABLED (deprecated, use SEARCHAPI_API_KEY instead)`);
    }
  }

  private getSourcePriority(name: string): number {
    const priorities: Record<string, number> = {
      oxylabs: 100,
      google_shopping: 90,
      asos_scraper: 85,
      brave_search: 75,
      walmart: 70,
      target: 70,
      asos_playwright: 70,
      claude_web: 60,
      shopstyle: 0, // Disabled
    };
    return priorities[name] || 50;
  }
}
