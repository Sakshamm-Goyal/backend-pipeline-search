import { Module, forwardRef } from '@nestjs/common';
import { OutfitCompatibilityService } from './outfit-compatibility.service';
import { OutfitScoringController } from './controllers/outfit-scoring.controller';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { OutfitReasoningService } from './services/outfit-reasoning.service';
import { ContextAwareScoringService } from './services/context-aware-scoring.service';
import { OutfitRecommendationScoringService } from './services/outfit-recommendation-scoring.service';
import { LLMModule } from '../infrastructure/llm/llm.module';
import { SearchModule } from '../search/search.module';
import { ContextModule } from '../context/context.module';

/**
 * Outfit Scoring Module
 *
 * Provides outfit compatibility scoring and suggestions.
 *
 * Features:
 * - Multi-factor outfit scoring
 * - Color harmony analysis
 * - Pattern balance checking
 * - Style cohesion evaluation
 * - Outfit completion suggestions
 * - Best match recommendations
 * - Context-aware scoring (weather, event, trends)
 * - AI-powered outfit generation with full context
 *
 * Uses:
 * - Rule-based scoring (color, pattern, style rules)
 * - Vector embeddings for semantic compatibility
 * - Gemini LLM for outfit generation
 * - Weather and event context services
 *
 * API Endpoints:
 * - POST /pipeline/outfit-scoring/score - Score an outfit
 * - POST /pipeline/outfit-scoring/suggestions - Get completion suggestions
 * - POST /pipeline/outfit-scoring/best-matches - Find best matches
 * - GET /pipeline/outfit-scoring/weights - Get scoring weights
 */
@Module({
  imports: [
    EmbeddingsModule,
    LLMModule,
    forwardRef(() => SearchModule),
    forwardRef(() => ContextModule),
  ],
  controllers: [OutfitScoringController],
  providers: [
    OutfitCompatibilityService,
    OutfitReasoningService,
    ContextAwareScoringService,
    OutfitRecommendationScoringService,
  ],
  exports: [
    OutfitCompatibilityService,
    OutfitReasoningService,
    ContextAwareScoringService,
    OutfitRecommendationScoringService,
  ],
})
export class OutfitScoringModule {}
