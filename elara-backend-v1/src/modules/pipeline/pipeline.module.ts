import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LLMModule } from './infrastructure/llm/llm.module';
import { SearchModule } from './search/search.module';
import { AgentsModule } from './agents/agents.module';
import { CircuitBreakerService } from './infrastructure/resilience/circuit-breaker.service';
import { RedisCacheService } from './infrastructure/cache/redis-cache.service';
import { SearchCacheService } from './infrastructure/cache/search-cache.service';

// Phase 6.5 modules
import { ProductsModule } from './products/products.module';
import { EmbeddingsModule } from './embeddings/embeddings.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { WishlistModule } from './wishlist/wishlist.module';
import { SearchHistoryModule } from './search-history/search-history.module';
import { PersonalizationModule } from './personalization/personalization.module';
import { ImageProcessingModule } from './image-processing/image-processing.module';
import { OutfitScoringModule } from './outfit-scoring/outfit-scoring.module';

// Phase 3: Context services
import { ContextModule } from './context/context.module';

/**
 * Pipeline Module
 *
 * Main module for the AI chat pipeline.
 * Includes all sub-modules for search, chat, products, embeddings, etc.
 */
@Module({
  imports: [
    ConfigModule,
    LLMModule,
    SearchModule,
    AgentsModule,
    // Phase 3: Context services
    ContextModule,
    // Phase 6.5: AI & Data Foundation
    ProductsModule,
    EmbeddingsModule,
    AnalyticsModule,
    WishlistModule,
    SearchHistoryModule,
    PersonalizationModule,
    ImageProcessingModule,
    OutfitScoringModule,
  ],
  providers: [
    // Resilience
    CircuitBreakerService,

    // Cache
    RedisCacheService,
    SearchCacheService,
  ],
  exports: [
    LLMModule,
    SearchModule,
    AgentsModule,
    CircuitBreakerService,
    RedisCacheService,
    SearchCacheService,
    // Phase 3
    ContextModule,
    // Phase 6.5
    ProductsModule,
    EmbeddingsModule,
    AnalyticsModule,
    WishlistModule,
    SearchHistoryModule,
    PersonalizationModule,
    ImageProcessingModule,
    OutfitScoringModule,
  ],
})
export class PipelineModule {}
